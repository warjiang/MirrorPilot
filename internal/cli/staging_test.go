package cli

import "testing"

func TestDefaultTargetFromSource(t *testing.T) {
	tests := []struct {
		name   string
		source string
		want   string
	}{
		{
			name:   "host and multi-segment path",
			source: "ghcr.io/org/team/app:1.0.0",
			want:   "team-app:1.0.0",
		},
		{
			name:   "two-segment path keeps slash",
			source: "team/app:1.0.0",
			want:   "team/app:1.0.0",
		},
		{
			name:   "single segment unchanged",
			source: "app:1.0.0",
			want:   "app:1.0.0",
		},
		{
			name:   "digest keeps suffix",
			source: "ghcr.io/org/team/app@sha256:abc",
			want:   "team-app@sha256:abc",
		},
		{
			name:   "localhost host with port",
			source: "localhost:5000/a/b/c:2",
			want:   "b-c:2",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := defaultTargetFromSource(tt.source); got != tt.want {
				t.Fatalf("defaultTargetFromSource(%q)=%q want %q", tt.source, got, tt.want)
			}
		})
	}
}
