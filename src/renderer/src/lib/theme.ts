import { customTokens, loadCustomTheme } from './custom-theme'

export const THEMES = [
  { id: 'opala-negra', label: 'Opala Negra' },
  { id: 'opala-branca', label: 'Opala Branca' },
  { id: 'opala-de-fogo', label: 'Opala de Fogo' },
  { id: 'personalizado', label: 'Personalizado' },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

const STORAGE_KEY = 'opalite:theme'
/** Variáveis aplicadas em linha pelo tema personalizado (para poder limpar depois). */
let inlineKeys: string[] = []
const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true

export function loadTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (THEMES.some((t) => t.id === saved)) return saved as ThemeId
  } catch {
    // armazenamento indisponível: usa o padrão
  }
  return 'opala-negra'
}

export function applyTheme(id: ThemeId): void {
  const root = document.documentElement
  for (const key of inlineKeys) root.style.removeProperty(key)
  inlineKeys = []

  if (id === 'personalizado') {
    const theme = loadCustomTheme()
    const tokens = customTokens(theme, systemDark())
    for (const [key, value] of Object.entries(tokens)) root.style.setProperty(key, value)
    inlineKeys = Object.keys(tokens)
    root.dataset['textured'] = theme.texture > 0.01 ? 'true' : 'false'
    root.dataset['gradient'] = theme.gradient.enabled ? 'true' : 'false'
  } else {
    root.dataset['textured'] = 'false'
    root.dataset['gradient'] = 'false'
  }
  root.dataset['theme'] = id
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // sem problema: o tema só não será lembrado
  }
  window.dispatchEvent(new Event('opalite:theme'))
}

// Tema personalizado em modo "automático" acompanha o claro/escuro do sistema.
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (loadTheme() === 'personalizado') applyTheme('personalizado')
})

export function nextTheme(current: ThemeId): ThemeId {
  const i = THEMES.findIndex((t) => t.id === current)
  return THEMES[(i + 1) % THEMES.length]!.id
}

export function themeLabel(id: ThemeId): string {
  return THEMES.find((t) => t.id === id)?.label ?? id
}
