import { dailyNoteSettings, saveDailyNoteSettings, type DailySettings } from './daily'

/*
 * Preferências do app (guardadas no próprio computador). A aparência é
 * aplicada por variáveis CSS, então muda na hora, sem recarregar.
 */

export type TextFont = 'sans' | 'serif' | 'mono'

export interface AppSettings {
  editorFontSize: number
  /** Largura máxima da linha de texto (px). 0 = ocupar toda a largura. */
  lineWidth: number
  textFont: TextFont
  lineHeight: number
  spellcheck: boolean
  attachmentsFolder: string
  /** Onde nascem as notas novas: pasta da nota atual ou raiz do cofre. */
  newNoteLocation: 'current' | 'root'
  /** Reduz animações além do que o sistema já pede. */
  reduceMotion: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  editorFontSize: 16,
  lineWidth: 720,
  textFont: 'sans',
  lineHeight: 1.72,
  spellcheck: true,
  attachmentsFolder: 'Anexos',
  newNoteLocation: 'current',
  reduceMotion: false,
}

const KEY = 'opalite:settings'
let cache: AppSettings | null = null
const listeners = new Set<(s: AppSettings) => void>()

export function getSettings(): AppSettings {
  if (cache) return cache
  try {
    cache = { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AppSettings>) }
  } catch {
    cache = { ...DEFAULT_SETTINGS }
  }
  return cache
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  cache = { ...getSettings(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    // sem armazenamento: vale só nesta sessão
  }
  applySettings(cache)
  for (const fn of listeners) fn(cache)
  return cache
}

export function onSettingsChange(fn: (s: AppSettings) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const FONTS: Record<TextFont, string> = {
  sans: "'Inter Variable', 'Segoe UI Variable', system-ui, sans-serif",
  serif: "'Iowan Old Style', 'Charter', 'Georgia', 'Cambria', serif",
  mono: "'JetBrains Mono Variable', 'Cascadia Code', Consolas, monospace",
}

export function applySettings(s: AppSettings = getSettings()): void {
  const root = document.documentElement.style
  root.setProperty('--editor-font-size', `${s.editorFontSize}px`)
  root.setProperty('--editor-measure', s.lineWidth > 0 ? `${s.lineWidth}px` : '100%')
  root.setProperty('--font-text', FONTS[s.textFont])
  root.setProperty('--editor-line-height', String(s.lineHeight))
  document.documentElement.classList.toggle('reduce-motion', s.reduceMotion)
  for (const el of document.querySelectorAll<HTMLElement>('.cm-content')) el.spellcheck = s.spellcheck
}

export function attachmentsFolder(): string {
  return getSettings().attachmentsFolder.replace(/^\/+|\/+$/g, '') || 'Anexos'
}

export { dailyNoteSettings, saveDailyNoteSettings, type DailySettings }
