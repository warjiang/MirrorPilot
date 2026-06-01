package cli

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	repoSegmentPattern  = regexp.MustCompile(`^[a-z0-9]+(?:[._-][a-z0-9]+)*$`)
	registryHostPattern = regexp.MustCompile(`^(?:localhost|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::[0-9]+)?$`)
	tagPattern          = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$`)
	digestPattern       = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9]*(?:[+._-][A-Za-z][A-Za-z0-9]*)*:[0-9a-fA-F]{32,}$`)
)

func validateImageReference(flagName, raw string) error {
	ref := strings.TrimSpace(raw)
	if ref == "" {
		return fmt.Errorf("%s cannot be empty", flagName)
	}
	if strings.Contains(ref, "://") {
		return fmt.Errorf("%s must be a container image reference (without scheme), got %q", flagName, raw)
	}

	namePart := ref
	if at := strings.Index(ref, "@"); at >= 0 {
		digest := ref[at+1:]
		if digest == "" || !digestPattern.MatchString(digest) {
			return fmt.Errorf("%s has invalid digest in %q", flagName, raw)
		}
		namePart = ref[:at]
	}

	lastSlash := strings.LastIndex(namePart, "/")
	lastColon := strings.LastIndex(namePart, ":")
	if lastColon > lastSlash {
		tag := namePart[lastColon+1:]
		if !tagPattern.MatchString(tag) {
			return fmt.Errorf("%s has invalid tag in %q", flagName, raw)
		}
		namePart = namePart[:lastColon]
	}

	parts := splitNonEmpty(namePart, "/")
	if len(parts) == 0 {
		return fmt.Errorf("%s has invalid image name %q", flagName, raw)
	}
	if len(parts) == 1 && looksLikeRegistryHost(parts[0]) {
		return fmt.Errorf("%s has invalid image repository in %q", flagName, raw)
	}
	start := 0
	if len(parts) > 1 && looksLikeRegistryHost(parts[0]) {
		if !registryHostPattern.MatchString(parts[0]) {
			return fmt.Errorf("%s has invalid registry host in %q", flagName, raw)
		}
		start = 1
	}
	if start >= len(parts) {
		return fmt.Errorf("%s has invalid image repository in %q", flagName, raw)
	}
	for _, seg := range parts[start:] {
		if !repoSegmentPattern.MatchString(seg) {
			return fmt.Errorf("%s has invalid repository segment %q in %q", flagName, seg, raw)
		}
	}
	return nil
}
