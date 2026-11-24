/*
 * Notas diárias e modelos.
 * - Nota diária: um arquivo por dia, ex.: "Diário/2026-11-12.md".
 * - Modelos: notas comuns na pasta de modelos; ao inserir, as variáveis
 *   {{title}}, {{date}}, {{time}} e {{date:FORMATO}} são substituídas.
 */

export interface DailySettings {
  /** Pasta das notas diárias ("" = raiz do cofre). */
  folder: string
  /** Formato do nome do arquivo. Tokens: YYYY, MM, DD, HH, mm, dddd. */
  format: string
  /** Caminho de um modelo para notas novas ("" = nenhum). */
  template: string
  /** Pasta dos modelos. */
  templatesFolder: string
}

const DEFAULTS: DailySettings = { folder: '', format: 'YYYY-MM-DD', template: '', templatesFolder: 'Modelos' }
const KEY = 'opalite:daily-settings'

export function dailyNoteSettings(): DailySettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<DailySettings>
    return { ...DEFAULTS, ...raw }
  } catch {
    return DEFAULTS
  }
}

export function saveDailyNoteSettings(settings: Partial<DailySettings>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...dailyNoteSettings(), ...settings }))
  } catch {
    // sem armazenamento
  }
}

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const pad = (n: number) => String(n).padStart(2, '0')

export function formatDate(date: Date, format: string): string {
  return format.replace(/YYYY|MM|DD|HH|mm|dddd/g, (token) => {
    switch (token) {
      case 'YYYY':
        return String(date.getFullYear())
      case 'MM':
        return pad(date.getMonth() + 1)
      case 'DD':
        return pad(date.getDate())
      case 'HH':
        return pad(date.getHours())
      case 'mm':
        return pad(date.getMinutes())
      default:
        return WEEKDAYS[date.getDay()]!
    }
  })
}

export function dailyNotePath(date: Date, settings: DailySettings = DEFAULTS): string {
  const name = formatDate(date, settings.format || DEFAULTS.format).replace(/[\\/:*?"<>|]/g, '-')
  const folder = settings.folder.replace(/^\/+|\/+$/g, '')
  return `${folder ? `${folder}/` : ''}${name}.md`
}

export function renderTemplate(content: string, vars: { title: string; date: Date }): string {
  return content.replace(/\{\{\s*(title|date|time)(?::([^}]+))?\s*\}\}/g, (_m, name: string, fmt?: string) => {
    if (name === 'title') return vars.title
    if (name === 'time') return formatDate(vars.date, fmt?.trim() || 'HH:mm')
    return formatDate(vars.date, fmt?.trim() || 'YYYY-MM-DD')
  })
}
