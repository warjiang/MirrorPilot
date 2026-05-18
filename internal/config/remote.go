package config

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func LoadRemoteConfig(repoURL, ref, configPath string) (Config, string, error) {
	repoURL = strings.TrimSpace(repoURL)
	if repoURL == "" {
		return Config{}, "", fmt.Errorf("remote repo url is required")
	}

	tmpDir, err := os.MkdirTemp("", "mirrorpilot-remote-*")
	if err != nil {
		return Config{}, "", fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	cloneArgs := []string{"clone", "--depth", "1"}
	if strings.TrimSpace(ref) != "" {
		cloneArgs = append(cloneArgs, "--branch", ref)
	}
	cloneArgs = append(cloneArgs, repoURL, tmpDir)
	if out, err := exec.Command("git", cloneArgs...).CombinedOutput(); err != nil {
		return Config{}, "", fmt.Errorf("clone remote repo: %w (%s)", err, strings.TrimSpace(string(out)))
	}

	candidates := []string{}
	if strings.TrimSpace(configPath) != "" {
		candidates = append(candidates, configPath)
	} else {
		candidates = append(candidates, DefaultConfigPath, LegacyConfigPath, LegacyListPath)
	}

	for _, p := range candidates {
		abs := filepath.Join(tmpDir, p)
		if _, err := os.Stat(abs); err != nil {
			continue
		}
		if p == LegacyListPath {
			cfg, err := loadLegacy(abs)
			if err != nil {
				return Config{}, "", err
			}
			cfg = Normalize(cfg)
			return cfg, p, nil
		}
		cfg, err := loadYAML(abs)
		if err != nil {
			return Config{}, "", err
		}
		return cfg, p, nil
	}

	return Config{}, "", fmt.Errorf("no supported config file found in remote repo; tried: %s", strings.Join(candidates, ", "))
}
