/**
 * 配色主题（v0.8.18）：强调色独立于明暗模式，每套主题给浅/深两套令牌值。
 * 约定：
 * - 浅色模式 --accent 为深色（白字可读），--accent-ink 供浅底文字/图标使用；
 * - 深色模式 --accent 为中等饱和（同样白字可读，替换旧的浅色底+白字），--accent-ink 为亮色调（暗底文字）；
 * - 深色模式可覆盖 bg/panel/chrome 做撞色底（浅色模式不覆盖，保持中性底）。
 * 按钮等 accent 底上的文字一律用 --accent-contrast（见 tokens.css）。
 */

export interface AccentVars {
  accent: string
  accentHover: string
  accentInk: string
  accentSoft: string
  /** 深色撞色底（仅 dark 提供） */
  bg?: string
  panel?: string
  chrome?: string
}

export interface AccentTheme {
  id: string
  name: { zh: string; en: string }
  light: AccentVars
  dark: AccentVars
}

export const ACCENT_THEMES: AccentTheme[] = [
  {
    id: 'sage',
    name: { zh: '鼠尾草', en: 'Sage' },
    light: { accent: '#6b8f77', accentHover: '#5f8270', accentInk: '#52735e', accentSoft: 'rgba(107, 143, 119, 0.14)' },
    dark: { accent: '#4f9569', accentHover: '#5da678', accentInk: '#9dbba3', accentSoft: 'rgba(157, 187, 163, 0.16)' }
  },
  {
    id: 'ink',
    name: { zh: '墨稿', en: 'Ink' },
    light: { accent: '#3a3b40', accentHover: '#2e2f34', accentInk: '#3a3b40', accentSoft: 'rgba(58, 59, 64, 0.1)' },
    dark: {
      accent: '#7c7f8c',
      accentHover: '#8b8e9b',
      accentInk: '#c3c6d1',
      accentSoft: 'rgba(195, 198, 209, 0.14)',
      bg: '#0a0a0c',
      panel: '#121215',
      chrome: '#0e0e11'
    }
  },
  {
    id: 'fawn',
    name: { zh: '雁皮', en: 'Fawn' },
    light: { accent: '#96683f', accentHover: '#865c37', accentInk: '#8a5f39', accentSoft: 'rgba(150, 104, 63, 0.14)' },
    dark: {
      accent: '#b07a45',
      accentHover: '#bf8852',
      accentInk: '#d9b28c',
      accentSoft: 'rgba(217, 178, 140, 0.15)',
      bg: '#120e0a',
      panel: '#1a1410',
      chrome: '#161009'
    }
  },
  {
    id: 'mist',
    name: { zh: '薄雾', en: 'Mist' },
    light: { accent: '#4e718c', accentHover: '#43627b', accentInk: '#476982', accentSoft: 'rgba(78, 113, 140, 0.13)' },
    dark: {
      accent: '#5c89ab',
      accentHover: '#6c99b9',
      accentInk: '#9cc2da',
      accentSoft: 'rgba(156, 194, 218, 0.15)',
      bg: '#0b0f13',
      panel: '#131920',
      chrome: '#0f151b'
    }
  },
  {
    id: 'breeze',
    name: { zh: '清风', en: 'Breeze' },
    light: { accent: '#188a50', accentHover: '#147946', accentInk: '#157a46', accentSoft: 'rgba(24, 138, 80, 0.13)' },
    dark: {
      accent: '#2f9e63',
      accentHover: '#3cb371',
      accentInk: '#6fdd9a',
      accentSoft: 'rgba(111, 221, 154, 0.14)',
      bg: '#0a120d',
      panel: '#111a14',
      chrome: '#0d150f'
    }
  },
  {
    id: 'pulse',
    name: { zh: '脉搏', en: 'Pulse' },
    light: { accent: '#d9480f', accentHover: '#c2410c', accentInk: '#c2410c', accentSoft: 'rgba(217, 72, 15, 0.12)' },
    dark: {
      accent: '#e8590c',
      accentHover: '#f76707',
      accentInk: '#ffa94d',
      accentSoft: 'rgba(255, 169, 77, 0.15)',
      bg: '#130d09',
      panel: '#1c1410',
      chrome: '#171009'
    }
  },
  {
    id: 'voyage',
    name: { zh: '远航', en: 'Voyage' },
    light: { accent: '#1971c2', accentHover: '#1864ab', accentInk: '#1864ab', accentSoft: 'rgba(25, 113, 194, 0.12)' },
    dark: {
      accent: '#2b7fd4',
      accentHover: '#3b8fe2',
      accentInk: '#74b6f0',
      accentSoft: 'rgba(116, 182, 240, 0.14)',
      bg: '#0a0f15',
      panel: '#121821',
      chrome: '#0e141c'
    }
  },
  {
    id: 'berry',
    name: { zh: '莓果', en: 'Berry' },
    light: { accent: '#b82e59', accentHover: '#a52850', accentInk: '#a52850', accentSoft: 'rgba(184, 46, 89, 0.11)' },
    dark: {
      accent: '#d6456f',
      accentHover: '#e35a81',
      accentInk: '#f39ab3',
      accentSoft: 'rgba(243, 154, 179, 0.14)',
      bg: '#120a0d',
      panel: '#1a1014',
      chrome: '#150d10'
    }
  }
]

export const DEFAULT_ACCENT = 'sage'
export const ACCENT_IDS: string[] = ACCENT_THEMES.map((t) => t.id)

/** 取主题；未知 id（含 undefined）回退默认鼠尾草 */
export function resolveAccent(id: string | undefined): AccentTheme {
  return ACCENT_THEMES.find((t) => t.id === id) ?? ACCENT_THEMES[0]
}

/** 两个 hex 按比例混合（t=0 → a，t=1 → b），给色板预览算中间调 */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a)
  const pb = parseHex(b)
  if (!pa || !pb) return a
  const ch = (i: number): number => Math.round(pa[i] + (pb[i] - pa[i]) * t)
  return `#${[0, 1, 2].map((i) => ch(i).toString(16).padStart(2, '0')).join('')}`
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
