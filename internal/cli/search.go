package cli

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/spf13/cobra"

	"github.com/warjiang/MirrorPilot/internal/config"
)

type searchItem struct {
	Source     string
	Target     string
	Profile    string
	Enabled    bool
	Synced     bool
	CreatedAt  string
	SyncedAt   string
	Notes      string
	FullSource string
	FullTarget string
}

type searchModel struct {
	input         textinput.Model
	items         []searchItem
	filtered      []int
	cursor        int
	width         int
	height        int
	confirmedItem *searchItem
}

func newSearchCmd(opts *options) *cobra.Command {
	var profile string
	var showAll bool

	cmd := &cobra.Command{
		Use:   "search",
		Short: "Search images in full-screen TUI",
		RunE: func(cmd *cobra.Command, args []string) error {
			lc, err := config.Load(opts.ConfigPath)
			if err != nil {
				return err
			}
			cfg := config.Normalize(lc.Config)

			items := make([]searchItem, 0, len(cfg.Images))
			for _, img := range cfg.Images {
				p := img.Profile
				if p == "" {
					p = config.DefaultProfile
				}
				if profile != "" && p != profile {
					continue
				}
				if !showAll && !img.EnabledValue() {
					continue
				}
				items = append(items, searchItem{
					Source:     img.Source,
					Target:     img.Target,
					Profile:    p,
					Enabled:    img.EnabledValue(),
					Synced:     img.Synced,
					CreatedAt:  img.CreatedAt,
					SyncedAt:   img.SyncedAt,
					Notes:      img.Notes,
					FullSource: buildFullSource(img.Source),
					FullTarget: buildFullTarget(cfg, p, img.Target),
				})
			}

			m := initialSearchModel(items)
			program := tea.NewProgram(m, tea.WithAltScreen())
			result, err := program.Run()
			if err != nil {
				return err
			}
			finalModel := result.(searchModel)
			if finalModel.confirmedItem != nil {
				item := finalModel.confirmedItem
				fmt.Printf("selected: profile=%s source=%s target=%s full_source=%s full_target=%s\n", item.Profile, item.Source, item.Target, item.FullSource, item.FullTarget)
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&profile, "profile", "", "Filter by profile")
	cmd.Flags().BoolVar(&showAll, "all", false, "Include disabled images")
	return cmd
}

func initialSearchModel(items []searchItem) searchModel {
	input := textinput.New()
	input.Placeholder = "Type to filter source/target/profile/notes..."
	input.Focus()
	input.CharLimit = 256
	input.Width = 60
	m := searchModel{
		input:    input,
		items:    items,
		filtered: make([]int, len(items)),
		cursor:   0,
		width:    100,
		height:   30,
	}
	for i := range items {
		m.filtered[i] = i
	}
	return m
}

func (m searchModel) Init() tea.Cmd {
	return textinput.Blink
}

func (m searchModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q", "esc":
			return m, tea.Quit
		case "up", "k":
			if len(m.filtered) > 0 && m.cursor > 0 {
				m.cursor--
			}
			return m, nil
		case "down", "j":
			if len(m.filtered) > 0 && m.cursor < len(m.filtered)-1 {
				m.cursor++
			}
			return m, nil
		case "enter":
			if len(m.filtered) > 0 {
				selected := m.items[m.filtered[m.cursor]]
				m.confirmedItem = &selected
			}
			return m, tea.Quit
		}
	}

	var cmd tea.Cmd
	m.input, cmd = m.input.Update(msg)
	m.applyFilter()
	return m, cmd
}

func (m *searchModel) applyFilter() {
	query := strings.ToLower(strings.TrimSpace(m.input.Value()))
	next := make([]int, 0, len(m.items))
	for i, item := range m.items {
		haystack := strings.ToLower(strings.Join([]string{
			item.Source,
			item.Target,
			item.Profile,
			item.Notes,
			item.FullSource,
			item.FullTarget,
		}, " "))
		if query == "" || strings.Contains(haystack, query) {
			next = append(next, i)
		}
	}
	m.filtered = next
	if len(m.filtered) == 0 {
		m.cursor = 0
		return
	}
	if m.cursor >= len(m.filtered) {
		m.cursor = len(m.filtered) - 1
	}
}

func (m searchModel) View() string {
	title := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("205")).Render("MirrorPilot Search")
	help := lipgloss.NewStyle().Foreground(lipgloss.Color("241")).Render("Type to filter • ↑/↓ move • Enter select • q quit")
	query := lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).Padding(0, 1).Render("Query: " + m.input.View())

	leftWidth := m.width / 2
	if leftWidth < 40 {
		leftWidth = 40
	}
	rightWidth := m.width - leftWidth - 1
	if rightWidth < 30 {
		rightWidth = 30
	}

	lines := make([]string, 0, len(m.filtered))
	for i, idx := range m.filtered {
		item := m.items[idx]
		row := fmt.Sprintf("%s  %s => %s", item.Profile, item.Source, item.Target)
		if i == m.cursor {
			row = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("229")).Background(lipgloss.Color("62")).Render("▶ " + row)
		} else {
			row = "  " + row
		}
		lines = append(lines, row)
	}
	if len(lines) == 0 {
		lines = append(lines, "  No matched images")
	}
	listPane := lipgloss.NewStyle().
		Width(leftWidth).
		Height(maxInt(m.height-7, 8)).
		Border(lipgloss.RoundedBorder()).
		Padding(0, 1).
		Render(strings.Join(lines, "\n"))

	detail := "No selection"
	if len(m.filtered) > 0 {
		item := m.items[m.filtered[m.cursor]]
		detail = strings.Join([]string{
			fmt.Sprintf("Profile: %s", item.Profile),
			fmt.Sprintf("Enabled: %t", item.Enabled),
			fmt.Sprintf("Synced: %t", item.Synced),
			fmt.Sprintf("Source: %s", item.Source),
			fmt.Sprintf("Target: %s", item.Target),
			fmt.Sprintf("Full Source: %s", item.FullSource),
			fmt.Sprintf("Full Target: %s", item.FullTarget),
			fmt.Sprintf("Created At: %s", item.CreatedAt),
			fmt.Sprintf("Synced At: %s", item.SyncedAt),
			fmt.Sprintf("Notes: %s", item.Notes),
		}, "\n")
	}
	detailPane := lipgloss.NewStyle().
		Width(rightWidth).
		Height(maxInt(m.height-7, 8)).
		Border(lipgloss.RoundedBorder()).
		Padding(0, 1).
		Render(detail)

	body := lipgloss.JoinHorizontal(lipgloss.Top, listPane, detailPane)
	return strings.Join([]string{title, help, query, body}, "\n")
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
