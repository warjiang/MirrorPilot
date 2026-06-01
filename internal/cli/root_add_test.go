package cli

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/warjiang/MirrorPilot/internal/config"
)

func TestAddDoesNotWriteCreatedAt(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "mirrorpilot.yaml")
	lc := config.LoadedConfig{
		Path:   cfgPath,
		Config: config.DefaultConfig(),
	}
	lc.Config.Remote = config.RemoteConfig{
		RepoURL:    "git@github.com:warjiang/MirrorPilot.git",
		Ref:        "main",
		ConfigPath: "mirrorpilot.yaml",
	}
	if err := lc.Save(); err != nil {
		t.Fatalf("save initial config: %v", err)
	}

	cmd := NewRootCmd()
	cmd.SetArgs([]string{"--config", cfgPath, "add", "--source", "curlimages/curl:8.8.0"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute add: %v", err)
	}

	updated, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("load updated config: %v", err)
	}
	if len(updated.Config.Images) != 0 {
		t.Fatalf("expected committed images to stay empty, got %d", len(updated.Config.Images))
	}
	if len(updated.Config.PendingChanges) != 1 {
		t.Fatalf("expected one pending change, got %d", len(updated.Config.PendingChanges))
	}
	if got := updated.Config.PendingChanges[0].Target; got != "curlimages/curl:8.8.0" {
		t.Fatalf("expected auto target from source, got %q", got)
	}
	if got := updated.Config.PendingChanges[0].Action; got != config.PendingActionAdd {
		t.Fatalf("expected pending action add, got %q", got)
	}
}

func TestAddUsesDerivedTargetForMultiSegmentSource(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "mirrorpilot.yaml")
	lc := config.LoadedConfig{Path: cfgPath, Config: config.DefaultConfig()}
	lc.Config.Remote = config.RemoteConfig{
		RepoURL:    "git@github.com:warjiang/MirrorPilot.git",
		Ref:        "main",
		ConfigPath: "mirrorpilot.yaml",
	}
	if err := lc.Save(); err != nil {
		t.Fatalf("save initial config: %v", err)
	}

	cmd := NewRootCmd()
	cmd.SetArgs([]string{
		"--config", cfgPath,
		"add",
		"--source", "ghcr.io/org/team/app:1.0.0",
	})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute add: %v", err)
	}

	updated, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("load updated config: %v", err)
	}
	if len(updated.Config.PendingChanges) != 1 {
		t.Fatalf("expected one pending change, got %d", len(updated.Config.PendingChanges))
	}
	if got := updated.Config.PendingChanges[0].Target; got != "team-app:1.0.0" {
		t.Fatalf("expected derived target team-app:1.0.0, got %q", got)
	}
}

func TestAddWithExplicitTargetStillWins(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "mirrorpilot.yaml")
	lc := config.LoadedConfig{Path: cfgPath, Config: config.DefaultConfig()}
	lc.Config.Remote = config.RemoteConfig{
		RepoURL:    "git@github.com:warjiang/MirrorPilot.git",
		Ref:        "main",
		ConfigPath: "mirrorpilot.yaml",
	}
	if err := lc.Save(); err != nil {
		t.Fatalf("save initial config: %v", err)
	}

	cmd := NewRootCmd()
	cmd.SetArgs([]string{
		"--config", cfgPath,
		"add",
		"--source", "ghcr.io/org/team/app:1.0.0",
		"--target", "custom/name:1.0.0",
	})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute add: %v", err)
	}

	updated, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("load updated config: %v", err)
	}
	if got := updated.Config.PendingChanges[0].Target; got != "custom/name:1.0.0" {
		t.Fatalf("expected explicit target to win, got %q", got)
	}
}

func TestAddClearsMatchingPendingDelete(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "mirrorpilot.yaml")
	lc := config.LoadedConfig{
		Path:   cfgPath,
		Config: config.DefaultConfig(),
	}
	lc.Config.Remote = config.RemoteConfig{
		RepoURL:    "git@github.com:warjiang/MirrorPilot.git",
		Ref:        "main",
		ConfigPath: "mirrorpilot.yaml",
	}
	lc.Config.PendingChanges = []config.PendingChange{
		{
			Action:  config.PendingActionDelete,
			Source:  "curlimages/curl:8.8.0",
			Target:  "curlimages-curl:8.8.0",
			Profile: config.DefaultProfile,
		},
	}
	if err := lc.Save(); err != nil {
		t.Fatalf("save initial config: %v", err)
	}

	cmd := NewRootCmd()
	cmd.SetArgs([]string{
		"--config", cfgPath,
		"add",
		"--source", "curlimages/curl:8.8.0",
		"--target", "curlimages-curl:8.8.0",
	})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute add: %v", err)
	}

	updated, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("load updated config: %v", err)
	}
	if len(updated.Config.PendingChanges) != 1 {
		t.Fatalf("expected only new staged add pending change, got %d", len(updated.Config.PendingChanges))
	}
	if updated.Config.PendingChanges[0].Action != config.PendingActionAdd {
		t.Fatalf("expected remaining pending change to be add, got %q", updated.Config.PendingChanges[0].Action)
	}
}

func TestAddRejectsInvalidSource(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "mirrorpilot.yaml")
	lc := config.LoadedConfig{Path: cfgPath, Config: config.DefaultConfig()}
	lc.Config.Remote = config.RemoteConfig{
		RepoURL:    "git@github.com:warjiang/MirrorPilot.git",
		Ref:        "main",
		ConfigPath: "mirrorpilot.yaml",
	}
	if err := lc.Save(); err != nil {
		t.Fatalf("save initial config: %v", err)
	}

	cmd := NewRootCmd()
	cmd.SetArgs([]string{"--config", cfgPath, "add", "--source", "https://docker.io/library/nginx:latest"})
	err := cmd.Execute()
	if err == nil {
		t.Fatalf("expected add to fail for invalid source")
	}
	if !strings.Contains(err.Error(), "--source") {
		t.Fatalf("expected source validation error, got: %v", err)
	}
}

func TestAddRejectsInvalidExplicitTarget(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "mirrorpilot.yaml")
	lc := config.LoadedConfig{Path: cfgPath, Config: config.DefaultConfig()}
	lc.Config.Remote = config.RemoteConfig{
		RepoURL:    "git@github.com:warjiang/MirrorPilot.git",
		Ref:        "main",
		ConfigPath: "mirrorpilot.yaml",
	}
	if err := lc.Save(); err != nil {
		t.Fatalf("save initial config: %v", err)
	}

	cmd := NewRootCmd()
	cmd.SetArgs([]string{
		"--config", cfgPath,
		"add",
		"--source", "curlimages/curl:8.8.0",
		"--target", "bad target:1.0",
	})
	err := cmd.Execute()
	if err == nil {
		t.Fatalf("expected add to fail for invalid target")
	}
	if !strings.Contains(err.Error(), "--target") {
		t.Fatalf("expected target validation error, got: %v", err)
	}
}
