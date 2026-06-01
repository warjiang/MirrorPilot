package cli

import "testing"

func TestValidateImageReference(t *testing.T) {
	valid := []string{
		"curlimages/curl:8.8.0",
		"ghcr.io/org/team/app:1.0.0",
		"team/app:1.0.0",
		"app:1.0.0",
		"ghcr.io/org/app@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
	}
	for _, ref := range valid {
		if err := validateImageReference("--source", ref); err != nil {
			t.Fatalf("expected valid ref %q, got error: %v", ref, err)
		}
	}

	invalid := []string{
		"https://docker.io/library/nginx:latest",
		"bad space/image:1.0",
		"ghcr.io/org/BadName:1.0",
		"ghcr.io/org/app:bad*tag",
		"ghcr.io:443",
	}
	for _, ref := range invalid {
		if err := validateImageReference("--source", ref); err == nil {
			t.Fatalf("expected invalid ref %q to fail", ref)
		}
	}
}
