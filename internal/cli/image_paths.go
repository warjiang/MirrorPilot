package cli

import (
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
	return strings.TrimRight(strings.TrimSpace(profileCfg.Registry), "/")
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
