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

type listedImage struct {
	Source     string `json:"source" yaml:"source"`
	Target     string `json:"target" yaml:"target"`
	Profile    string `json:"profile" yaml:"profile"`
	Enabled    bool   `json:"enabled" yaml:"enabled"`
	Synced     bool   `json:"synced" yaml:"synced"`
	CreatedAt  string `json:"created_at,omitempty" yaml:"created_at,omitempty"`
	SyncedAt   string `json:"synced_at,omitempty" yaml:"synced_at,omitempty"`
	Notes      string `json:"notes,omitempty" yaml:"notes,omitempty"`
	FullSource string `json:"full_source" yaml:"full_source"`
	FullTarget string `json:"full_target" yaml:"full_target"`
}

type listedImageBasic struct {
	Source    string `json:"source" yaml:"source"`
	Target    string `json:"target" yaml:"target"`
	Profile   string `json:"profile" yaml:"profile"`
	Enabled   bool   `json:"enabled" yaml:"enabled"`
	Synced    bool   `json:"synced" yaml:"synced"`
	CreatedAt string `json:"created_at,omitempty" yaml:"created_at,omitempty"`
	SyncedAt  string `json:"synced_at,omitempty" yaml:"synced_at,omitempty"`
	Notes     string `json:"notes,omitempty" yaml:"notes,omitempty"`
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
	cmd.PersistentFlags().StringVar(&opts.ConfigPath, "config", config.DefaultUserConfigPathOrFallback(), "Path to YAML config file (default: ~/.mirrorpilot/mirrorpilot.yaml)")

	cmd.AddCommand(
		newAddCmd(opts),
		newDeleteCmd(opts),
		newMarkCmd(opts),
		newListCmd(opts),
		newSyncedCmd(opts),
		newRemoteCmd(opts),
		newSearchCmd(opts),
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
			for _, img := range cfg.PendingImages {
				p := img.Profile
				if p == "" {
					p = config.DefaultProfile
				}
				if p == profile && img.Source == source && img.Target == target {
					return fmt.Errorf("image mapping already exists for profile=%s source=%s target=%s", profile, source, target)
				}
			}
			if len(cfg.PendingDeletes) > 0 {
				keptDeletes := make([]config.PendingDelete, 0, len(cfg.PendingDeletes))
				key := imageKey(profile, source, target)
				for _, del := range cfg.PendingDeletes {
					if pendingDeleteKey(del) == key {
						continue
					}
					keptDeletes = append(keptDeletes, del)
				}
				cfg.PendingDeletes = keptDeletes
			}

			cfg.PendingImages = append(cfg.PendingImages, config.Image{
				Source:  source,
				Target:  target,
				Profile: profile,
				Enabled: config.BoolPtr(enabled),
				Synced:  false,
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
	cmd.Flags().StringVar(&target, "target", "", "Target image (defaults to source)")
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
			if strings.TrimSpace(source) == "" {
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
			profile = strings.TrimSpace(profile)

			// Cancel matching staged additions first.
			keptPending := make([]config.Image, 0, len(cfg.PendingImages))
			canceledAdds := 0
			for _, img := range cfg.PendingImages {
				if imageMatchesFilter(img, source, target, profile) {
					canceledAdds++
					continue
				}
				keptPending = append(keptPending, img)
			}
			cfg.PendingImages = keptPending

			// Stage concrete deletions for existing committed mappings.
			stagedDeleteSet := make(map[string]struct{}, len(cfg.PendingDeletes))
			for _, del := range cfg.PendingDeletes {
				stagedDeleteSet[pendingDeleteKey(del)] = struct{}{}
			}
			stagedDeletes := 0
			for _, img := range cfg.Images {
				if !imageMatchesFilter(img, source, target, profile) {
					continue
				}
				del := config.PendingDelete{
					Source:  img.Source,
					Target:  img.Target,
					Profile: normalizedProfile(img.Profile),
				}
				key := pendingDeleteKey(del)
				if _, exists := stagedDeleteSet[key]; exists {
					continue
				}
				stagedDeleteSet[key] = struct{}{}
				cfg.PendingDeletes = append(cfg.PendingDeletes, del)
				stagedDeletes++
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
			if err := ensureRemoteConfigured(cfg); err != nil {
				return err
			}

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
	var showFullPaths bool

	cmd := &cobra.Command{
		Use:   "list",
		Short: "List image mappings",
		RunE: func(cmd *cobra.Command, args []string) error {
			lc, err := config.Load(opts.ConfigPath)
			if err != nil {
				return err
			}
			cfg := config.Normalize(lc.Config)
			if err := ensureRemoteConfigured(cfg); err != nil {
				return err
			}

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

			items := make([]listedImage, 0, len(cfg.Images))
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
				items = append(items, listedImage{
					Source:     img.Source,
					Target:     img.Target,
					Profile:    imgProfile,
					Enabled:    img.EnabledValue(),
					Synced:     img.Synced,
					CreatedAt:  img.CreatedAt,
					SyncedAt:   img.SyncedAt,
					Notes:      img.Notes,
					FullSource: buildFullSource(img.Source),
					FullTarget: buildFullTarget(cfg, imgProfile, img.Target),
				})
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
				if showFullPaths {
					fmt.Println("PROFILE\tENABLED\tSYNCED\tSOURCE\tTARGET\tFULL_SOURCE\tFULL_TARGET\tCREATED_AT\tSYNCED_AT")
					for _, img := range items {
						fmt.Printf("%s\t%t\t%t\t%s\t%s\t%s\t%s\t%s\t%s\n", img.Profile, img.Enabled, img.Synced, img.Source, img.Target, img.FullSource, img.FullTarget, img.CreatedAt, img.SyncedAt)
					}
				} else {
					fmt.Println("PROFILE\tENABLED\tSYNCED\tSOURCE\tTARGET\tCREATED_AT\tSYNCED_AT")
					for _, img := range items {
						fmt.Printf("%s\t%t\t%t\t%s\t%s\t%s\t%s\n", img.Profile, img.Enabled, img.Synced, img.Source, img.Target, img.CreatedAt, img.SyncedAt)
					}
				}
			case "json":
				enc := json.NewEncoder(os.Stdout)
				enc.SetIndent("", "  ")
				if showFullPaths {
					return enc.Encode(items)
				}
				basicItems := make([]listedImageBasic, 0, len(items))
				for _, img := range items {
					basicItems = append(basicItems, listedImageBasic{
						Source:    img.Source,
						Target:    img.Target,
						Profile:   img.Profile,
						Enabled:   img.Enabled,
						Synced:    img.Synced,
						CreatedAt: img.CreatedAt,
						SyncedAt:  img.SyncedAt,
						Notes:     img.Notes,
					})
				}
				return enc.Encode(basicItems)
			case "yaml":
				if showFullPaths {
					b, err := yaml.Marshal(items)
					if err != nil {
						return err
					}
					fmt.Print(string(b))
					break
				}
				basicItems := make([]listedImageBasic, 0, len(items))
				for _, img := range items {
					basicItems = append(basicItems, listedImageBasic{
						Source:    img.Source,
						Target:    img.Target,
						Profile:   img.Profile,
						Enabled:   img.Enabled,
						Synced:    img.Synced,
						CreatedAt: img.CreatedAt,
						SyncedAt:  img.SyncedAt,
						Notes:     img.Notes,
					})
				}
				b, err := yaml.Marshal(basicItems)
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
	cmd.Flags().BoolVar(&showFullPaths, "full-paths", false, "Include full_source/full_target columns/fields")
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
