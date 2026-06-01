package cli

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/warjiang/MirrorPilot/internal/config"
)

func TestStatusJSONIncludesPendingChanges(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "mirrorpilot.yaml")
	lc := config.LoadedConfig{
		Path:   cfgPath,
		Config: config.DefaultConfig(),
	}
	lc.Config.Remote = config.RemoteConfig{
		RepoURL:    "git@github.com:warjiang/MirrorPilot.git",
		Ref:        "main",
		ConfigPath: "mirrorpilot.yaml",
	}
	lc.Config.PendingChanges = []config.PendingChange{
		{
			Action:  config.PendingActionAdd,
			Source:  "curlimages/curl:8.8.0",
			Target:  "curlimages/curl:8.8.0",
			Profile: config.DefaultProfile,
			Enabled: config.BoolPtr(true),
		},
		{
			Action:  config.PendingActionDelete,
			Source:  "nginx:1.27",
			Target:  "mirror/nginx:1.27",
			Profile: config.DefaultProfile,
		},
	}
	if err := lc.Save(); err != nil {
		t.Fatalf("save initial config: %v", err)
	}

	cmd := NewRootCmd()
	cmd.SetArgs([]string{"--config", cfgPath, "status", "--output", "json"})

	oldStdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("create stdout pipe: %v", err)
	}
	os.Stdout = w
	runErr := cmd.Execute()
	_ = w.Close()
	os.Stdout = oldStdout
	if runErr != nil {
		t.Fatalf("execute status: %v", runErr)
	}
	out, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("read status output: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatalf("parse status output as json: %v", err)
	}
	if _, ok := got["pending_changes"]; !ok {
		t.Fatalf("expected pending_changes in status output")
	}
	if changes, ok := got["changes"].([]any); !ok || len(changes) == 0 {
		t.Fatalf("expected merged changes in status output")
	}
}
