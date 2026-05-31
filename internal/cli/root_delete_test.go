package cli

import (
	"path/filepath"
	"testing"

	"github.com/warjiang/MirrorPilot/internal/config"
)

func TestDeleteStagesPendingDelete(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "mirrorpilot.yaml")
	lc := config.LoadedConfig{
		Path: cfgPath,
		Config: config.Config{
			Version: "v1",
			Remote: config.RemoteConfig{
				RepoURL:    "git@github.com:warjiang/MirrorPilot.git",
				Ref:        "main",
				ConfigPath: "mirrorpilot.yaml",
			},
			Profiles: config.DefaultConfig().Profiles,
			Images: []config.Image{
				{
					Source:  "curlimages/curl:8.8.0",
					Target:  "curlimages-curl:8.8.0",
					Profile: config.DefaultProfile,
					Enabled: config.BoolPtr(true),
				},
			},
		},
	}
	if err := lc.Save(); err != nil {
		t.Fatalf("save initial config: %v", err)
	}

	cmd := NewRootCmd()
	cmd.SetArgs([]string{
		"--config", cfgPath,
		"delete",
		"--source", "curlimages/curl:8.8.0",
		"--target", "curlimages-curl:8.8.0",
	})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute delete: %v", err)
	}

	updated, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("load updated config: %v", err)
	}
	if len(updated.Config.Images) != 1 {
		t.Fatalf("expected committed images unchanged before push, got %d", len(updated.Config.Images))
	}
	if len(updated.Config.PendingDeletes) != 1 {
		t.Fatalf("expected one pending delete, got %d", len(updated.Config.PendingDeletes))
	}
}

func TestDeleteCancelsPendingAdd(t *testing.T) {
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
	lc.Config.PendingImages = []config.Image{
		{
			Source:  "curlimages/curl:8.8.0",
			Target:  "curlimages-curl:8.8.0",
			Profile: config.DefaultProfile,
			Enabled: config.BoolPtr(true),
		},
	}
	if err := lc.Save(); err != nil {
		t.Fatalf("save initial config: %v", err)
	}

	cmd := NewRootCmd()
	cmd.SetArgs([]string{
		"--config", cfgPath,
		"delete",
		"--source", "curlimages/curl:8.8.0",
		"--target", "curlimages-curl:8.8.0",
	})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute delete: %v", err)
	}

	updated, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("load updated config: %v", err)
	}
	if len(updated.Config.PendingImages) != 0 {
		t.Fatalf("expected pending add canceled, got %d", len(updated.Config.PendingImages))
	}
	if len(updated.Config.PendingDeletes) != 0 {
		t.Fatalf("expected no pending delete when only staged add existed, got %d", len(updated.Config.PendingDeletes))
	}
}
