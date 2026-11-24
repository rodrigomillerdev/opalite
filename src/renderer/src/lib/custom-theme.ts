/*
 * Tema personalizado: a pessoa escolhe até 3 cores num campo 2D, a
 * intensidade com que elas tingem a interface e uma textura granulada.
 * Daqui sai o conjunto completo de variáveis CSS (as mesmas de tokens.css).
 *
 * Campo de cores: x = matiz (0° a 360°), y = saturação (topo vívido, base suave).
 */

export type ThemeMode = 'auto' | 'light' | 'dark'

export interface ColorPoint {
  /** 0..1 da esquerda para a direita (matiz). */
  x: number
  /** 0..1 de cima para baixo (topo = mais saturado). */
  y: number
}

export interface CustomTheme {
  mode: ThemeMode
  colors: ColorPoint[]
  /** Granulado de 0 (liso) a 1 (bem texturizado). */
  texture: number
  /** Quanto as cores tingem fundos e bordas, de 0 a 1. */
  intensity: number
  harmony: Harmony
  /** Cores escolhidas à mão para elementos específicos (variável CSS -> cor). */
  overrides: Record<string, string>
  gradient: ThemeGradient
}

export interface ThemeGradient {
  enabled: boolean
  /** 2 a 5 cores (#rrggbb). */
  stops: string[]
  /** Direção em graus (0 = de baixo para cima, 90 = da esquerda para a direita). */
  angle: number
  /** Quanto o gradiente aparece através das barras e painéis (0..1). */
  intensity: number
  kind: 'linear' | 'radial'
}

/** Elementos da interface que podem ter cor própria, em grupos. */
export const THEME_ELEMENTS: Array<{ group: string; items: Array<{ token: string; label: string }> }> = [
  {
    group: 'Fundos',
    items: [
      { token: '--bg-0', label: 'Barras (título, lateral, status)' },
      { token: '--bg-1', label: 'Painéis e menus' },
      { token: '--bg-2', label: 'Área de edição' },
      { token: '--bg-hover', label: 'Item sob o mouse' },
      { token: '--bg-active', label: 'Item selecionado' },
      { token: '--code-bg', label: 'Blocos de código' },
    ],
  },
  {
    group: 'Texto e bordas',
    items: [
      { token: '--text-0', label: 'Texto principal' },
      { token: '--text-1', label: 'Texto do corpo' },
      { token: '--text-2', label: 'Texto secundário' },
      { token: '--text-3', label: 'Texto suave' },
      { token: '--border', label: 'Bordas' },
      { token: '--border-strong', label: 'Bordas fortes' },
    ],
  },
  {
    group: 'Destaques',
    items: [
      { token: '--accent', label: 'Botões e links' },
      { token: '--accent-contrast', label: 'Texto sobre botões' },
      { token: '--danger', label: 'Ações perigosas' },
      { token: '--opal-1', label: 'Opala 1 (títulos, iridescência)' },
      { token: '--opal-2', label: 'Opala 2' },
      { token: '--opal-3', label: 'Opala 3' },
      { token: '--opal-4', label: 'Opala 4' },
    ],
  },
  {
    group: 'Gráfico de conexões',
    items: [
      { token: '--graph-node', label: 'Nós' },
      { token: '--graph-link', label: 'Conexões' },
      { token: '--graph-highlight', label: 'Destaque ao passar o mouse' },
    ],
  },
]

const EDITABLE = new Set(THEME_ELEMENTS.flatMap((g) => g.items.map((i) => i.token)))

export const DEFAULT_GRADIENT: ThemeGradient = { enabled: false, stops: ['#7c6cf0', '#4fb3bf', '#f2a65a'], angle: 135, intensity: 0.5, kind: 'linear' }

export type Harmony = 'analogous' | 'complementary' | 'triad'
export const HARMONY_LABEL: Record<Harmony, string> = {
  analogous: 'Análoga',
  complementary: 'Complementar',
  triad: 'Tríade',
}

export const DEFAULT_CUSTOM: CustomTheme = {
  mode: 'dark',
  colors: [{ x: 0.7, y: 0.35 }],
  texture: 0.35,
  intensity: 0.5,
  harmony: 'analogous',
  overrides: {},
  gradient: DEFAULT_GRADIENT,
}

const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v))

// ------------------------------------------------------------ cores

export interface Hsl {
  h: number
  s: number
  l: number
}

export function hslToHex({ h, s, l }: Hsl): string {
  const hue = ((h % 360) + 360) % 360
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + hue / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

export function hexToHsl(hex: string): Hsl {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { h: 0, s: 0, l: 0.5 }
  const n = parseInt(m[1]!, 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  return { h: (h + 360) % 360, s, l }
}

/** Posição no campo -> cor de referência (a que aparece na bolinha). */
export function pointToHsl(p: ColorPoint): Hsl {
  return { h: p.x * 360, s: clamp(0.95 - p.y * 0.8, 0.12, 0.95), l: 0.68 + p.y * 0.12 }
}

/** Cor qualquer -> posição no campo (para as amostras prontas). */
export function hexToPoint(hex: string): ColorPoint {
  const { h, s } = hexToHsl(hex)
  return { x: h / 360, y: clamp((0.95 - s) / 0.8) }
}

export function pointToHex(p: ColorPoint): string {
  return hslToHex(pointToHsl(p))
}

/** Reposiciona as cores secundárias segundo a harmonia escolhida. */
export function applyHarmony(colors: ColorPoint[], harmony: Harmony): ColorPoint[] {
  const [base, ...rest] = colors
  if (!base || rest.length === 0) return colors
  const offsets = harmony === 'analogous' ? [0.08, -0.08] : harmony === 'complementary' ? [0.5, 0.42] : [1 / 3, 2 / 3]
  return [base, ...rest.map((_, i) => ({ x: (base.x + offsets[i]! + 1) % 1, y: clamp(base.y + (i ? 0.12 : 0.06)) }))]
}

export const NEXT_HARMONY: Record<Harmony, Harmony> = { analogous: 'complementary', complementary: 'triad', triad: 'analogous' }

/** Amostras prontas (como paletas de tecido): duas páginas de oito. */
export const SWATCHES: string[][] = [
  ['#f2ead3', '#efb8cb', '#e3c1e6', '#d9707f', '#ee8a6a', '#dccb72', '#5ce8ae', '#8f9bbd'],
  ['#7cb2ff', '#78dcc0', '#b39bff', '#ffb48a', '#ff8a5c', '#6fd3e6', '#c6e377', '#f28fd0'],
]

// ------------------------------------------------------------ tokens

export function resolveMode(mode: ThemeMode, systemDark: boolean): 'light' | 'dark' {
  return mode === 'auto' ? (systemDark ? 'dark' : 'light') : mode
}

/** Gera todas as variáveis CSS do tema. */
export function customTokens(theme: CustomTheme, systemDark: boolean): Record<string, string> {
  const dark = resolveMode(theme.mode, systemDark) === 'dark'
  const colors = theme.colors.length ? theme.colors : DEFAULT_CUSTOM.colors
  const primary = pointToHsl(colors[0]!)
  const hue = primary.h
  // Fundos e bordas: pedra neutra levemente tingida pela cor principal.
  const tint = clamp(primary.s * theme.intensity * (dark ? 0.32 : 0.42), 0, 0.4)
  const stone = (l: number, extraSat = 0) => hslToHex({ h: hue, s: clamp(tint + extraSat), l })
  const text = (l: number) => hslToHex({ h: hue, s: clamp(tint * 0.5), l })

  const palette = [0, 1, 2, 3].map((i) => {
    const point = colors[i]
    if (point) return pointToHsl(point)
    // Faltam cores: gira a matiz principal para completar o "jogo de cores".
    return { ...primary, h: hue + [0, 50, 140, 220][i]! }
  })
  const opal = palette.map((c) => hslToHex({ h: c.h, s: clamp(c.s, 0.45, 0.9), l: dark ? 0.72 : 0.46 }))
  const accent = hslToHex({ h: hue, s: clamp(primary.s, 0.5, 0.95), l: dark ? 0.76 : 0.45 })

  const base: Record<string, string> = dark
    ? {
        '--bg-0': stone(0.055),
        '--bg-1': stone(0.075),
        '--bg-2': stone(0.095),
        '--bg-hover': stone(0.13),
        '--bg-active': stone(0.16),
        '--border': stone(0.15),
        '--border-strong': stone(0.21),
        '--text-0': text(0.93),
        '--text-1': text(0.76),
        '--text-2': text(0.58),
        '--text-3': text(0.41),
        '--code-bg': stone(0.12),
        '--danger': '#ff8a8a',
        '--accent-contrast': stone(0.06),
        '--shadow': '0 12px 32px rgba(0, 0, 0, 0.45)',
        'color-scheme': 'dark',
      }
    : {
        '--bg-0': stone(0.925),
        '--bg-1': stone(0.95),
        '--bg-2': stone(0.982),
        '--bg-hover': stone(0.9),
        '--bg-active': stone(0.87),
        '--border': stone(0.88),
        '--border-strong': stone(0.81),
        '--text-0': text(0.12),
        '--text-1': text(0.29),
        '--text-2': text(0.44),
        '--text-3': text(0.62),
        '--code-bg': stone(0.93),
        '--danger': '#c43c3c',
        '--accent-contrast': '#ffffff',
        '--shadow': '0 12px 32px rgba(40, 36, 30, 0.12)',
        'color-scheme': 'light',
      }

  const [o1, o2, o3, o4] = opal as [string, string, string, string]
  return {
    ...base,
    '--accent': accent,
    '--selection': `${accent}${dark ? '38' : '29'}`,
    '--opal-1': o1,
    '--opal-2': o2,
    '--opal-3': o3,
    '--opal-4': o4,
    '--syn-keyword': o3,
    '--syn-string': o2,
    '--syn-number': o4,
    '--syn-function': o1,
    '--syn-type': hslToHex({ h: hue + 170, s: 0.5, l: dark ? 0.68 : 0.4 }),
    '--syn-comment': base['--text-3']!,
    '--syn-operator': base['--text-2']!,
    '--texture': String(Math.round(theme.texture * 100) / 100),
    ...validOverrides(theme.overrides),
    ...gradientTokens(theme, dark, base),
  }
}

function validOverrides(o: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(o ?? {})) if (EDITABLE.has(k) && /^#[0-9a-f]{6}$/i.test(v)) out[k] = v
  return out
}

/** CSS do gradiente (fundo da janela) e barras translúcidas para ele aparecer. */
export function gradientCss(g: ThemeGradient): string {
  const stops = g.stops.filter((s) => /^#[0-9a-f]{6}$/i.test(s))
  const list = (stops.length >= 2 ? stops : DEFAULT_GRADIENT.stops).join(', ')
  return g.kind === 'radial' ? `radial-gradient(circle at 30% 20%, ${list})` : `linear-gradient(${Math.round(g.angle)}deg, ${list})`
}

function gradientTokens(theme: CustomTheme, dark: boolean, base: Record<string, string>): Record<string, string> {
  const g = theme.gradient
  if (!g?.enabled) return {}
  // As barras e painéis ficam translúcidos na medida da intensidade; a área de
  // edição continua opaca para o texto seguir legível.
  const see = Math.round(clamp(g.intensity) * (dark ? 62 : 55))
  const bg0 = theme.overrides?.['--bg-0'] ?? base['--bg-0']!
  const bg1 = theme.overrides?.['--bg-1'] ?? base['--bg-1']!
  return {
    '--app-gradient': gradientCss(g),
    '--bg-0': `color-mix(in srgb, ${bg0} ${100 - see}%, transparent)`,
    '--bg-1': `color-mix(in srgb, ${bg1} ${100 - Math.round(see * 0.6)}%, transparent)`,
  }
}

// ------------------------------------------------------------ armazenamento

const KEY = 'opalite:custom-theme'

export function loadCustomTheme(): CustomTheme {
  try {
    return sanitizeCustomTheme(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    return DEFAULT_CUSTOM
  }
}

/** Valida um tema vindo do armazenamento ou de um arquivo (campos desconhecidos são ignorados). */
export function sanitizeCustomTheme(input: unknown): CustomTheme {
  const raw = input as Partial<CustomTheme> | null
  if (!raw || typeof raw !== 'object') return DEFAULT_CUSTOM
  const colors = Array.isArray(raw.colors)
    ? raw.colors.filter((c) => c && typeof c.x === 'number' && typeof c.y === 'number').slice(0, 3).map((c) => ({ x: clamp(c.x), y: clamp(c.y) }))
    : DEFAULT_CUSTOM.colors
  return {
    mode: raw.mode === 'auto' || raw.mode === 'light' || raw.mode === 'dark' ? raw.mode : 'dark',
    colors: colors.length ? colors : DEFAULT_CUSTOM.colors,
    texture: clamp(Number(raw.texture ?? DEFAULT_CUSTOM.texture)),
    intensity: clamp(Number(raw.intensity ?? DEFAULT_CUSTOM.intensity)),
    harmony: raw.harmony && raw.harmony in HARMONY_LABEL ? raw.harmony : 'analogous',
    overrides: validOverrides(raw.overrides),
    gradient: sanitizeGradient(raw.gradient),
  }
}

function sanitizeGradient(raw: Partial<ThemeGradient> | undefined): ThemeGradient {
  if (!raw || typeof raw !== 'object') return DEFAULT_GRADIENT
  const stops = Array.isArray(raw.stops) ? raw.stops.filter((s) => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s)).slice(0, 5) : []
  return {
    enabled: Boolean(raw.enabled),
    stops: stops.length >= 2 ? stops : DEFAULT_GRADIENT.stops,
    angle: Number.isFinite(raw.angle) ? ((Number(raw.angle) % 360) + 360) % 360 : DEFAULT_GRADIENT.angle,
    intensity: clamp(Number(raw.intensity ?? DEFAULT_GRADIENT.intensity)),
    kind: raw.kind === 'radial' ? 'radial' : 'linear',
  }
}

// ------------------------------------------------------------ temas salvos

export interface SavedTheme {
  id: string
  name: string
  theme: CustomTheme
}

const SAVED_KEY = 'opalite:saved-themes'

export function loadSavedThemes(): SavedTheme[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]') as SavedTheme[]
    if (!Array.isArray(raw)) return []
    return raw
      .filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string')
      .map((s) => ({ id: s.id, name: s.name.slice(0, 60), theme: sanitizeCustomTheme(s.theme) }))
  } catch {
    return []
  }
}

export function storeSavedThemes(list: SavedTheme[]): void {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list))
  } catch {
    // sem armazenamento
  }
}

export function saveCustomTheme(theme: CustomTheme): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(theme))
  } catch {
    // sem armazenamento
  }
}
