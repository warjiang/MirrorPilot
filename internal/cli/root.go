package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"

	"github.com/warjiang/MirrorPilot/internal/config"
	"github.com/warjiang/MirrorPilot/internal/syncer"
)

type options struct {
	ConfigPath string
}

func NewRootCmd() *cobra.Command {
	opts := &options{}
	cmd := &cobra.Command{
		Use:           "mirrorpilot",
		Aliases:       []string{"sync-images"},
		Short:         "Manage and sync container image mirrors",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	cmd.PersistentFlags().StringVar(&opts.ConfigPath, "config", config.DefaultConfigPath, "Path to YAML config file")

	cmd.AddCommand(
		newAddCmd(opts),
		newRemoveCmd(opts),
		newMarkCmd(opts),
		newListCmd(opts),
		newSyncedCmd(opts),
		newRemoteCmd(opts),
		newMigrateCmd(opts),
		newValidateCmd(opts),
		newSyncCmd(opts),
	)
	return cmd
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
			if strings.TrimSpace(source) == "" {
				return errors.New("--source is required")
			}
			if strings.TrimSpace(target) == "" {
				target = source
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

			cfg.Images = append(cfg.Images, config.Image{
				Source:    source,
				Target:    target,
				Profile:   profile,
				Enabled:   config.BoolPtr(enabled),
				Synced:    false,
				CreatedAt: time.Now().UTC().Format(time.RFC3339),
				Notes:     note,
			})
			lc.Config = cfg
			if err := lc.Save(); err != nil {
				return err
			}
			fmt.Printf("added image: %s => %s (profile=%s)\n", source, target, profile)
			return nil
		},
	}

	cmd.Flags().StringVar(&source, "source", "", "Source image (required)")
	cmd.Flags().StringVar(&target, "target", "", "Target image (defaults to source)")
	cmd.Flags().StringVar(&profile, "profile", config.DefaultProfile, "Registry profile name")
	cmd.Flags().StringVar(&note, "note", "", "Optional note")
	cmd.Flags().BoolVar(&enabled, "enabled", true, "Whether this image is enabled")
	return cmd
}

func newRemoveCmd(opts *options) *cobra.Command {
	var source string
	var target string
	var profile string

	cmd := &cobra.Command{
		Use:   "remove",
		Short: "Remove image mapping(s)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if strings.TrimSpace(source) == "" {
				return errors.New("--source is required")
			}
			lc, err := config.Load(opts.ConfigPath)
			if err != nil {
				return err
			}
			cfg := config.Normalize(lc.Config)

			kept := make([]config.Image, 0, len(cfg.Images))
			removed := 0
			for _, img := range cfg.Images {
				imgProfile := img.Profile
				if imgProfile == "" {
					imgProfile = config.DefaultProfile
				}
				match := img.Source == source
				if target != "" {
					match = match && img.Target == target
				}
				if profile != "" {
					match = match && imgProfile == profile
				}
				if match {
					removed++
					continue
				}
				kept = append(kept, img)
			}
			if removed == 0 {
				return errors.New("no matching image entries found")
			}
			cfg.Images = kept
			lc.Config = cfg
			if err := lc.Save(); err != nil {
				return err
			}
			fmt.Printf("removed %d image entries\n", removed)
			return nil
		},
	}
	cmd.Flags().StringVar(&source, "source", "", "Source image to remove (required)")
	cmd.Flags().StringVar(&target, "target", "", "Optional target image to narrow the removal")
	cmd.Flags().StringVar(&profile, "profile", "", "Optional profile to narrow the removal")
	return cmd
}

func newMarkCmd(opts *options) *cobra.Command {
	var source string
	var target string
	var profile string
	var synced bool
	var at string
	var now bool

	cmd := &cobra.Command{
		Use:   "mark",
		Short: "Mark image mapping sync state",
		RunE: func(cmd *cobra.Command, args []string) error {
			if strings.TrimSpace(source) == "" {
				return errors.New("--source is required")
			}
			lc, err := config.Load(opts.ConfigPath)
			if err != nil {
				return err
			}
			cfg := config.Normalize(lc.Config)

			var ts string
			if synced {
				switch {
				case strings.TrimSpace(at) != "":
					if _, err := time.Parse(time.RFC3339, at); err != nil {
						return fmt.Errorf("--at must be RFC3339: %w", err)
					}
					ts = at
				case now:
					ts = time.Now().UTC().Format(time.RFC3339)
				}
			}

			marked := 0
			for i, img := range cfg.Images {
				imgProfile := img.Profile
				if imgProfile == "" {
					imgProfile = config.DefaultProfile
				}
				match := img.Source == source
				if target != "" {
					match = match && img.Target == target
				}
				if profile != "" {
					match = match && imgProfile == profile
				}
				if !match {
					continue
				}
				cfg.Images[i].Synced = synced
				if synced {
					cfg.Images[i].SyncedAt = ts
				} else {
					cfg.Images[i].SyncedAt = ""
				}
				marked++
			}

			if marked == 0 {
				return errors.New("no matching image entries found")
			}
			lc.Config = cfg
			if err := lc.Save(); err != nil {
				return err
			}
			fmt.Printf("updated %d image entries\n", marked)
			return nil
		},
	}
	cmd.Flags().StringVar(&source, "source", "", "Source image (required)")
	cmd.Flags().StringVar(&target, "target", "", "Optional target image")
	cmd.Flags().StringVar(&profile, "profile", "", "Optional profile")
	cmd.Flags().BoolVar(&synced, "synced", true, "Set synced status (true/false)")
	cmd.Flags().StringVar(&at, "at", "", "Set last synced timestamp (RFC3339)")
	cmd.Flags().BoolVar(&now, "now", true, "Set last synced timestamp to current time when synced=true")
	return cmd
}

func newListCmd(opts *options) *cobra.Command {
	var showAll bool
	var showSynced bool
	var showPending bool
	var profile string
	var output string

	cmd := &cobra.Command{
		Use:   "list",
		Short: "List image mappings",
		RunE: func(cmd *cobra.Command, args []string) error {
			lc, err := config.Load(opts.ConfigPath)
			if err != nil {
				return err
			}
			cfg := config.Normalize(lc.Config)

			selectedFilterCount := 0
			if showAll {
				selectedFilterCount++
			}
			if showSynced {
				selectedFilterCount++
			}
			if showPending {
				selectedFilterCount++
			}
			if selectedFilterCount > 1 {
				return errors.New("only one of --all, --synced, --pending can be set")
			}
			if selectedFilterCount == 0 {
				showPending = true
			}

			items := make([]config.Image, 0, len(cfg.Images))
			for _, img := range cfg.Images {
				imgProfile := img.Profile
				if imgProfile == "" {
					imgProfile = config.DefaultProfile
				}
				if profile != "" && imgProfile != profile {
					continue
				}
				if !showAll && !img.EnabledValue() {
					continue
				}
				if showSynced && !img.Synced {
					continue
				}
				if showPending && img.Synced {
					continue
				}
				img.Profile = imgProfile
				items = append(items, img)
			}

			sort.Slice(items, func(i, j int) bool {
				if items[i].Profile != items[j].Profile {
					return items[i].Profile < items[j].Profile
				}
				if items[i].Source != items[j].Source {
					return items[i].Source < items[j].Source
				}
				return items[i].Target < items[j].Target
			})

			switch output {
			case "table":
				fmt.Println("PROFILE\tENABLED\tSYNCED\tSOURCE\tTARGET\tCREATED_AT\tSYNCED_AT")
				for _, img := range items {
					fmt.Printf("%s\t%t\t%t\t%s\t%s\t%s\t%s\n", img.Profile, img.EnabledValue(), img.Synced, img.Source, img.Target, img.CreatedAt, img.SyncedAt)
				}
			case "json":
				enc := json.NewEncoder(os.Stdout)
				enc.SetIndent("", "  ")
				return enc.Encode(items)
			case "yaml":
				b, err := yaml.Marshal(items)
				if err != nil {
					return err
				}
				fmt.Print(string(b))
			default:
				return errors.New("--output must be one of: table, json, yaml")
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&showAll, "all", false, "Show all images")
	cmd.Flags().BoolVar(&showSynced, "synced", false, "Show only synced images")
	cmd.Flags().BoolVar(&showPending, "pending", false, "Show only pending images (default)")
	cmd.Flags().StringVar(&profile, "profile", "", "Filter by profile")
	cmd.Flags().StringVar(&output, "output", "table", "Output format: table|json|yaml")
	return cmd
}

func newMigrateCmd(opts *options) *cobra.Command {
	var from string
	var to string
	var force bool

	cmd := &cobra.Command{
		Use:   "migrate",
		Short: "Migrate legacy images.list to YAML config",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.LoadLegacy(from)
			if err != nil {
				return err
			}
			lc := config.LoadedConfig{Path: to, Config: config.Normalize(cfg)}
			if !force {
				if _, err := os.Stat(to); err == nil {
					return fmt.Errorf("%s already exists, use --force to overwrite", to)
				}
			}
			if err := lc.Save(); err != nil {
				return err
			}
			fmt.Printf("migrated %s -> %s (%d entries)\n", from, to, len(cfg.Images))
			return nil
		},
	}
	cmd.Flags().StringVar(&from, "from", config.LegacyListPath, "Path to legacy images.list")
	cmd.Flags().StringVar(&to, "to", config.DefaultConfigPath, "Path to YAML config")
	cmd.Flags().BoolVar(&force, "force", false, "Overwrite destination file")
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
