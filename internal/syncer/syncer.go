package syncer

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/warjiang/MirrorPilot/internal/config"
)

type Options struct {
	Profile     string
	All         bool
	DryRun      bool
	Concurrency int
}

type Result struct {
	Image  config.Image
	Err    error
	Output string
}

type Runner struct{}

func (Runner) Run(cfg *config.Config, opts Options) ([]Result, error) {
	if !isCI() {
		return nil, errors.New("sync command is only allowed in CI environment")
	}

	cfgNorm := config.Normalize(*cfg)
	*cfg = cfgNorm

	if opts.Profile == "" {
		opts.Profile = config.DefaultProfile
	}
	if opts.Concurrency <= 0 {
		opts.Concurrency = 1
	}

	profile, ok := cfg.Profiles[opts.Profile]
	if !ok {
		return nil, fmt.Errorf("profile %q not found", opts.Profile)
	}
	registry := strings.TrimRight(profile.Registry, "/")
	if registry == "" {
		return nil, fmt.Errorf("profile %q registry is empty", opts.Profile)
	}

	username := os.Getenv(profile.UsernameEnv)
	password := os.Getenv(profile.PasswordEnv)
	if username == "" || password == "" {
		return nil, fmt.Errorf("profile %q credentials env vars are missing (%s / %s)", opts.Profile, profile.UsernameEnv, profile.PasswordEnv)
	}

	type task struct {
		Index int
		Image config.Image
	}
	var tasks []task
	for i := range cfg.Images {
		img := cfg.Images[i]
		if img.Profile == "" {
			img.Profile = config.DefaultProfile
		}
		if img.Profile != opts.Profile {
			continue
		}
		if !img.EnabledValue() {
			continue
		}
		if !opts.All && img.Synced {
			continue
		}
		tasks = append(tasks, task{Index: i, Image: img})
	}

	if len(tasks) == 0 {
		return []Result{}, nil
	}

	results := make([]Result, len(tasks))
	taskCh := make(chan task)
	wg := sync.WaitGroup{}
	mu := sync.Mutex{}

	workerCount := opts.Concurrency
	if workerCount > len(tasks) {
		workerCount = len(tasks)
	}

	for w := 0; w < workerCount; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for t := range taskCh {
				res := runOne(registry, username, password, t.Image, opts.DryRun)
				mu.Lock()
				for i := range tasks {
					if tasks[i].Index == t.Index {
						results[i] = res
						break
					}
				}
				mu.Unlock()
			}
		}()
	}

	for _, t := range tasks {
		taskCh <- t
	}
	close(taskCh)
	wg.Wait()

	now := time.Now().UTC().Format(time.RFC3339)
	var failed int
	for i, t := range tasks {
		if results[i].Err != nil {
			failed++
			continue
		}
		if opts.DryRun {
			continue
		}
		cfg.Images[t.Index].Synced = true
		if cfg.Images[t.Index].CreatedAt == "" {
			cfg.Images[t.Index].CreatedAt = now
		}
		cfg.Images[t.Index].SyncedAt = now
	}

	if failed > 0 {
		return results, fmt.Errorf("%d/%d sync tasks failed", failed, len(tasks))
	}
	return results, nil
}

func runOne(registry, username, password string, img config.Image, dryRun bool) Result {
	src := "docker://" + strings.TrimSpace(img.Source)
	dst := "docker://" + registry + "/" + strings.TrimSpace(img.Target)
	args := []string{"copy", "--multi-arch", "all", "--dest-creds", username + ":" + password, src, dst}

	if dryRun {
		return Result{Image: img, Output: "DRY RUN skopeo " + strings.Join(args, " ")}
	}

	cmd := exec.Command("skopeo", args...)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	return Result{Image: img, Err: err, Output: out.String()}
}

func isCI() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("CI")))
	return v == "true" || v == "1"
}
