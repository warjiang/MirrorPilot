package cli

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"

	"github.com/warjiang/MirrorPilot/internal/config"
)

func newRemoteCmd(opts *options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "remote",
		Short: "Manage remote repo config and fetch remote image list",
	}
	cmd.AddCommand(newRemoteSetCmd(opts), newRemoteFetchCmd(opts))
	return cmd
}

func newRemoteSetCmd(opts *options) *cobra.Command {
	var repoURL string
	var ref string
	var configPath string

	cmd := &cobra.Command{
		Use:   "set",
		Short: "Set remote repository config",
		RunE: func(cmd *cobra.Command, args []string) error {
			lc, err := config.Load(opts.ConfigPath)
			if err != nil {
				return err
			}
			cfg := config.Normalize(lc.Config)

			if strings.TrimSpace(repoURL) != "" {
				cfg.Remote.RepoURL = strings.TrimSpace(repoURL)
			}
			if strings.TrimSpace(ref) != "" {
				cfg.Remote.Ref = strings.TrimSpace(ref)
			}
			if strings.TrimSpace(configPath) != "" {
				cfg.Remote.ConfigPath = strings.TrimSpace(configPath)
			}

			if strings.TrimSpace(cfg.Remote.RepoURL) == "" {
				return errors.New("remote repo url is required; set via --repo-url")
			}

			lc.Config = cfg
			if err := lc.Save(); err != nil {
				return err
			}
			fmt.Printf("remote configured: repo=%s ref=%s config_path=%s\n", cfg.Remote.RepoURL, cfg.Remote.Ref, cfg.Remote.ConfigPath)
			return nil
		},
	}
	cmd.Flags().StringVar(&repoURL, "repo-url", "", "Remote git repository url")
	cmd.Flags().StringVar(&ref, "ref", "", "Remote branch/tag/ref")
	cmd.Flags().StringVar(&configPath, "config-path", "", "Config path in remote repo")
	return cmd
}

func newRemoteFetchCmd(opts *options) *cobra.Command {
	var repoURL string
	var ref string
	var configPath string
	var merge bool
	var dryRun bool

	cmd := &cobra.Command{
		Use:   "fetch",
		Short: "Fetch remote image list (and optionally merge into local config)",
		RunE: func(cmd *cobra.Command, args []string) error {
			lc, err := config.Load(opts.ConfigPath)
			if err != nil {
				return err
			}
			cfg := config.Normalize(lc.Config)

			if strings.TrimSpace(repoURL) == "" {
				repoURL = cfg.Remote.RepoURL
			}
			if strings.TrimSpace(ref) == "" {
				ref = cfg.Remote.Ref
			}
			if strings.TrimSpace(configPath) == "" {
				configPath = cfg.Remote.ConfigPath
			}
			if strings.TrimSpace(repoURL) == "" {
				return errors.New("remote repo url is required; set via `mirrorpilot remote set --repo-url ...` or pass --repo-url")
			}

			remoteCfg, remoteUsedPath, err := config.LoadRemoteConfig(repoURL, ref, configPath)
			if err != nil {
				return err
			}

			fmt.Printf("fetched remote config: repo=%s ref=%s path=%s images=%d synced=%d\n", repoURL, ref, remoteUsedPath, len(remoteCfg.Images), len(remoteCfg.SyncedImages))
			if !merge {
				return nil
			}

			added, syncedUpdated, profileAdded := mergeRemoteIntoLocal(&cfg, remoteCfg)
			cfg.Remote = config.RemoteConfig{RepoURL: repoURL, Ref: ref, ConfigPath: configPath}
			config.RefreshSyncedImages(&cfg)

			fmt.Printf("merge result: profiles_added=%d images_added=%d synced_updated=%d\n", profileAdded, added, syncedUpdated)
			if dryRun {
				fmt.Println("dry-run enabled; local config not modified")
				return nil
			}

			lc.Config = cfg
			if err := lc.Save(); err != nil {
				return err
			}
			fmt.Printf("local config updated: %s\n", lc.Path)
			return nil
		},
	}
	cmd.Flags().StringVar(&repoURL, "repo-url", "", "Remote git repository url (defaults to configured remote.repo_url)")
	cmd.Flags().StringVar(&ref, "ref", "", "Remote branch/tag/ref (defaults to configured remote.ref)")
	cmd.Flags().StringVar(&configPath, "config-path", "", "Config path in remote repo (defaults to configured remote.config_path)")
	cmd.Flags().BoolVar(&merge, "merge", true, "Merge fetched data into local config")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "Preview merge result without writing local file")
	return cmd
}

func mergeRemoteIntoLocal(local *config.Config, remote config.Config) (added int, syncedUpdated int, profileAdded int) {
	config.EnsureDefaultProfile(local)
	for name, p := range remote.Profiles {
		if _, ok := local.Profiles[name]; ok {
			continue
		}
		local.Profiles[name] = p
		profileAdded++
	}

	index := make(map[string]int, len(local.Images))
	for i, img := range local.Images {
		p := img.Profile
		if p == "" {
			p = config.DefaultProfile
		}
		index[p+"|"+img.Source+"|"+img.Target] = i
	}

	for _, rimg := range remote.Images {
		p := rimg.Profile
		if p == "" {
			p = config.DefaultProfile
		}
		key := p + "|" + rimg.Source + "|" + rimg.Target
		if idx, ok := index[key]; ok {
			if rimg.Synced && !local.Images[idx].Synced {
				local.Images[idx].Synced = true
				local.Images[idx].SyncedAt = rimg.SyncedAt
				if local.Images[idx].CreatedAt == "" {
					local.Images[idx].CreatedAt = rimg.CreatedAt
				}
				syncedUpdated++
			}
			continue
		}
		rimg.Profile = p
		if rimg.Enabled == nil {
			rimg.Enabled = config.BoolPtr(true)
		}
		local.Images = append(local.Images, rimg)
		index[key] = len(local.Images) - 1
		added++
	}

	return added, syncedUpdated, profileAdded
}

func newSyncedCmd(opts *options) *cobra.Command {
	var output string
	cmd := &cobra.Command{
		Use:   "synced",
		Short: "Show synced image state from config",
		RunE: func(cmd *cobra.Command, args []string) error {
			lc, err := config.Load(opts.ConfigPath)
			if err != nil {
				return err
			}
			cfg := config.Normalize(lc.Config)
			items := cfg.SyncedImages
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
				fmt.Println("PROFILE\tSOURCE\tTARGET\tCREATED_AT\tSYNCED_AT")
				for _, item := range items {
					fmt.Printf("%s\t%s\t%s\t%s\t%s\n", item.Profile, item.Source, item.Target, item.CreatedAt, item.SyncedAt)
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
	cmd.Flags().StringVar(&output, "output", "table", "Output format: table|json|yaml")
	return cmd
}
