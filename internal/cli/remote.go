package cli

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"

	"github.com/warjiang/MirrorPilot/internal/config"
)

const defaultRemoteRef = "main"

func newRemoteCmd(opts *options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "remote",
		Short: "Manage remote repo config and fetch remote image list",
	}
	cmd.AddCommand(newRemoteSetCmd(opts), newRemoteFetchCmd(opts), newRemoteCheckCmd(opts), newRemotePushConfigCmd(opts))
	return cmd
}

func newRemoteSetCmd(opts *options) *cobra.Command {
	var repoURL string
	var ref string
	var configPath string

	cmd := &cobra.Command{
		Use:   "set",
		Short: "Set remote repository config",
		RunE: func(cmd *cobra.Command, args []string) error {
			lc, err := config.Load(opts.ConfigPath)
			if err != nil {
				return err
			}
			cfg := config.Normalize(lc.Config)

			if strings.TrimSpace(repoURL) != "" {
				cfg.Remote.RepoURL = strings.TrimSpace(repoURL)
			}
			if strings.TrimSpace(ref) != "" {
				cfg.Remote.Ref = strings.TrimSpace(ref)
			}
			if strings.TrimSpace(configPath) != "" {
				cfg.Remote.ConfigPath = strings.TrimSpace(configPath)
			}

			if strings.TrimSpace(cfg.Remote.RepoURL) == "" {
				return errors.New("remote repo url is required; set via --repo-url")
			}
			cfg.Remote.Ref = normalizeRemoteRef(cfg.Remote.Ref)
			cfg.Remote.ConfigPath = normalizeRemoteConfigPath(cfg.Remote.ConfigPath)

			lc.Config = cfg
			if err := lc.Save(); err != nil {
				return err
			}
			fmt.Printf("remote configured: repo=%s ref=%s config_path=%s\n", cfg.Remote.RepoURL, cfg.Remote.Ref, cfg.Remote.ConfigPath)
			return nil
		},
	}
	cmd.Flags().StringVar(&repoURL, "repo-url", "", "Remote git repository url")
	cmd.Flags().StringVar(&ref, "ref", "", "Remote branch/tag/ref")
	cmd.Flags().StringVar(&configPath, "config-path", "", "Config path in remote repo")
	return cmd
}

func newRemoteFetchCmd(opts *options) *cobra.Command {
	var repoURL string
	var ref string
	var configPath string
	var merge bool
	var forced bool
	var dryRun bool

	cmd := &cobra.Command{
		Use:   "fetch",
		Short: "Fetch remote image list (and optionally merge into local config)",
		RunE: func(cmd *cobra.Command, args []string) error {
			lc, err := config.Load(opts.ConfigPath)
			if err != nil {
				return err
			}
			cfg := config.Normalize(lc.Config)
			repoURL, ref, configPath = resolveRemoteArgs(repoURL, ref, configPath, cfg)
			if strings.TrimSpace(repoURL) == "" {
				return errors.New("remote repo url is required; set via `mirrorpilot remote set --repo-url ...` or pass --repo-url")
			}

			remoteCfg, remoteUsedPath, err := config.LoadRemoteConfig(repoURL, ref, configPath)
			if err != nil {
				return err
			}

			fmt.Printf("fetched remote config: repo=%s ref=%s path=%s images=%d synced=%d\n", repoURL, ref, remoteUsedPath, len(remoteCfg.Images), len(remoteCfg.SyncedImages))
			if !merge {
				if forced {
					return errors.New("--forced requires --merge")
				}
				return nil
			}

			if forced {
				forceRemoteIntoLocal(&cfg, remoteCfg)
			}
			added, syncedUpdated, profileAdded, profileUpdated := 0, 0, 0, 0
			if !forced {
				added, syncedUpdated, profileAdded, profileUpdated = mergeRemoteIntoLocal(&cfg, remoteCfg)
			}
			cfg.Remote = config.RemoteConfig{RepoURL: repoURL, Ref: ref, ConfigPath: configPath}
			config.RefreshSyncedImages(&cfg)

			if forced {
				fmt.Printf("merge result: forced=true profiles=%d images=%d synced=%d\n", len(cfg.Profiles), len(cfg.Images), len(cfg.SyncedImages))
			} else {
				fmt.Printf("merge result: profiles_added=%d profiles_updated=%d images_added=%d synced_updated=%d\n", profileAdded, profileUpdated, added, syncedUpdated)
			}
			if dryRun {
				fmt.Println("dry-run enabled; local config not modified")
				return nil
			}

			lc.Config = cfg
			if err := lc.Save(); err != nil {
				return err
			}
			fmt.Printf("local config updated: %s\n", lc.Path)
			return nil
		},
	}
	cmd.Flags().StringVar(&repoURL, "repo-url", "", "Remote git repository url (defaults to configured remote.repo_url)")
	cmd.Flags().StringVar(&ref, "ref", "", "Remote branch/tag/ref (defaults to configured remote.ref)")
	cmd.Flags().StringVar(&configPath, "config-path", "", "Config path in remote repo (defaults to configured remote.config_path)")
	cmd.Flags().BoolVar(&merge, "merge", true, "Merge fetched data into local config")
	cmd.Flags().BoolVar(&forced, "forced", false, "Force local config to match fetched remote config (requires --merge)")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Preview merge result without writing local file")
	return cmd
}

func forceRemoteIntoLocal(local *config.Config, remote config.Config) {
	*local = config.Normalize(remote)
}

func mergeRemoteIntoLocal(local *config.Config, remote config.Config) (added int, syncedUpdated int, profileAdded int, profileUpdated int) {
	config.EnsureDefaultProfile(local)
	for name, p := range remote.Profiles {
		if cur, ok := local.Profiles[name]; ok {
			if cur.Registry != p.Registry || cur.UsernameEnv != p.UsernameEnv || cur.PasswordEnv != p.PasswordEnv {
				local.Profiles[name] = p
				profileUpdated++
			}
			continue
		}
		local.Profiles[name] = p
		profileAdded++
	}

	index := make(map[string]int, len(local.Images))
	for i, img := range local.Images {
		p := img.Profile
		if p == "" {
			p = config.DefaultProfile
		}
		index[p+"|"+img.Source+"|"+img.Target] = i
	}

	for _, rimg := range remote.Images {
		p := rimg.Profile
		if p == "" {
			p = config.DefaultProfile
		}
		key := p + "|" + rimg.Source + "|" + rimg.Target
		if idx, ok := index[key]; ok {
			if rimg.Synced && !local.Images[idx].Synced {
				local.Images[idx].Synced = true
				local.Images[idx].SyncedAt = rimg.SyncedAt
				if local.Images[idx].CreatedAt == "" {
					local.Images[idx].CreatedAt = rimg.CreatedAt
				}
				syncedUpdated++
			}
			continue
		}
		rimg.Profile = p
		if rimg.Enabled == nil {
			rimg.Enabled = config.BoolPtr(true)
		}
		local.Images = append(local.Images, rimg)
		index[key] = len(local.Images) - 1
		added++
	}

	return added, syncedUpdated, profileAdded, profileUpdated
}

func newRemoteCheckCmd(opts *options) *cobra.Command {
	var repoURL string
	var ref string
	var writeCheck bool
	var probeBranchPrefix string

	cmd := &cobra.Command{
		Use:   "check",
		Short: "Check remote repository readiness (read and write permissions)",
		RunE: func(cmd *cobra.Command, args []string) error {
			lc, err := config.Load(opts.ConfigPath)
			if err != nil {
				return err
			}
			cfg := config.Normalize(lc.Config)
			repoURL, ref, _ = resolveRemoteArgs(repoURL, ref, "", cfg)
			if strings.TrimSpace(repoURL) == "" {
				return errors.New("remote repo url is required; set via `mirrorpilot remote set --repo-url ...` or pass --repo-url")
			}

			readErr := checkRemoteRead(repoURL, ref)
			writeErr := error(nil)
			if writeCheck {
				writeErr = checkRemoteWrite(repoURL, ref, probeBranchPrefix)
			}

			readReady := readErr == nil
			writeReady := !writeCheck || writeErr == nil
			ready := readReady && writeReady
			fmt.Printf("READY=%t READ=%t WRITE=%t repo=%s ref=%s\n", ready, readReady, writeReady, repoURL, ref)
			if readErr != nil {
				fmt.Printf("READ_ERROR: %v\n", readErr)
			}
			if writeCheck && writeErr != nil {
				fmt.Printf("WRITE_ERROR: %v\n", writeErr)
			}
			if !ready {
				return errors.New("remote is not ready")
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&repoURL, "repo-url", "", "Remote git repository url (defaults to configured remote.repo_url)")
	cmd.Flags().StringVar(&ref, "ref", "", "Remote branch/tag/ref (defaults to configured remote.ref)")
	cmd.Flags().BoolVar(&writeCheck, "check-write", true, "Check write permissions using dry-run push to a probe branch")
	cmd.Flags().StringVar(&probeBranchPrefix, "probe-branch-prefix", "mirrorpilot-probe", "Branch prefix for write probe")
	return cmd
}

func newRemotePushConfigCmd(opts *options) *cobra.Command {
	var repoURL string
	var ref string
	var configPath string
	var branch string
	var message string
	var dryRun bool
	var authorName string
	var authorEmail string

	cmd := &cobra.Command{
		Use:   "push-config",
		Short: "Push current local config to remote repository",
		RunE: func(cmd *cobra.Command, args []string) error {
			lc, err := config.Load(opts.ConfigPath)
			if err != nil {
				return err
			}
			cfg := config.Normalize(lc.Config)
			repoURL, ref, configPath = resolveRemoteArgs(repoURL, ref, configPath, cfg)
			if strings.TrimSpace(repoURL) == "" {
				return errors.New("remote repo url is required; set via `mirrorpilot remote set --repo-url ...` or pass --repo-url")
			}
			if strings.TrimSpace(configPath) == "" {
				configPath = config.DefaultConfigPath
			}
			if len(cfg.PendingChanges) == 0 {
				fmt.Println("no staged changes in pending_changes; nothing to push")
				return nil
			}
			if dryRun {
				printPendingChangesPreview(cfg)
				fmt.Println("dry-run enabled; remote repository not modified")
				return nil
			}

			targetBranch := strings.TrimSpace(branch)
			if targetBranch == "" {
				targetBranch = strings.TrimSpace(ref)
			}

			pushed, deletedCount, mergedAdded, mergedUpdated, err := pushPendingConfigToRemote(repoURL, ref, targetBranch, configPath, cfg, pushConfigOptions{
				Message:     message,
				AuthorName:  authorName,
				AuthorEmail: authorEmail,
			})
			if err != nil {
				return err
			}
			pendingAdds, pendingDeletes := splitPendingChanges(cfg.PendingChanges)
			appliedDeleted := applyPendingDeletes(&cfg.Images, pendingDeletes)
			appliedAdded, appliedUpdated := mergeImagesByKey(&cfg.Images, pendingAdds)
			cfg.PendingChanges = nil
			cfg.Remote = config.RemoteConfig{RepoURL: repoURL, Ref: ref, ConfigPath: configPath}
			config.RefreshSyncedImages(&cfg)
			lc.Config = cfg
			if err := lc.Save(); err != nil {
				return err
			}
			if !pushed {
				fmt.Printf("pending changes applied locally (deleted=%d added=%d updated=%d); remote already up to date\n", appliedDeleted, appliedAdded, appliedUpdated)
				return nil
			}
			fmt.Printf("remote config pushed successfully to %s (%s), changes: deleted=%d added=%d updated=%d\n", repoURL, targetBranch, deletedCount, mergedAdded, mergedUpdated)
			return nil
		},
	}
	cmd.Flags().StringVar(&repoURL, "repo-url", "", "Remote git repository url (defaults to configured remote.repo_url)")
	cmd.Flags().StringVar(&ref, "ref", "", "Remote branch/tag/ref for clone (defaults to configured remote.ref)")
	cmd.Flags().StringVar(&configPath, "config-path", "", "Config path in remote repository (defaults to configured remote.config_path)")
	cmd.Flags().StringVar(&branch, "branch", "", "Remote branch to push to (defaults to --ref)")
	cmd.Flags().StringVar(&message, "message", "chore: sync mirrorpilot config", "Git commit message")
	cmd.Flags().StringVar(&authorName, "author-name", "mirrorpilot-bot", "Git commit author name")
	cmd.Flags().StringVar(&authorEmail, "author-email", "mirrorpilot-bot@example.com", "Git commit author email")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Preview remote update without committing/pushing")
	return cmd
}

func resolveRemoteArgs(repoURL, ref, configPath string, cfg config.Config) (string, string, string) {
	if strings.TrimSpace(repoURL) == "" {
		repoURL = cfg.Remote.RepoURL
	}
	if strings.TrimSpace(ref) == "" {
		ref = cfg.Remote.Ref
	}
	if strings.TrimSpace(configPath) == "" {
		configPath = cfg.Remote.ConfigPath
	}
	return strings.TrimSpace(repoURL), normalizeRemoteRef(ref), normalizeRemoteConfigPath(configPath)
}

func normalizeRemoteRef(ref string) string {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return defaultRemoteRef
	}
	return ref
}

func normalizeRemoteConfigPath(configPath string) string {
	configPath = strings.TrimSpace(configPath)
	if configPath == "" {
		return config.DefaultConfigPath
	}
	return configPath
}

func checkRemoteRead(repoURL, ref string) error {
	args := []string{"ls-remote", repoURL}
	if strings.TrimSpace(ref) != "" {
		args = append(args, ref)
	}
	out, err := runGit("", args...)
	if err != nil {
		return fmt.Errorf("git %s failed: %w", strings.Join(args, " "), err)
	}
	if strings.TrimSpace(out) == "" {
		return errors.New("remote returned empty refs")
	}
	return nil
}

func checkRemoteWrite(repoURL, ref, probeBranchPrefix string) error {
	tmpDir, err := os.MkdirTemp("", "mirrorpilot-remote-check-*")
	if err != nil {
		return fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	cloneArgs := []string{"clone", "--depth", "1"}
	if strings.TrimSpace(ref) != "" {
		cloneArgs = append(cloneArgs, "--branch", ref)
	}
	cloneArgs = append(cloneArgs, repoURL, tmpDir)
	if _, err := runGit("", cloneArgs...); err != nil {
		return fmt.Errorf("clone for write check: %w", err)
	}

	branch := strings.TrimSpace(probeBranchPrefix)
	if branch == "" {
		branch = "mirrorpilot-probe"
	}
	branch = fmt.Sprintf("%s-%d", branch, time.Now().UnixNano())
	if _, err := runGit(tmpDir, "push", "--dry-run", "origin", "HEAD:refs/heads/"+branch); err != nil {
		return fmt.Errorf("dry-run push probe failed: %w", err)
	}
	return nil
}

type pushConfigOptions struct {
	Message     string
	AuthorName  string
	AuthorEmail string
}

func pushPendingConfigToRemote(repoURL, ref, branch, configPath string, cfg config.Config, opts pushConfigOptions) (bool, int, int, int, error) {
	pendingAdds, pendingDeletes := splitPendingChanges(cfg.PendingChanges)
	staged := normalizePendingImages(pendingAdds)
	if len(staged) == 0 && len(pendingDeletes) == 0 {
		return false, 0, 0, 0, nil
	}

	tmpDir, err := os.MkdirTemp("", "mirrorpilot-remote-push-*")
	if err != nil {
		return false, 0, 0, 0, fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	cloneArgs := []string{"clone", "--depth", "1"}
	if strings.TrimSpace(ref) != "" {
		cloneArgs = append(cloneArgs, "--branch", ref)
	}
	cloneArgs = append(cloneArgs, repoURL, tmpDir)
	if _, err := runGit("", cloneArgs...); err != nil {
		return false, 0, 0, 0, fmt.Errorf("clone remote repo: %w", err)
	}

	if strings.TrimSpace(branch) == "" {
		currentBranch, err := runGit(tmpDir, "rev-parse", "--abbrev-ref", "HEAD")
		if err != nil {
			return false, 0, 0, 0, fmt.Errorf("resolve current branch: %w", err)
		}
		branch = strings.TrimSpace(currentBranch)
	}

	absConfigPath := filepath.Join(tmpDir, configPath)
	current, err := os.ReadFile(absConfigPath)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return false, 0, 0, 0, fmt.Errorf("read remote config file: %w", err)
	}

	remoteCfg := config.DefaultConfig()
	if !errors.Is(err, os.ErrNotExist) {
		remoteLoaded, loadErr := config.LoadYAML(absConfigPath)
		if loadErr != nil {
			return false, 0, 0, 0, fmt.Errorf("load remote config: %w", loadErr)
		}
		remoteCfg = remoteLoaded.Config
	}
	remoteCfg = config.Normalize(remoteCfg)
	mergeStagedProfiles(&remoteCfg, cfg, staged)
	deletedCount := applyPendingDeletes(&remoteCfg.Images, pendingDeletes)
	mergedAdded, mergedUpdated := mergeImagesByKey(&remoteCfg.Images, staged)
	remoteCfg.PendingChanges = nil
	config.RefreshSyncedImages(&remoteCfg)
	if deletedCount+mergedAdded+mergedUpdated == 0 {
		return false, deletedCount, mergedAdded, mergedUpdated, nil
	}

	content, err := yaml.Marshal(remoteCfg)
	if err != nil {
		return false, 0, 0, 0, fmt.Errorf("marshal merged config: %w", err)
	}
	if !errors.Is(err, os.ErrNotExist) && bytes.Equal(current, content) {
		return false, deletedCount, mergedAdded, mergedUpdated, nil
	}

	if err := os.MkdirAll(filepath.Dir(absConfigPath), 0755); err != nil {
		return false, 0, 0, 0, fmt.Errorf("create config directory: %w", err)
	}
	if err := os.WriteFile(absConfigPath, content, 0644); err != nil {
		return false, 0, 0, 0, fmt.Errorf("write config file: %w", err)
	}
	if _, err := runGit(tmpDir, "add", configPath); err != nil {
		return false, 0, 0, 0, fmt.Errorf("git add config file: %w", err)
	}

	status, err := runGit(tmpDir, "status", "--porcelain")
	if err != nil {
		return false, 0, 0, 0, fmt.Errorf("git status: %w", err)
	}
	if strings.TrimSpace(status) == "" {
		return false, deletedCount, mergedAdded, mergedUpdated, nil
	}

	if strings.TrimSpace(opts.AuthorName) != "" {
		if _, err := runGit(tmpDir, "config", "user.name", opts.AuthorName); err != nil {
			return false, 0, 0, 0, fmt.Errorf("git config user.name: %w", err)
		}
	}
	if strings.TrimSpace(opts.AuthorEmail) != "" {
		if _, err := runGit(tmpDir, "config", "user.email", opts.AuthorEmail); err != nil {
			return false, 0, 0, 0, fmt.Errorf("git config user.email: %w", err)
		}
	}

	commitMessage := strings.TrimSpace(opts.Message)
	if commitMessage == "" {
		commitMessage = "chore: sync mirrorpilot config"
	}
	if _, err := runGit(tmpDir, "commit", "-m", commitMessage); err != nil {
		return false, 0, 0, 0, fmt.Errorf("git commit: %w", err)
	}
	if _, err := runGit(tmpDir, "push", "origin", "HEAD:"+branch); err != nil {
		return false, 0, 0, 0, fmt.Errorf("git push to branch %s: %w", branch, err)
	}
	return true, deletedCount, mergedAdded, mergedUpdated, nil
}

func normalizePendingImages(items []config.Image) []config.Image {
	staged := make([]config.Image, 0, len(items))
	for _, img := range items {
		if strings.TrimSpace(img.Source) == "" || strings.TrimSpace(img.Target) == "" {
			continue
		}
		if img.Profile == "" {
			img.Profile = config.DefaultProfile
		}
		if img.Enabled == nil {
			img.Enabled = config.BoolPtr(true)
		}
		staged = append(staged, img)
	}
	return staged
}

func mergeStagedProfiles(dst *config.Config, src config.Config, staged []config.Image) {
	config.EnsureDefaultProfile(dst)
	for _, img := range staged {
		profile := img.Profile
		if profile == "" {
			profile = config.DefaultProfile
		}
		if _, ok := dst.Profiles[profile]; ok {
			continue
		}
		if p, ok := src.Profiles[profile]; ok {
			dst.Profiles[profile] = p
		}
	}
}

func mergeImagesByKey(dst *[]config.Image, incoming []config.Image) (added int, updated int) {
	index := make(map[string]int, len(*dst))
	for i, img := range *dst {
		profile := img.Profile
		if profile == "" {
			profile = config.DefaultProfile
		}
		index[profile+"|"+img.Source+"|"+img.Target] = i
	}
	for _, img := range incoming {
		profile := img.Profile
		if profile == "" {
			profile = config.DefaultProfile
		}
		key := profile + "|" + img.Source + "|" + img.Target
		img.Profile = profile
		if img.Enabled == nil {
			img.Enabled = config.BoolPtr(true)
		}
		if idx, ok := index[key]; ok {
			cur := (*dst)[idx]
			changed := cur.EnabledValue() != img.EnabledValue() ||
				cur.Notes != img.Notes ||
				cur.Synced != img.Synced ||
				cur.CreatedAt != img.CreatedAt ||
				cur.SyncedAt != img.SyncedAt
			if changed {
				(*dst)[idx] = img
				updated++
			}
			continue
		}
		*dst = append(*dst, img)
		index[key] = len(*dst) - 1
		added++
	}
	return added, updated
}

func applyPendingDeletes(dst *[]config.Image, deletes []config.PendingChange) (deleted int) {
	if len(deletes) == 0 || len(*dst) == 0 {
		return 0
	}
	set := make(map[string]struct{}, len(deletes))
	for _, item := range deletes {
		set[pendingChangeKey(item)] = struct{}{}
	}
	kept := make([]config.Image, 0, len(*dst))
	for _, img := range *dst {
		if _, ok := set[imageKey(img.Profile, img.Source, img.Target)]; ok {
			deleted++
			continue
		}
		kept = append(kept, img)
	}
	*dst = kept
	return deleted
}

func printPendingChangesPreview(cfg config.Config) {
	pendingAdds, pendingDeletes := splitPendingChanges(cfg.PendingChanges)
	staged := normalizePendingImages(pendingAdds)
	headers := []string{"ACTION", "PROFILE", "ENABLED", "SOURCE", "TARGET", "FULL_TARGET"}
	rows := make([][]string, 0, len(staged)+len(pendingDeletes))
	for _, item := range staged {
		rows = append(rows, []string{
			"ADD",
			item.Profile,
			fmt.Sprintf("%t", item.EnabledValue()),
			item.Source,
			item.Target,
			buildFullTarget(cfg, item.Profile, item.Target),
		})
	}
	for _, item := range pendingDeletes {
		p := normalizedProfile(item.Profile)
		rows = append(rows, []string{
			"DELETE",
			p,
			"",
			item.Source,
			item.Target,
			buildFullTarget(cfg, p, item.Target),
		})
	}
	fmt.Println("staged changes (pending_changes):")
	fmt.Print(renderGridTable(headers, rows, 44))
}

func runGit(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%w (%s)", err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}
