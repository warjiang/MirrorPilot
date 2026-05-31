package cli

import "github.com/warjiang/MirrorPilot/internal/config"

func normalizedProfile(profile string) string {
	if profile == "" {
		return config.DefaultProfile
	}
	return profile
}

func imageKey(profile, source, target string) string {
	return normalizedProfile(profile) + "|" + source + "|" + target
}

func pendingDeleteKey(item config.PendingDelete) string {
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
