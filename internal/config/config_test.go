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
