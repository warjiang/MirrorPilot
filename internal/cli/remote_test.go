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

func TestCheckRemoteReadAndWrite(t *testing.T) {
	repoURL := setupGitRepo(t)
	if err := checkRemoteRead(repoURL, "main"); err != nil {
		t.Fatalf("check remote read failed: %v", err)
	}
	if err := checkRemoteWrite(repoURL, "main", "mirrorpilot-probe"); err != nil {
		t.Fatalf("check remote write failed: %v", err)
	}
}

func TestPushConfigToRemote(t *testing.T) {
	repoURL := setupGitRepo(t)

	cfg := config.DefaultConfig()
	cfg.Images = append(cfg.Images, config.Image{
		Source:  "nginx:1.27",
		Target:  "mirror/nginx:1.27",
		Profile: config.DefaultProfile,
		Enabled: config.BoolPtr(true),
	})

	changed, err := pushConfigToRemote(repoURL, "main", "main", "mirrorpilot.yaml", cfg, pushConfigOptions{
		DryRun:      false,
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
