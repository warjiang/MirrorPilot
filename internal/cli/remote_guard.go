package cli

import (
	"errors"
	"strings"

	"github.com/warjiang/MirrorPilot/internal/config"
)

func ensureRemoteConfigured(cfg config.Config) error {
	if strings.TrimSpace(cfg.Remote.RepoURL) != "" {
		return nil
	}
	return errors.New("please configure remote repository first: mirrorpilot remote set --repo-url <repo-url> --ref main --config-path mirrorpilot.yaml")
}
