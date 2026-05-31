package cli

import (
	"strings"
	"unicode/utf8"
)

func renderGridTable(headers []string, rows [][]string, maxColWidth int) string {
	if len(headers) == 0 {
		return ""
	}
	if maxColWidth <= 0 {
		maxColWidth = 40
	}

	widths := make([]int, len(headers))
	for i, h := range headers {
		widths[i] = minInt(displayWidth(h), maxColWidth)
	}
	for _, row := range rows {
		for i := 0; i < len(headers) && i < len(row); i++ {
			w := minInt(displayWidth(row[i]), maxColWidth)
			if w > widths[i] {
				widths[i] = w
			}
		}
	}

	var b strings.Builder
	border := func() {
		b.WriteString("+")
		for _, w := range widths {
			b.WriteString(strings.Repeat("-", w+2))
			b.WriteString("+")
		}
		b.WriteString("\n")
	}
	writeRow := func(cols []string) {
		b.WriteString("|")
		for i := range headers {
			cell := ""
			if i < len(cols) {
				cell = truncateCell(cols[i], widths[i])
			}
			padding := widths[i] - displayWidth(cell)
			if padding < 0 {
				padding = 0
			}
			b.WriteString(" ")
			b.WriteString(cell)
			b.WriteString(strings.Repeat(" ", padding+1))
			b.WriteString("|")
		}
		b.WriteString("\n")
	}

	border()
	writeRow(headers)
	border()
	for _, row := range rows {
		writeRow(row)
	}
	border()
	return b.String()
}

func truncateCell(s string, max int) string {
	if max <= 0 {
		return ""
	}
	s = strings.TrimSpace(s)
	if displayWidth(s) <= max {
		return s
	}
	if max <= 1 {
		return "…"
	}
	runes := []rune(s)
	if len(runes) > max-1 {
		runes = runes[:max-1]
	}
	return string(runes) + "…"
}

func displayWidth(s string) int {
	return utf8.RuneCountInString(s)
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
