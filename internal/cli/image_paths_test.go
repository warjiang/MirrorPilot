package cli

import (
	"testing"

	"github.com/warjiang/MirrorPilot/internal/config"
)

func TestResolveRegistryForProfile_UsesConfigOnly(t *testing.T) {
	cfg := config.DefaultConfig()
	cfg.Profiles[config.DefaultProfile] = config.RegistryProfile{
		Registry:    "registry.example.com/ns",
		UsernameEnv: "U",
		PasswordEnv: "P",
	}
	t.Setenv("DEST_REGISTRY", "registry.env.example.com/override")

	got := resolveRegistryForProfile(cfg, config.DefaultProfile)
	if got != "registry.example.com/ns" {
		t.Fatalf("expected config registry, got %s", got)
	}
}
