package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"

	"github.com/warjiang/MirrorPilot/internal/config"
)

type statusView struct {
	Remote         config.RemoteConfig `json:"remote" yaml:"remote"`
	PendingChanges []statusChangeView  `json:"pending_changes" yaml:"pending_changes"`
	Changes        []statusChangeView  `json:"changes" yaml:"changes"`
	Stats          statusStatsView     `json:"stats" yaml:"stats"`
}

type statusStatsView struct {
	ProfilesCount       int `json:"profiles_count" yaml:"profiles_count"`
	ImagesCount         int `json:"images_count" yaml:"images_count"`
	PendingChangesCount int `json:"pending_changes_count" yaml:"pending_changes_count"`
	SyncedImagesCount   int `json:"synced_images_count" yaml:"synced_images_count"`
}

type statusChangeView struct {
	Action     string `json:"action" yaml:"action"`
	Profile    string `json:"profile" yaml:"profile"`
	Enabled    string `json:"enabled,omitempty" yaml:"enabled,omitempty"`
	Source     string `json:"source" yaml:"source"`
	Target     string `json:"target" yaml:"target"`
	FullTarget string `json:"full_target,omitempty" yaml:"full_target,omitempty"`
}

func newStatusCmd(opts *options) *cobra.Command {
	var output string
	var showFullPaths bool
	cmd := &cobra.Command{
		Use:   "status",
		Short: "Show local staged status",
		RunE: func(cmd *cobra.Command, args []string) error {
			lc, err := config.Load(opts.ConfigPath)
			if err != nil {
				return err
			}
			cfg := config.Normalize(lc.Config)
			changes := make([]statusChangeView, 0, len(cfg.PendingChanges))
			for _, ch := range cfg.PendingChanges {
				profile := normalizedProfile(ch.Profile)
				action := strings.ToUpper(strings.TrimSpace(ch.Action))
				item := statusChangeView{
					Action:  action,
					Profile: profile,
					Source:  ch.Source,
					Target:  ch.Target,
				}
				if action == "ADD" {
					enabled := true
					if ch.Enabled != nil {
						enabled = *ch.Enabled
					}
					item.Enabled = fmt.Sprintf("%t", enabled)
				}
				if showFullPaths {
					item.FullTarget = buildFullTarget(cfg, profile, ch.Target)
				}
				changes = append(changes, statusChangeView{
					Action:     item.Action,
					Profile:    item.Profile,
					Enabled:    item.Enabled,
					Source:     item.Source,
					Target:     item.Target,
					FullTarget: item.FullTarget,
				})
			}
			sort.Slice(changes, func(i, j int) bool {
				if changes[i].Action != changes[j].Action {
					return changes[i].Action < changes[j].Action
				}
				if changes[i].Profile != changes[j].Profile {
					return changes[i].Profile < changes[j].Profile
				}
				if changes[i].Source != changes[j].Source {
					return changes[i].Source < changes[j].Source
				}
				return changes[i].Target < changes[j].Target
			})
			view := statusView{
				Remote:         cfg.Remote,
				PendingChanges: changes,
				Changes:        changes,
				Stats: statusStatsView{
					ProfilesCount:       len(cfg.Profiles),
					ImagesCount:         len(cfg.Images),
					PendingChangesCount: len(cfg.PendingChanges),
					SyncedImagesCount:   len(cfg.SyncedImages),
				},
			}

			switch output {
			case "table":
				fmt.Printf("remote: repo=%s ref=%s config_path=%s\n", cfg.Remote.RepoURL, cfg.Remote.Ref, cfg.Remote.ConfigPath)
				fmt.Printf("stats: profiles=%d images=%d pending_changes=%d synced_images=%d\n",
					view.Stats.ProfilesCount, view.Stats.ImagesCount, view.Stats.PendingChangesCount, view.Stats.SyncedImagesCount)
				headers := []string{"ACTION", "PROFILE", "ENABLED", "SOURCE", "TARGET"}
				if showFullPaths {
					headers = append(headers, "FULL_TARGET")
				}
				rows := make([][]string, 0, len(changes))
				for _, item := range changes {
					row := []string{item.Action, item.Profile, item.Enabled, item.Source, item.Target}
					if showFullPaths {
						row = append(row, item.FullTarget)
					}
					rows = append(rows, row)
				}
				fmt.Println("pending changes:")
				fmt.Print(renderGridTable(headers, rows, 44))
			case "json":
				enc := json.NewEncoder(os.Stdout)
				enc.SetIndent("", "  ")
				return enc.Encode(view)
			case "yaml":
				b, err := yaml.Marshal(view)
				if err != nil {
					return err
				}
				fmt.Print(string(b))
			default:
				return fmt.Errorf("--output must be one of: table, json, yaml")
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&output, "output", "table", "Output format: table|json|yaml")
	cmd.Flags().BoolVar(&showFullPaths, "full-paths", false, "Include full_target field")
	return cmd
}
