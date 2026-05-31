package cli

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/warjiang/MirrorPilot/internal/config"
)

func TestResolveRemoteArgs(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Remote = config.RemoteConfig{
		RepoURL:    "https://example.com/repo.git",
		Ref:        "main",
		ConfigPath: "mirrorpilot.yaml",
	}
	repoURL, ref, configPath := resolveRemoteArgs("", "", "", cfg)
	if repoURL != cfg.Remote.RepoURL || ref != cfg.Remote.Ref || configPath != cfg.Remote.ConfigPath {
		t.Fatalf("unexpected resolved remote args: %s %s %s", repoURL, ref, configPath)
	}
}

func TestResolveRemoteArgs_DefaultsRefAndConfigPath(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Remote = config.RemoteConfig{
		RepoURL: "https://example.com/repo.git",
	}
	repoURL, ref, configPath := resolveRemoteArgs("", "", "", cfg)
	if repoURL != cfg.Remote.RepoURL {
		t.Fatalf("unexpected repo url: %s", repoURL)
	}
	if ref != "main" {
		t.Fatalf("expected default ref main, got %s", ref)
	}
	if configPath != config.DefaultConfigPath {
		t.Fatalf("expected default config path %s, got %s", config.DefaultConfigPath, configPath)
	}
}

func TestCheckRemoteReadAndWrite(t *testing.T) {
	repoURL := setupGitRepo(t)
	if err := checkRemoteRead(repoURL, "main"); err != nil {
		t.Fatalf("check remote read failed: %v", err)
	}
	if err := checkRemoteWrite(repoURL, "main", "mirrorpilot-probe"); err != nil {
		t.Fatalf("check remote write failed: %v", err)
	}
}

func TestPushPendingConfigToRemote(t *testing.T) {
	repoURL := setupGitRepo(t)

	cfg := config.DefaultConfig()
	cfg.PendingImages = append(cfg.PendingImages, config.Image{
		Source:  "nginx:1.27",
		Target:  "mirror/nginx:1.27",
		Profile: config.DefaultProfile,
		Enabled: config.BoolPtr(true),
	})

	changed, deleted, added, updated, err := pushPendingConfigToRemote(repoURL, "main", "main", "mirrorpilot.yaml", cfg, pushConfigOptions{
		Message:     "test: push config",
		AuthorName:  "tester",
		AuthorEmail: "tester@example.com",
	})
	if err != nil {
		t.Fatalf("push config failed: %v", err)
	}
	if !changed {
		t.Fatalf("expected remote config to change")
	}
	if deleted != 0 {
		t.Fatalf("expected deleted=0, got %d", deleted)
	}
	if added != 1 || updated != 0 {
		t.Fatalf("unexpected merge counts, added=%d updated=%d", added, updated)
	}

	readDir := t.TempDir()
	runGitCommand(t, "", "clone", "--depth", "1", "--branch", "main", repoURL, readDir)
	b, err := os.ReadFile(filepath.Join(readDir, "mirrorpilot.yaml"))
	if err != nil {
		t.Fatalf("read pushed config: %v", err)
	}
	content := string(b)
	if !strings.Contains(content, "nginx:1.27") {
		t.Fatalf("expected pushed config to contain image, got: %s", content)
	}
	if strings.Contains(content, "pending_images:") {
		t.Fatalf("expected pending_images to be cleared in remote config, got: %s", content)
	}
}

func TestPushPendingDeleteToRemote(t *testing.T) {
	repoURL := setupGitRepo(t)

	addCfg := config.DefaultConfig()
	addCfg.PendingImages = append(addCfg.PendingImages, config.Image{
		Source:  "nginx:1.27",
		Target:  "mirror/nginx:1.27",
		Profile: config.DefaultProfile,
		Enabled: config.BoolPtr(true),
	})
	if _, _, _, _, err := pushPendingConfigToRemote(repoURL, "main", "main", "mirrorpilot.yaml", addCfg, pushConfigOptions{
		Message:     "test: add before delete",
		AuthorName:  "tester",
		AuthorEmail: "tester@example.com",
	}); err != nil {
		t.Fatalf("prepare add failed: %v", err)
	}

	delCfg := config.DefaultConfig()
	delCfg.PendingDeletes = append(delCfg.PendingDeletes, config.PendingDelete{
		Source:  "nginx:1.27",
		Target:  "mirror/nginx:1.27",
		Profile: config.DefaultProfile,
	})
	changed, deleted, added, updated, err := pushPendingConfigToRemote(repoURL, "main", "main", "mirrorpilot.yaml", delCfg, pushConfigOptions{
		Message:     "test: delete staged entry",
		AuthorName:  "tester",
		AuthorEmail: "tester@example.com",
	})
	if err != nil {
		t.Fatalf("push delete failed: %v", err)
	}
	if !changed {
		t.Fatalf("expected remote config to change on delete")
	}
	if deleted != 1 || added != 0 || updated != 0 {
		t.Fatalf("unexpected delete merge counts deleted=%d added=%d updated=%d", deleted, added, updated)
	}

	readDir := t.TempDir()
	runGitCommand(t, "", "clone", "--depth", "1", "--branch", "main", repoURL, readDir)
	b, err := os.ReadFile(filepath.Join(readDir, "mirrorpilot.yaml"))
	if err != nil {
		t.Fatalf("read pushed config: %v", err)
	}
	content := string(b)
	if strings.Contains(content, "nginx:1.27") {
		t.Fatalf("expected pushed config to remove image, got: %s", content)
	}
	if strings.Contains(content, "pending_deletes:") {
		t.Fatalf("expected pending_deletes to be cleared in remote config, got: %s", content)
	}
}

func TestBuildFullTarget(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Profiles["extra"] = config.RegistryProfile{
		Registry:    "registry.example.com/team",
		UsernameEnv: "U",
		PasswordEnv: "P",
	}
	if got := buildFullTarget(cfg, "extra", "app/image:1.0"); got != "registry.example.com/team/app/image:1.0" {
		t.Fatalf("unexpected full target: %s", got)
	}
}

func TestMergeRemoteIntoLocal_UpdatesExistingProfile(t *testing.T) {
	local := config.DefaultConfig()
	local.Profiles[config.DefaultProfile] = config.RegistryProfile{
		Registry:    "registry.example.com/namespace",
		UsernameEnv: "DEST_REGISTRY_USER",
		PasswordEnv: "DEST_REGISTRY_PASSWORD",
	}
	remote := config.DefaultConfig()
	remote.Profiles[config.DefaultProfile] = config.RegistryProfile{
		Registry:    "crpi-a01fov5fxhl285uu.cn-shanghai.personal.cr.aliyuncs.com/warjiang",
		UsernameEnv: "DEST_REGISTRY_USER",
		PasswordEnv: "DEST_REGISTRY_PASSWORD",
	}

	_, _, added, updated := mergeRemoteIntoLocal(&local, remote)
	if added != 0 {
		t.Fatalf("expected no profile added, got %d", added)
	}
	if updated != 1 {
		t.Fatalf("expected profile updated=1, got %d", updated)
	}
	if got := local.Profiles[config.DefaultProfile].Registry; got != remote.Profiles[config.DefaultProfile].Registry {
		t.Fatalf("expected registry synced from remote, got %s", got)
	}
}

func TestForceRemoteIntoLocal_ReplacesAllLocalFields(t *testing.T) {
	local := config.DefaultConfig()
	local.Images = []config.Image{
		{Source: "local:1", Target: "local:1", Profile: config.DefaultProfile, Enabled: config.BoolPtr(true)},
	}
	local.PendingImages = []config.Image{
		{Source: "pending:1", Target: "pending:1", Profile: config.DefaultProfile, Enabled: config.BoolPtr(true)},
	}
	local.PendingDeletes = []config.PendingDelete{
		{Source: "del:1", Target: "del:1", Profile: config.DefaultProfile},
	}

	remote := config.DefaultConfig()
	remote.Profiles[config.DefaultProfile] = config.RegistryProfile{
		Registry:    "registry.remote.example.com/ns",
		UsernameEnv: "REMOTE_USER",
		PasswordEnv: "REMOTE_PASS",
	}
	remote.Images = []config.Image{
		{Source: "remote:1", Target: "remote:1", Profile: config.DefaultProfile, Enabled: config.BoolPtr(true)},
	}
	remote.PendingImages = nil
	remote.PendingDeletes = nil

	forceRemoteIntoLocal(&local, remote)

	if len(local.Images) != 1 || local.Images[0].Source != "remote:1" {
		t.Fatalf("expected local images replaced by remote images, got %+v", local.Images)
	}
	if len(local.PendingImages) != 0 {
		t.Fatalf("expected pending_images replaced by remote, got %d", len(local.PendingImages))
	}
	if len(local.PendingDeletes) != 0 {
		t.Fatalf("expected pending_deletes replaced by remote, got %d", len(local.PendingDeletes))
	}
	if got := local.Profiles[config.DefaultProfile].Registry; got != "registry.remote.example.com/ns" {
		t.Fatalf("expected profile registry from remote, got %s", got)
	}
}

func setupGitRepo(t *testing.T) string {
	t.Helper()
	base := t.TempDir()
	bareRepo := filepath.Join(base, "remote.git")
	workDir := filepath.Join(base, "work")
	runGitCommand(t, "", "init", "--bare", bareRepo)
	runGitCommand(t, "", "clone", bareRepo, workDir)
	runGitCommand(t, workDir, "checkout", "-b", "main")
	runGitCommand(t, workDir, "config", "user.name", "tester")
	runGitCommand(t, workDir, "config", "user.email", "tester@example.com")
	initial := []byte("version: v1\nprofiles:\n  default:\n    registry: registry.example.com/ns\n    username_env: DEST_REGISTRY_USER\n    password_env: DEST_REGISTRY_PASSWORD\nimages: []\n")
	if err := os.WriteFile(filepath.Join(workDir, "mirrorpilot.yaml"), initial, 0644); err != nil {
		t.Fatalf("write initial config: %v", err)
	}
	runGitCommand(t, workDir, "add", "mirrorpilot.yaml")
	runGitCommand(t, workDir, "commit", "-m", "init")
	runGitCommand(t, workDir, "push", "-u", "origin", "main")
	return bareRepo
}

func runGitCommand(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v (%s)", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
}
