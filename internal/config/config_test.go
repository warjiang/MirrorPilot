package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadLegacy(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "images.list")
	content := "\n#nginx:1.27=>mirror/nginx:1.27\nredis:7=>mirror/redis:7\n"
	if err := os.WriteFile(p, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	cfg, err := LoadLegacy(p)
	if err != nil {
		t.Fatalf("load legacy: %v", err)
	}
	if len(cfg.Images) != 2 {
		t.Fatalf("expected 2 images, got %d", len(cfg.Images))
	}
	if cfg.Images[0].EnabledValue() {
		t.Fatalf("first image should be disabled")
	}
	if !cfg.Images[1].EnabledValue() {
		t.Fatalf("second image should be enabled")
	}
}

func TestValidate(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Images = []Image{{
		Source:  "nginx:1.27",
		Target:  "mirror/nginx:1.27",
		Profile: DefaultProfile,
		Enabled: BoolPtr(true),
	}}

	errs := Validate(cfg)
	if len(errs) != 0 {
		t.Fatalf("expected no validation error, got %v", errs)
	}

	cfg.Images = append(cfg.Images, cfg.Images[0])
	errs = Validate(cfg)
	if len(errs) == 0 {
		t.Fatalf("expected duplicate validation error")
	}
}

func TestValidate_AllowsDisabledDuplicates(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Images = []Image{
		{
			Source:  "alpine:latest",
			Target:  "alpine:latest",
			Profile: DefaultProfile,
			Enabled: BoolPtr(true),
		},
		{
			Source:  "alpine:latest",
			Target:  "alpine:latest",
			Profile: DefaultProfile,
			Enabled: BoolPtr(false),
		},
	}

	errs := Validate(cfg)
	if len(errs) != 0 {
		t.Fatalf("expected disabled duplicates to be allowed, got %v", errs)
	}
}

func TestValidate_DetectsDuplicatesAcrossImagesAndPending(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Images = []Image{
		{
			Source:  "alpine:latest",
			Target:  "alpine:latest",
			Profile: DefaultProfile,
			Enabled: BoolPtr(true),
		},
	}

	cfg.PendingImages = []Image{
		{
			Source:  "alpine:latest",
			Target:  "alpine:latest",
			Profile: DefaultProfile,
			Enabled: BoolPtr(true),
		},
	}

	errs := Validate(cfg)
	if len(errs) == 0 {
		t.Fatalf("expected duplicate validation error across images and pending_images")
	}
}

func TestValidateRejectsInvalidPendingDelete(t *testing.T) {
	cfg := DefaultConfig()
	cfg.PendingDeletes = []PendingDelete{
		{Source: "nginx:1.27", Target: "", Profile: DefaultProfile},
	}
	errs := Validate(cfg)
	if len(errs) == 0 {
		t.Fatalf("expected pending_deletes validation error")
	}
}

func TestNormalizeBuildsSyncedImages(t *testing.T) {
	cfg := DefaultConfig()
	cfg.Images = []Image{
		{Source: "nginx:1.27", Target: "mirror/nginx:1.27", Profile: DefaultProfile, Enabled: BoolPtr(true), Synced: true, CreatedAt: "2026-05-17T00:00:00Z", SyncedAt: "2026-05-18T00:00:00Z"},
		{Source: "redis:7", Target: "mirror/redis:7", Profile: DefaultProfile, Enabled: BoolPtr(true), Synced: false},
	}

	norm := Normalize(cfg)
	if len(norm.SyncedImages) != 1 {
		t.Fatalf("expected 1 synced image, got %d", len(norm.SyncedImages))
	}
	if norm.SyncedImages[0].Source != "nginx:1.27" {
		t.Fatalf("unexpected synced image source: %s", norm.SyncedImages[0].Source)
	}
	if norm.SyncedImages[0].SyncedAt != "2026-05-18T00:00:00Z" {
		t.Fatalf("unexpected synced_at: %s", norm.SyncedImages[0].SyncedAt)
	}
}

func TestLoad_UsesDefaultHomeConfigPath(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	configDir := filepath.Join(home, ".mirrorpilot")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(configDir, "mirrorpilot.yaml")
	content := `
version: v1
profiles:
  default:
    registry: registry.example.com/ns
    username_env: DEST_REGISTRY_USER
    password_env: DEST_REGISTRY_PASSWORD
images:
  - source: nginx:1.27
    target: mirror/nginx:1.27
    profile: default
    enabled: true
`
	if err := os.WriteFile(configPath, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	lc, err := Load("")
	if err != nil {
		t.Fatalf("load default home config: %v", err)
	}
	if lc.Path != configPath {
		t.Fatalf("expected path %s, got %s", configPath, lc.Path)
	}
	if len(lc.Config.Images) != 1 {
		t.Fatalf("expected 1 image, got %d", len(lc.Config.Images))
	}
}

func TestLoad_DoesNotFallbackToLegacyWhenDefaultMissing(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	workDir := t.TempDir()
	oldWd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = os.Chdir(oldWd) }()
	if err := os.Chdir(workDir); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(workDir, LegacyConfigPath), []byte("version: v1\nimages: []\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workDir, LegacyListPath), []byte("nginx:1.27=>mirror/nginx:1.27\n"), 0644); err != nil {
		t.Fatal(err)
	}

	lc, err := Load("")
	if err != nil {
		t.Fatalf("load default config: %v", err)
	}
	expectedPath := filepath.Join(home, ".mirrorpilot", DefaultConfigPath)
	if lc.Path != expectedPath {
		t.Fatalf("expected path %s, got %s", expectedPath, lc.Path)
	}
	if len(lc.Config.Images) != 0 {
		t.Fatalf("expected default config with 0 images, got %d", len(lc.Config.Images))
	}
}

func TestLoadedConfigSave_CreatesParentDir(t *testing.T) {
	base := t.TempDir()
	path := filepath.Join(base, ".mirrorpilot", "mirrorpilot.yaml")
	lc := LoadedConfig{
		Path:   path,
		Config: DefaultConfig(),
	}
	if err := lc.Save(); err != nil {
		t.Fatalf("save config: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected saved file at %s: %v", path, err)
	}
}
