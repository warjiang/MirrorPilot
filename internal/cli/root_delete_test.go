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
	if len(updated.Config.PendingChanges) != 1 {
		t.Fatalf("expected one pending delete change, got %d", len(updated.Config.PendingChanges))
	}
	if got := updated.Config.PendingChanges[0].Action; got != config.PendingActionDelete {
		t.Fatalf("expected pending action delete, got %q", got)
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
	lc.Config.PendingChanges = []config.PendingChange{
		{
			Action:  config.PendingActionAdd,
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
	if len(updated.Config.PendingChanges) != 0 {
		t.Fatalf("expected pending add canceled with no net change, got %d", len(updated.Config.PendingChanges))
	}
}

func TestDeleteCancelsPendingAddWithoutStagingCommittedDelete(t *testing.T) {
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
	lc.Config.Images = []config.Image{
		{
			Source:  "curlimages/curl:8.8.0",
			Target:  "curlimages-curl:8.8.0",
			Profile: config.DefaultProfile,
			Enabled: config.BoolPtr(true),
		},
	}
	lc.Config.PendingChanges = []config.PendingChange{
		{
			Action:  config.PendingActionAdd,
			Source:  "curlimages/curl:8.8.0",
			Target:  "curlimages/curl:8.8.0",
			Profile: config.DefaultProfile,
			Enabled: config.BoolPtr(true),
		},
	}
	if err := lc.Save(); err != nil {
		t.Fatalf("save initial config: %v", err)
	}

	cmd := NewRootCmd()
	cmd.SetArgs([]string{"--config", cfgPath, "delete", "--source", "curlimages/curl:8.8.0"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute delete: %v", err)
	}

	updated, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("load updated config: %v", err)
	}
	if len(updated.Config.PendingChanges) != 0 {
		t.Fatalf("expected delete to only cancel staged add, got %d pending changes", len(updated.Config.PendingChanges))
	}
}

func TestDeleteCancelsPendingAddBySourceOnly(t *testing.T) {
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
			Action:  config.PendingActionAdd,
			Source:  "curlimages/curl:8.8.0",
			Target:  "curlimages/curl:8.8.0",
			Profile: config.DefaultProfile,
			Enabled: config.BoolPtr(true),
		},
	}
	if err := lc.Save(); err != nil {
		t.Fatalf("save initial config: %v", err)
	}

	cmd := NewRootCmd()
	cmd.SetArgs([]string{"--config", cfgPath, "delete", "--source", "curlimages/curl:8.8.0"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute delete: %v", err)
	}

	updated, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("load updated config: %v", err)
	}
	if len(updated.Config.PendingChanges) != 0 {
		t.Fatalf("expected source-only delete to cancel pending add, got %d", len(updated.Config.PendingChanges))
	}
}

func TestDeleteCancelsPendingAddUsingDerivedTargetFallback(t *testing.T) {
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
			Action:  config.PendingActionAdd,
			Source:  "ghcr.io/org/team/app:1.0.0",
			Target:  "team-app:1.0.0",
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
		"--source", "ghcr.io/org/team/app:1.0.0",
		"--target", "org/team/app:1.0.0",
	})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute delete: %v", err)
	}

	updated, err := config.Load(cfgPath)
	if err != nil {
		t.Fatalf("load updated config: %v", err)
	}
	if len(updated.Config.PendingChanges) != 0 {
		t.Fatalf("expected derived-target fallback to cancel pending add, got %d", len(updated.Config.PendingChanges))
	}
}
