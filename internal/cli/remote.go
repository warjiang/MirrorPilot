package cli

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"

	"github.com/warjiang/MirrorPilot/internal/config"
)

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

			if strings.TrimSpace(repoURL) == "" {
				repoURL = cfg.Remote.RepoURL
			}
			if strings.TrimSpace(ref) == "" {
				ref = cfg.Remote.Ref
			}
			if strings.TrimSpace(configPath) == "" {
				configPath = cfg.Remote.ConfigPath
			}
			if strings.TrimSpace(repoURL) == "" {
				return errors.New("remote repo url is required; set via `mirrorpilot remote set --repo-url ...` or pass --repo-url")
			}

			remoteCfg, remoteUsedPath, err := config.LoadRemoteConfig(repoURL, ref, configPath)
			if err != nil {
				return err
			}

			fmt.Printf("fetched remote config: repo=%s ref=%s path=%s images=%d synced=%d\n", repoURL, ref, remoteUsedPath, len(remoteCfg.Images), len(remoteCfg.SyncedImages))
			if !merge {
				return nil
			}

			added, syncedUpdated, profileAdded := mergeRemoteIntoLocal(&cfg, remoteCfg)
			cfg.Remote = config.RemoteConfig{RepoURL: repoURL, Ref: ref, ConfigPath: configPath}
			config.RefreshSyncedImages(&cfg)

			fmt.Printf("merge result: profiles_added=%d images_added=%d synced_updated=%d\n", profileAdded, added, syncedUpdated)
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
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Preview merge result without writing local file")
	return cmd
}

func mergeRemoteIntoLocal(local *config.Config, remote config.Config) (added int, syncedUpdated int, profileAdded int) {
	config.EnsureDefaultProfile(local)
	for name, p := range remote.Profiles {
		if _, ok := local.Profiles[name]; ok {
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

	return added, syncedUpdated, profileAdded
}

func newSyncedCmd(opts *options) *cobra.Command {
	var output string
	cmd := &cobra.Command{
		Use:   "synced",
		Short: "Show synced image state from config",
		RunE: func(cmd *cobra.Command, args []string) error {
			lc, err := config.Load(opts.ConfigPath)
			if err != nil {
				return err
			}
			cfg := config.Normalize(lc.Config)
			items := cfg.SyncedImages
			sort.Slice(items, func(i, j int) bool {
				if items[i].Profile != items[j].Profile {
					return items[i].Profile < items[j].Profile
				}
				if items[i].Source != items[j].Source {
					return items[i].Source < items[j].Source
				}
				return items[i].Target < items[j].Target
			})

			viewItems := make([]syncedImageView, 0, len(items))
			for _, item := range items {
				viewItems = append(viewItems, syncedImageView{
					Profile:    item.Profile,
					Source:     item.Source,
					Target:     item.Target,
					CreatedAt:  item.CreatedAt,
					SyncedAt:   item.SyncedAt,
					FullSource: buildFullSource(item.Source),
					FullTarget: buildFullTarget(cfg, item.Profile, item.Target),
				})
			}

			switch output {
			case "table":
				fmt.Println("PROFILE\tSOURCE\tTARGET\tFULL_SOURCE\tFULL_TARGET\tCREATED_AT\tSYNCED_AT")
				for _, item := range viewItems {
					fmt.Printf("%s\t%s\t%s\t%s\t%s\t%s\t%s\n", item.Profile, item.Source, item.Target, item.FullSource, item.FullTarget, item.CreatedAt, item.SyncedAt)
				}
			case "json":
				enc := json.NewEncoder(os.Stdout)
				enc.SetIndent("", "  ")
				return enc.Encode(viewItems)
			case "yaml":
				b, err := yaml.Marshal(viewItems)
				if err != nil {
					return err
				}
				fmt.Print(string(b))
			default:
				return errors.New("--output must be one of: table, json, yaml")
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&output, "output", "table", "Output format: table|json|yaml")
	return cmd
}

type syncedImageView struct {
	Profile    string `json:"profile" yaml:"profile"`
	Source     string `json:"source" yaml:"source"`
	Target     string `json:"target" yaml:"target"`
	CreatedAt  string `json:"created_at,omitempty" yaml:"created_at,omitempty"`
	SyncedAt   string `json:"synced_at,omitempty" yaml:"synced_at,omitempty"`
	FullSource string `json:"full_source" yaml:"full_source"`
	FullTarget string `json:"full_target" yaml:"full_target"`
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

			targetBranch := strings.TrimSpace(branch)
			if targetBranch == "" {
				targetBranch = strings.TrimSpace(ref)
			}

			pushed, err := pushConfigToRemote(repoURL, ref, targetBranch, configPath, cfg, pushConfigOptions{
				DryRun:      dryRun,
				Message:     message,
				AuthorName:  authorName,
				AuthorEmail: authorEmail,
			})
			if err != nil {
				return err
			}
			if !pushed {
				fmt.Println("remote config is already up to date")
				return nil
			}
			if dryRun {
				fmt.Println("dry-run enabled; remote repository not modified")
			} else {
				fmt.Printf("remote config pushed successfully to %s (%s)\n", repoURL, targetBranch)
			}
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
	return strings.TrimSpace(repoURL), strings.TrimSpace(ref), strings.TrimSpace(configPath)
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
	DryRun      bool
	Message     string
	AuthorName  string
	AuthorEmail string
}

func pushConfigToRemote(repoURL, ref, branch, configPath string, cfg config.Config, opts pushConfigOptions) (bool, error) {
	tmpDir, err := os.MkdirTemp("", "mirrorpilot-remote-push-*")
	if err != nil {
		return false, fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	cloneArgs := []string{"clone", "--depth", "1"}
	if strings.TrimSpace(ref) != "" {
		cloneArgs = append(cloneArgs, "--branch", ref)
	}
	cloneArgs = append(cloneArgs, repoURL, tmpDir)
	if _, err := runGit("", cloneArgs...); err != nil {
		return false, fmt.Errorf("clone remote repo: %w", err)
	}

	if strings.TrimSpace(branch) == "" {
		currentBranch, err := runGit(tmpDir, "rev-parse", "--abbrev-ref", "HEAD")
		if err != nil {
			return false, fmt.Errorf("resolve current branch: %w", err)
		}
		branch = strings.TrimSpace(currentBranch)
	}

	cfg = config.Normalize(cfg)
	content, err := yaml.Marshal(cfg)
	if err != nil {
		return false, fmt.Errorf("marshal local config: %w", err)
	}

	absConfigPath := filepath.Join(tmpDir, configPath)
	current, err := os.ReadFile(absConfigPath)
	if err == nil && bytes.Equal(current, content) {
		return false, nil
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return false, fmt.Errorf("read remote config file: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(absConfigPath), 0755); err != nil {
		return false, fmt.Errorf("create config directory: %w", err)
	}
	if err := os.WriteFile(absConfigPath, content, 0644); err != nil {
		return false, fmt.Errorf("write config file: %w", err)
	}
	if _, err := runGit(tmpDir, "add", configPath); err != nil {
		return false, fmt.Errorf("git add config file: %w", err)
	}

	status, err := runGit(tmpDir, "status", "--porcelain")
	if err != nil {
		return false, fmt.Errorf("git status: %w", err)
	}
	if strings.TrimSpace(status) == "" {
		return false, nil
	}

	if opts.DryRun {
		return true, nil
	}

	if strings.TrimSpace(opts.AuthorName) != "" {
		if _, err := runGit(tmpDir, "config", "user.name", opts.AuthorName); err != nil {
			return false, fmt.Errorf("git config user.name: %w", err)
		}
	}
	if strings.TrimSpace(opts.AuthorEmail) != "" {
		if _, err := runGit(tmpDir, "config", "user.email", opts.AuthorEmail); err != nil {
			return false, fmt.Errorf("git config user.email: %w", err)
		}
	}

	commitMessage := strings.TrimSpace(opts.Message)
	if commitMessage == "" {
		commitMessage = "chore: sync mirrorpilot config"
	}
	if _, err := runGit(tmpDir, "commit", "-m", commitMessage); err != nil {
		return false, fmt.Errorf("git commit: %w", err)
	}
	if _, err := runGit(tmpDir, "push", "origin", "HEAD:"+branch); err != nil {
		return false, fmt.Errorf("git push to branch %s: %w", branch, err)
	}
	return true, nil
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
