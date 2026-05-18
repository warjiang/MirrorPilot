package config

import (
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

const (
	DefaultConfigPath = "sync-images.yaml"
	LegacyListPath    = "images.list"
	DefaultProfile    = "default"
)

type Config struct {
	Version  string                     `yaml:"version"`
	Profiles map[string]RegistryProfile `yaml:"profiles"`
	Images   []Image                    `yaml:"images"`
}

type RegistryProfile struct {
	Registry    string `yaml:"registry"`
	UsernameEnv string `yaml:"username_env"`
	PasswordEnv string `yaml:"password_env"`
}

type Image struct {
	Source       string `yaml:"source"`
	Target       string `yaml:"target"`
	Profile      string `yaml:"profile,omitempty"`
	Enabled      *bool  `yaml:"enabled,omitempty"`
	Synced       bool   `yaml:"synced,omitempty"`
	LastSyncedAt string `yaml:"last_synced_at,omitempty"`
	Notes        string `yaml:"notes,omitempty"`
}

func (i Image) EnabledValue() bool {
	if i.Enabled == nil {
		return true
	}
	return *i.Enabled
}

func BoolPtr(v bool) *bool { return &v }

type LoadedConfig struct {
	Path       string
	FromLegacy bool
	Config     Config
}

func DefaultConfig() Config {
	return Config{
		Version: "v1",
		Profiles: map[string]RegistryProfile{
			DefaultProfile: {
				Registry:    "registry.example.com/namespace",
				UsernameEnv: "DEST_REGISTRY_USER",
				PasswordEnv: "DEST_REGISTRY_PASSWORD",
			},
		},
		Images: []Image{},
	}
}

func Load(configPath string) (LoadedConfig, error) {
	if configPath == "" {
		configPath = DefaultConfigPath
	}

	if _, err := os.Stat(configPath); err == nil {
		cfg, err := loadYAML(configPath)
		if err != nil {
			return LoadedConfig{}, err
		}
		return LoadedConfig{Path: configPath, Config: cfg}, nil
	}

	legacyPath := LegacyListPath
	if _, err := os.Stat(legacyPath); err == nil {
		cfg, err := loadLegacy(legacyPath)
		if err != nil {
			return LoadedConfig{}, err
		}
		return LoadedConfig{Path: configPath, FromLegacy: true, Config: cfg}, nil
	}

	return LoadedConfig{Path: configPath, Config: DefaultConfig()}, nil
}

func LoadYAML(configPath string) (LoadedConfig, error) {
	cfg, err := loadYAML(configPath)
	if err != nil {
		return LoadedConfig{}, err
	}
	return LoadedConfig{Path: configPath, Config: cfg}, nil
}

func LoadLegacy(path string) (Config, error) { return loadLegacy(path) }

func (lc LoadedConfig) Save() error {
	cfg := Normalize(lc.Config)
	data, err := yaml.Marshal(&cfg)
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	return os.WriteFile(lc.Path, data, 0644)
}

func Normalize(cfg Config) Config {
	if cfg.Version == "" {
		cfg.Version = "v1"
	}
	if len(cfg.Profiles) == 0 {
		d := DefaultConfig()
		cfg.Profiles = d.Profiles
	}
	for i := range cfg.Images {
		if cfg.Images[i].Profile == "" {
			cfg.Images[i].Profile = DefaultProfile
		}
		if cfg.Images[i].Enabled == nil {
			cfg.Images[i].Enabled = BoolPtr(true)
		}
	}
	return cfg
}

func EnsureDefaultProfile(cfg *Config) {
	if len(cfg.Profiles) == 0 {
		cfg.Profiles = DefaultConfig().Profiles
	}
	if _, ok := cfg.Profiles[DefaultProfile]; !ok {
		cfg.Profiles[DefaultProfile] = DefaultConfig().Profiles[DefaultProfile]
	}
}

func Validate(cfg Config) []error {
	cfg = Normalize(cfg)
	var errs []error
	if cfg.Version != "v1" {
		errs = append(errs, fmt.Errorf("unsupported version %q", cfg.Version))
	}
	if len(cfg.Profiles) == 0 {
		errs = append(errs, errors.New("profiles must not be empty"))
	}

	profileNames := make([]string, 0, len(cfg.Profiles))
	for name, p := range cfg.Profiles {
		profileNames = append(profileNames, name)
		if strings.TrimSpace(p.Registry) == "" {
			errs = append(errs, fmt.Errorf("profile %q has empty registry", name))
		}
		if strings.TrimSpace(p.UsernameEnv) == "" {
			errs = append(errs, fmt.Errorf("profile %q has empty username_env", name))
		}
		if strings.TrimSpace(p.PasswordEnv) == "" {
			errs = append(errs, fmt.Errorf("profile %q has empty password_env", name))
		}
	}
	sort.Strings(profileNames)

	seen := map[string]struct{}{}
	for idx, img := range cfg.Images {
		if strings.TrimSpace(img.Source) == "" {
			errs = append(errs, fmt.Errorf("images[%d] has empty source", idx))
		}
		if strings.TrimSpace(img.Target) == "" {
			errs = append(errs, fmt.Errorf("images[%d] has empty target", idx))
		}
		if img.Profile == "" {
			img.Profile = DefaultProfile
		}
		if _, ok := cfg.Profiles[img.Profile]; !ok {
			errs = append(errs, fmt.Errorf("images[%d] references missing profile %q", idx, img.Profile))
		}
		key := img.Profile + "|" + img.Source + "|" + img.Target
		if _, ok := seen[key]; ok {
			errs = append(errs, fmt.Errorf("duplicate image entry %q", key))
		}
		seen[key] = struct{}{}

		if img.LastSyncedAt != "" {
			if _, err := time.Parse(time.RFC3339, img.LastSyncedAt); err != nil {
				errs = append(errs, fmt.Errorf("images[%d] has invalid last_synced_at %q", idx, img.LastSyncedAt))
			}
		}
	}
	return errs
}

func loadYAML(path string) (Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("read %s: %w", path, err)
	}
	var cfg Config
	if err := yaml.Unmarshal(b, &cfg); err != nil {
		return Config{}, fmt.Errorf("parse %s: %w", path, err)
	}
	cfg = Normalize(cfg)
	return cfg, nil
}

func loadLegacy(path string) (Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("read %s: %w", path, err)
	}
	lines := strings.Split(string(b), "\n")
	cfg := DefaultConfig()
	cfg.Images = make([]Image, 0, len(lines))

	for idx, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		enabled := true
		if strings.HasPrefix(line, "#") {
			enabled = false
			line = strings.TrimSpace(strings.TrimPrefix(line, "#"))
		}
		if line == "" {
			continue
		}

		parts := strings.SplitN(line, "=>", 2)
		if len(parts) != 2 {
			return Config{}, fmt.Errorf("invalid legacy format at line %d: %q", idx+1, raw)
		}
		source := strings.TrimSpace(parts[0])
		target := strings.TrimSpace(parts[1])
		if source == "" || target == "" {
			return Config{}, fmt.Errorf("invalid legacy image mapping at line %d: %q", idx+1, raw)
		}

		cfg.Images = append(cfg.Images, Image{
			Source:  source,
			Target:  target,
			Profile: DefaultProfile,
			Enabled: BoolPtr(enabled),
		})
	}
	return cfg, nil
}
