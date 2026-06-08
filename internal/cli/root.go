package cli

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/warjiang/MirrorPilot/internal/config"
	"github.com/warjiang/MirrorPilot/internal/syncer"
)

type options struct {
	ConfigPath string
}

// appVersion holds the build version, set via SetVersion from main.
var appVersion = "dev"

// SetVersion sets the application version reported by the `version` command.
func SetVersion(v string) {
	if v != "" {
		appVersion = v
	}
}

func NewRootCmd() *cobra.Command {
	opts := &options{}
	cmd := &cobra.Command{
		Use:           "mirrorpilot",
		Aliases:       []string{"sync-images"},
		Short:         "Manage and sync container image mirrors",
		Version:       appVersion,
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	cmd.PersistentFlags().StringVar(&opts.ConfigPath, "config", config.DefaultUserConfigPathOrFallback(), "Path to YAML config file (default: ~/.mirrorpilot/mirrorpilot.yaml)")

	cmd.AddCommand(
		newAddCmd(opts),
		newDeleteCmd(opts),
		newStatusCmd(opts),
		newRemoteCmd(opts),
		newSearchCmd(opts),
		newSyncCmd(opts),
		newValidateCmd(opts),
		newVersionCmd(),
	)
	return cmd
}

func newVersionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the mirrorpilot version",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			fmt.Fprintln(cmd.OutOrStdout(), appVersion)
			return nil
		},
	}
}

func newAddCmd(opts *options) *cobra.Command {
	var source string
	var target string
	var profile string
	var note string
	var enabled bool

	cmd := &cobra.Command{
		Use:   "add",
		Short: "Add an image mapping",
		RunE: func(cmd *cobra.Command, args []string) error {
			source = strings.TrimSpace(source)
			target = strings.TrimSpace(target)
			profile = strings.TrimSpace(profile)

			if source == "" {
				return errors.New("--source is required")
			}
			if err := validateImageReference("--source", source); err != nil {
				return err
			}
			if target == "" {
				target = defaultTargetFromSource(source)
			}
			if err := validateImageReference("--target", target); err != nil {
				return err
			}
			if profile == "" {
				profile = config.DefaultProfile
			}

			lc, err := config.Load(opts.ConfigPath)
			if err != nil {
				return err
			}
			cfg := config.Normalize(lc.Config)
			config.EnsureDefaultProfile(&cfg)
			if err := ensureRemoteConfigured(cfg); err != nil {
				return err
			}

			if _, ok := cfg.Profiles[profile]; !ok {
				return fmt.Errorf("profile %q does not exist", profile)
			}
			for _, img := range cfg.Images {
				p := img.Profile
				if p == "" {
					p = config.DefaultProfile
				}
				if p == profile && img.Source == source && img.Target == target {
					return fmt.Errorf("image mapping already exists for profile=%s source=%s target=%s", profile, source, target)
				}
			}
			for _, ch := range cfg.PendingChanges {
				if strings.ToLower(strings.TrimSpace(ch.Action)) != config.PendingActionAdd {
					continue
				}
				p := normalizedProfile(ch.Profile)
				if p == profile && ch.Source == source && ch.Target == target {
					return fmt.Errorf("image mapping already exists for profile=%s source=%s target=%s", profile, source, target)
				}
			}
			keptChanges := make([]config.PendingChange, 0, len(cfg.PendingChanges))
			addKey := imageKey(profile, source, target)
			for _, ch := range cfg.PendingChanges {
				if strings.ToLower(strings.TrimSpace(ch.Action)) == config.PendingActionDelete &&
					pendingChangeKey(ch) == addKey {
					continue
				}
				keptChanges = append(keptChanges, ch)
			}
			cfg.PendingChanges = keptChanges
			cfg.PendingChanges = append(cfg.PendingChanges, config.PendingChange{
				Action:  config.PendingActionAdd,
				Source:  source,
				Target:  target,
				Profile: profile,
				Enabled: config.BoolPtr(enabled),
				Notes:   note,
			})
			lc.Config = cfg
			if err := lc.Save(); err != nil {
				return err
			}
			fmt.Printf("staged image: %s => %s (profile=%s)\n", source, target, profile)
			return nil
		},
	}

	cmd.Flags().StringVar(&source, "source", "", "Source image (required)")
	cmd.Flags().StringVar(&target, "target", "", "Target image (defaults to derived value from source)")
	cmd.Flags().StringVar(&profile, "profile", config.DefaultProfile, "Registry profile name")
	cmd.Flags().StringVar(&note, "note", "", "Optional note")
	cmd.Flags().BoolVar(&enabled, "enabled", true, "Whether this image is enabled")
	return cmd
}

func newDeleteCmd(opts *options) *cobra.Command {
	var source string
	var target string
	var profile string

	cmd := &cobra.Command{
		Use:     "delete",
		Aliases: []string{"remove"},
		Short:   "Stage image deletion(s)",
		RunE: func(cmd *cobra.Command, args []string) error {
			source = strings.TrimSpace(source)
			target = strings.TrimSpace(target)
			profile = strings.TrimSpace(profile)
			if source == "" {
				return errors.New("--source is required")
			}
			lc, err := config.Load(opts.ConfigPath)
			if err != nil {
				return err
			}
			cfg := config.Normalize(lc.Config)
			if err := ensureRemoteConfigured(cfg); err != nil {
				return err
			}
			// Cancel matching staged additions first.
			keptChanges := make([]config.PendingChange, 0, len(cfg.PendingChanges))
			canceledAdds := 0
			for _, ch := range cfg.PendingChanges {
				if strings.ToLower(strings.TrimSpace(ch.Action)) == config.PendingActionAdd &&
					matchesStagedAddChangeForDelete(ch, source, target, profile) {
					canceledAdds++
					continue
				}
				keptChanges = append(keptChanges, ch)
			}
			cfg.PendingChanges = keptChanges

			stagedDeletes := 0
			// Git-like behavior: if delete cancels staged add(s), it only unstages those adds.
			// It does not additionally stage deletes from committed images in the same operation.
			if canceledAdds == 0 {
				// Stage concrete deletions for existing committed mappings.
				stagedDeleteSet := make(map[string]struct{}, len(cfg.PendingChanges))
				for _, ch := range cfg.PendingChanges {
					if strings.ToLower(strings.TrimSpace(ch.Action)) != config.PendingActionDelete {
						continue
					}
					stagedDeleteSet[pendingChangeKey(ch)] = struct{}{}
				}
				for _, img := range cfg.Images {
					if !imageMatchesFilter(img, source, target, profile) {
						continue
					}
					del := config.PendingChange{
						Action:  config.PendingActionDelete,
						Source:  img.Source,
						Target:  img.Target,
						Profile: normalizedProfile(img.Profile),
					}
					key := pendingChangeKey(del)
					if _, exists := stagedDeleteSet[key]; exists {
						continue
					}
					stagedDeleteSet[key] = struct{}{}
					cfg.PendingChanges = append(cfg.PendingChanges, del)
					stagedDeletes++
				}
			}
			if stagedDeletes == 0 && canceledAdds == 0 {
				return errors.New("no matching image entries found")
			}
			lc.Config = cfg
			if err := lc.Save(); err != nil {
				return err
			}
			fmt.Printf("staged delete entries=%d canceled_staged_additions=%d\n", stagedDeletes, canceledAdds)
			return nil
		},
	}
	cmd.Flags().StringVar(&source, "source", "", "Source image to delete (required)")
	cmd.Flags().StringVar(&target, "target", "", "Optional target image to narrow the deletion")
	cmd.Flags().StringVar(&profile, "profile", "", "Optional profile to narrow the deletion")
	return cmd
}

func newValidateCmd(opts *options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "validate",
		Short: "Validate configuration",
		RunE: func(cmd *cobra.Command, args []string) error {
			lc, err := config.Load(opts.ConfigPath)
			if err != nil {
				return err
			}
			errs := config.Validate(lc.Config)
			if len(errs) > 0 {
				for _, e := range errs {
					fmt.Fprintf(os.Stderr, "- %v\n", e)
				}
				return fmt.Errorf("validation failed with %d issue(s)", len(errs))
			}
			if lc.FromLegacy {
				fmt.Printf("config loaded from legacy file %s and is valid\n", config.LegacyListPath)
			} else {
				fmt.Printf("config %s is valid\n", lc.Path)
			}
			return nil
		},
	}
	return cmd
}

func newSyncCmd(opts *options) *cobra.Command {
	var profile string
	var all bool
	var dryRun bool
	var concurrency int

	cmd := &cobra.Command{
		Use:   "sync",
		Short: "Sync images to target registry (CI only)",
		RunE: func(cmd *cobra.Command, args []string) error {
			lc, err := config.Load(opts.ConfigPath)
			if err != nil {
				return err
			}
			cfg := config.Normalize(lc.Config)
			runner := syncer.Runner{}
			results, runErr := runner.Run(&cfg, syncer.Options{
				Profile:     profile,
				All:         all,
				DryRun:      dryRun,
				Concurrency: concurrency,
			})

			for _, r := range results {
				status := "OK"
				if r.Err != nil {
					status = "FAILED"
				}
				fmt.Printf("[%s] %s => %s\n", status, r.Image.Source, r.Image.Target)
				if strings.TrimSpace(r.Output) != "" {
					fmt.Print(r.Output)
					if !strings.HasSuffix(r.Output, "\n") {
						fmt.Println()
					}
				}
			}

			if runErr != nil {
				return runErr
			}
			if !dryRun {
				lc.Config = cfg
				if err := lc.Save(); err != nil {
					return err
				}
			}
			fmt.Printf("sync completed, processed %d entries\n", len(results))
			return nil
		},
	}
	cmd.Flags().StringVar(&profile, "profile", config.DefaultProfile, "Profile name")
	cmd.Flags().BoolVar(&all, "all", false, "Sync all enabled images, including already synced ones")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Show what would be synced without executing")
	cmd.Flags().IntVar(&concurrency, "concurrency", 2, "Number of concurrent sync workers")
	return cmd
}
