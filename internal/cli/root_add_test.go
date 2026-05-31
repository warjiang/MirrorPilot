package cli

import (
	"path/filepath"
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
	if len(updated.Config.Images) != 0 {
		t.Fatalf("expected committed images to stay empty, got %d", len(updated.Config.Images))
	}
	if len(updated.Config.PendingImages) != 1 {
		t.Fatalf("expected one pending image, got %d", len(updated.Config.PendingImages))
	}
	if got := updated.Config.PendingImages[0].CreatedAt; got != "" {
		t.Fatalf("expected created_at to be omitted, got %q", got)
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
	lc.Config.PendingDeletes = []config.PendingDelete{
		{
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
	if len(updated.Config.PendingDeletes) != 0 {
		t.Fatalf("expected matching pending delete to be cleared, got %d", len(updated.Config.PendingDeletes))
	}
}
