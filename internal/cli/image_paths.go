package cli

import (
	"os"
	"strings"

	"github.com/warjiang/MirrorPilot/internal/config"
)

func resolveRegistryForProfile(cfg config.Config, profile string) string {
	p := strings.TrimSpace(profile)
	if p == "" {
		p = config.DefaultProfile
	}
	profileCfg, ok := cfg.Profiles[p]
	if !ok {
		return ""
	}
	registry := strings.TrimRight(strings.TrimSpace(profileCfg.Registry), "/")
	if p == config.DefaultProfile {
		if envRegistry := strings.TrimSpace(os.Getenv("DEST_REGISTRY")); envRegistry != "" {
			registry = strings.TrimRight(envRegistry, "/")
		}
	}
	return registry
}

func buildFullTarget(cfg config.Config, profile, target string) string {
	registry := resolveRegistryForProfile(cfg, profile)
	t := strings.TrimLeft(strings.TrimSpace(target), "/")
	if registry == "" {
		return t
	}
	if t == "" {
		return registry
	}
	return registry + "/" + t
}

func buildFullSource(source string) string {
	return strings.TrimSpace(source)
}
