const ESC = '\\u001b'
const OSC = new RegExp(`${ESC}\\][^\\u0007\\u001b]*(?:\\u0007|${ESC}\\\\)`, 'g')
const DCS_PM_APC = new RegExp(`${ESC}[P^_].*?${ESC}\\\\`, 'gs')
const CSI = new RegExp(`${ESC}\\[[0-9:;?]*[ -/]*[@-~]`, 'g')
const SINGLE_ESCAPE = new RegExp(`${ESC}[@-Z\\\\-_]`, 'g')
const SGR = new RegExp(`${ESC}\\[([0-9:;]*)m`, 'g')

type AnsiStyleState = {
  bold: boolean
  italic: boolean
  underline: boolean
  fg: string | null
  bg: string | null
}

const ANSI_COLOR_CLASS: Record<number, string> = {
  30: 'ansi-fg-black',
  31: 'ansi-fg-red',
  32: 'ansi-fg-green',
  33: 'ansi-fg-yellow',
  34: 'ansi-fg-blue',
  35: 'ansi-fg-magenta',
  36: 'ansi-fg-cyan',
  37: 'ansi-fg-white',
  90: 'ansi-fg-bright-black',
  91: 'ansi-fg-bright-red',
  92: 'ansi-fg-bright-green',
  93: 'ansi-fg-bright-yellow',
  94: 'ansi-fg-bright-blue',
  95: 'ansi-fg-bright-magenta',
  96: 'ansi-fg-bright-cyan',
  97: 'ansi-fg-bright-white',
  40: 'ansi-bg-black',
  41: 'ansi-bg-red',
  42: 'ansi-bg-green',
  43: 'ansi-bg-yellow',
  44: 'ansi-bg-blue',
  45: 'ansi-bg-magenta',
  46: 'ansi-bg-cyan',
  47: 'ansi-bg-white',
  100: 'ansi-bg-bright-black',
  101: 'ansi-bg-bright-red',
  102: 'ansi-bg-bright-green',
  103: 'ansi-bg-bright-yellow',
  104: 'ansi-bg-bright-blue',
  105: 'ansi-bg-bright-magenta',
  106: 'ansi-bg-bright-cyan',
  107: 'ansi-bg-bright-white',
}

const SENSITIVE_KEY = '(?:password|passwd|token|secret|authorization|api[_-]?key|access[_-]?key)'

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function stripUnsafeControlSequences(input: string): string {
  return input
    .replace(/\r(?!\n)/g, '')
    .replace(OSC, '')
    .replace(DCS_PM_APC, '')
    .replace(CSI, (m) => (m.endsWith('m') ? m : ''))
    .replace(SINGLE_ESCAPE, '')
}

export function maskSensitivePairs(input: string): string {
  return input
    .replace(
      new RegExp(`("${SENSITIVE_KEY}"\\s*:\\s*)"[^"]*"`, 'gi'),
      '$1"***"'
    )
    .replace(
      new RegExp(`(\\b${SENSITIVE_KEY}\\b\\s*(?:=|:)\\s*)([^\\s"']+)`, 'gi'),
      '$1***'
    )
    .replace(/(Authorization:\s*Bearer\s+)([^\s]+)/gi, '$1***')
    .replace(/(--dest-creds\s+[^:\s]+:)([^\s]+)/g, '$1***')
}

function styleToClassList(style: AnsiStyleState): string[] {
  const classes: string[] = []
  if (style.bold) classes.push('ansi-bold')
  if (style.italic) classes.push('ansi-italic')
  if (style.underline) classes.push('ansi-underline')
  if (style.fg) classes.push(style.fg)
  if (style.bg) classes.push(style.bg)
  return classes
}

function applySgrCodes(style: AnsiStyleState, codes: number[]): AnsiStyleState {
  const next = { ...style }
  const normalized = codes.length ? codes : [0]

  for (const code of normalized) {
    if (code === 0) {
      next.bold = false
      next.italic = false
      next.underline = false
      next.fg = null
      next.bg = null
      continue
    }
    if (code === 1) next.bold = true
    if (code === 3) next.italic = true
    if (code === 4) next.underline = true
    if (code === 22) next.bold = false
    if (code === 23) next.italic = false
    if (code === 24) next.underline = false
    if (code === 39) next.fg = null
    if (code === 49) next.bg = null
    if (ANSI_COLOR_CLASS[code]?.startsWith('ansi-fg-')) next.fg = ANSI_COLOR_CLASS[code]
    if (ANSI_COLOR_CLASS[code]?.startsWith('ansi-bg-')) next.bg = ANSI_COLOR_CLASS[code]
  }
  return next
}

export function renderAnsiHtml(input: string): string {
  const initial: AnsiStyleState = { bold: false, italic: false, underline: false, fg: null, bg: null }
  let style = initial
  let lastIndex = 0
  let out = ''
  let match: RegExpExecArray | null

  SGR.lastIndex = 0
  while ((match = SGR.exec(input)) !== null) {
    const chunk = input.slice(lastIndex, match.index)
    if (chunk) {
      const classes = styleToClassList(style)
      const text = escapeHtml(chunk)
      out += classes.length ? `<span class="${classes.join(' ')}">${text}</span>` : text
    }

    const codes = match[1]
      .split(/[;:]/)
      .filter(Boolean)
      .map((v) => Number.parseInt(v, 10))
      .filter((v) => Number.isFinite(v))
    style = applySgrCodes(style, codes)
    lastIndex = match.index + match[0].length
  }

  const tail = input.slice(lastIndex)
  if (tail) {
    const classes = styleToClassList(style)
    const text = escapeHtml(tail)
    out += classes.length ? `<span class="${classes.join(' ')}">${text}</span>` : text
  }
  return out
}

export function formatLogHtml(raw: string): string {
  return renderAnsiHtml(maskSensitivePairs(stripUnsafeControlSequences(raw)))
}
