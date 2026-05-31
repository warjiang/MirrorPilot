package cli

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
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
	items         []searchItem
	filtered      []int
	cursor        int
	offset        int
	width         int
	height        int
	query         string
	searchMode    bool
	searchDraft   string
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
			if err := ensureRemoteConfigured(cfg); err != nil {
				return err
			}

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
	m := searchModel{
		items:    items,
		filtered: make([]int, len(items)),
		width:    120,
		height:   30,
	}
	for i := range items {
		m.filtered[i] = i
	}
	return m
}

func (m searchModel) Init() tea.Cmd { return nil }

func (m searchModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil
	case tea.KeyMsg:
		if msg.Type == tea.KeyCtrlC {
			return m, tea.Quit
		}
		if m.searchMode {
			return m.updateSearchMode(msg)
		}
		switch msg.String() {
		case "q", "esc":
			return m, tea.Quit
		case "/":
			m.searchMode = true
			m.searchDraft = m.query
			return m, nil
		case "up", "k":
			m.moveCursor(-1)
			return m, nil
		case "down", "j":
			m.moveCursor(1)
			return m, nil
		case "enter":
			if len(m.filtered) > 0 {
				selected := m.items[m.filtered[m.cursor]]
				m.confirmedItem = &selected
			}
			return m, tea.Quit
		}
	}
	return m, nil
}

func (m searchModel) updateSearchMode(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.Type {
	case tea.KeyEsc:
		m.searchMode = false
		return m, nil
	case tea.KeyEnter:
		m.query = strings.TrimSpace(m.searchDraft)
		m.applyFilter()
		m.searchMode = false
		return m, nil
	case tea.KeyBackspace, tea.KeyCtrlH:
		r := []rune(m.searchDraft)
		if len(r) > 0 {
			m.searchDraft = string(r[:len(r)-1])
		}
		return m, nil
	case tea.KeyRunes:
		m.searchDraft += msg.String()
		return m, nil
	}
	return m, nil
}

func (m *searchModel) applyFilter() {
	query := strings.ToLower(strings.TrimSpace(m.query))
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
		m.offset = 0
		return
	}
	if m.cursor >= len(m.filtered) {
		m.cursor = len(m.filtered) - 1
	}
	m.ensureCursorVisible()
}

func (m *searchModel) moveCursor(step int) {
	if len(m.filtered) == 0 {
		return
	}
	next := m.cursor + step
	if next < 0 {
		next = 0
	}
	if next >= len(m.filtered) {
		next = len(m.filtered) - 1
	}
	m.cursor = next
	m.ensureCursorVisible()
}

func (m *searchModel) ensureCursorVisible() {
	tableHeight := m.visibleRows()
	if tableHeight < 1 {
		tableHeight = 1
	}
	if m.cursor < m.offset {
		m.offset = m.cursor
	}
	if m.cursor >= m.offset+tableHeight {
		m.offset = m.cursor - tableHeight + 1
	}
	if m.offset < 0 {
		m.offset = 0
	}
}

func (m searchModel) visibleRows() int {
	h := m.height - 8
	if h < 3 {
		h = 3
	}
	return h
}

func (m searchModel) View() string {
	modeLine := "Mode: normal  (j/k or ↑/↓ move, / search, Enter select, q quit)"
	if m.searchMode {
		modeLine = "Mode: search  /" + m.searchDraft + "  (Enter apply, Esc cancel)"
	}

	headers := []string{"SEL", "PROFILE", "EN", "SYNCED", "SOURCE", "TARGET", "FULL_TARGET"}
	tableRows := make([][]string, 0, m.visibleRows())
	end := m.offset + m.visibleRows()
	if end > len(m.filtered) {
		end = len(m.filtered)
	}
	for idx := m.offset; idx < end; idx++ {
		item := m.items[m.filtered[idx]]
		sel := " "
		if idx == m.cursor {
			sel = ">"
		}
		tableRows = append(tableRows, []string{
			sel,
			item.Profile,
			boolYN(item.Enabled),
			boolYN(item.Synced),
			item.Source,
			item.Target,
			item.FullTarget,
		})
	}
	if len(tableRows) == 0 {
		tableRows = append(tableRows, []string{" ", "-", "-", "-", "No matched images", "-", "-"})
	}

	status := fmt.Sprintf("Rows: %d  Query: /%s", len(m.filtered), m.query)
	detail := "Selection: none"
	if len(m.filtered) > 0 {
		item := m.items[m.filtered[m.cursor]]
		detail = fmt.Sprintf("Selection: profile=%s source=%s target=%s full_target=%s", item.Profile, item.Source, item.Target, item.FullTarget)
	}

	return strings.Join([]string{
		"MirrorPilot Search",
		modeLine,
		status,
		renderGridTable(headers, tableRows, 36),
		detail,
	}, "\n")
}

func boolYN(v bool) string {
	if v {
		return "Y"
	}
	return "N"
}
