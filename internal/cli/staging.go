package cli

import (
	"strings"

	"github.com/warjiang/MirrorPilot/internal/config"
)

func normalizedProfile(profile string) string {
	if profile == "" {
		return config.DefaultProfile
	}
	return profile
}

func imageKey(profile, source, target string) string {
	return normalizedProfile(profile) + "|" + source + "|" + target
}

func pendingChangeKey(item config.PendingChange) string {
	return imageKey(item.Profile, item.Source, item.Target)
}

func imageMatchesFilter(img config.Image, source, target, profile string) bool {
	if img.Source != source {
		return false
	}
	if target != "" && img.Target != target {
		return false
	}
	if profile != "" && normalizedProfile(img.Profile) != profile {
		return false
	}
	return true
}

func matchesStagedAddForDelete(img config.Image, source, target, profile string) bool {
	if imageMatchesFilter(img, source, target, profile) {
		return true
	}
	if strings.TrimSpace(target) == "" {
		return false
	}
	derived := defaultTargetFromSource(source)
	if derived == "" || derived == target {
		return false
	}
	return imageMatchesFilter(img, source, derived, profile)
}

func pendingChangeMatchesFilter(ch config.PendingChange, source, target, profile string) bool {
	if ch.Source != source {
		return false
	}
	if target != "" && ch.Target != target {
		return false
	}
	if profile != "" && normalizedProfile(ch.Profile) != profile {
		return false
	}
	return true
}

func matchesStagedAddChangeForDelete(ch config.PendingChange, source, target, profile string) bool {
	if pendingChangeMatchesFilter(ch, source, target, profile) {
		return true
	}
	if strings.TrimSpace(target) == "" {
		return false
	}
	derived := defaultTargetFromSource(source)
	if derived == "" || derived == target {
		return false
	}
	return pendingChangeMatchesFilter(ch, source, derived, profile)
}

func splitPendingChanges(items []config.PendingChange) ([]config.Image, []config.PendingChange) {
	adds := make([]config.Image, 0, len(items))
	deletes := make([]config.PendingChange, 0, len(items))
	for _, ch := range items {
		switch strings.ToLower(strings.TrimSpace(ch.Action)) {
		case config.PendingActionAdd:
			img := config.Image{
				Source:  ch.Source,
				Target:  ch.Target,
				Profile: normalizedProfile(ch.Profile),
				Enabled: ch.Enabled,
				Notes:   ch.Notes,
				Synced:  false,
			}
			adds = append(adds, img)
		case config.PendingActionDelete:
			deletes = append(deletes, config.PendingChange{
				Action:  config.PendingActionDelete,
				Source:  ch.Source,
				Target:  ch.Target,
				Profile: normalizedProfile(ch.Profile),
			})
		}
	}
	return adds, deletes
}

func defaultTargetFromSource(source string) string {
	s := strings.TrimSpace(source)
	if s == "" {
		return ""
	}

	namePart := s
	suffix := ""
	if at := strings.Index(s, "@"); at >= 0 {
		namePart = s[:at]
		suffix = s[at:]
	} else {
		lastSlash := strings.LastIndex(s, "/")
		lastColon := strings.LastIndex(s, ":")
		if lastColon > lastSlash {
			namePart = s[:lastColon]
			suffix = s[lastColon:]
		}
	}

	parts := splitNonEmpty(namePart, "/")
	if len(parts) > 1 && looksLikeRegistryHost(parts[0]) {
		parts = parts[1:]
	}
	if len(parts) == 0 {
		return s
	}

	base := ""
	switch {
	case len(parts) >= 3:
		base = parts[len(parts)-2] + "-" + parts[len(parts)-1]
	case len(parts) == 2:
		base = parts[0] + "/" + parts[1]
	default:
		base = parts[0]
	}
	return base + suffix
}

func splitNonEmpty(s, sep string) []string {
	raw := strings.Split(s, sep)
	out := make([]string, 0, len(raw))
	for _, p := range raw {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		out = append(out, p)
	}
	return out
}

func looksLikeRegistryHost(firstSegment string) bool {
	if firstSegment == "localhost" {
		return true
	}
	return strings.Contains(firstSegment, ".") || strings.Contains(firstSegment, ":")
}
