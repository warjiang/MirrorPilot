package cli

import (
	"testing"

	"github.com/warjiang/MirrorPilot/internal/config"
)

func TestEnsureRemoteConfigured(t *testing.T) {
	cfg := config.DefaultConfig()
	if err := ensureRemoteConfigured(cfg); err == nil {
		t.Fatalf("expected error when remote is not configured")
	}

	cfg.Remote.RepoURL = "https://github.com/example/repo.git"
	if err := ensureRemoteConfigured(cfg); err != nil {
		t.Fatalf("expected no error when remote is configured, got: %v", err)
	}
}
