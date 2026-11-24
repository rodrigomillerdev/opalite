import { describe, expect, it } from 'vitest'
import { dailyNotePath, formatDate, renderTemplate } from './daily'

const date = new Date(2026, 10, 12, 9, 5) // 12/11/2026 09:05, quinta-feira

describe('formatDate', () => {
  it('substitui os tokens', () => {
    expect(formatDate(date, 'YYYY-MM-DD HH:mm')).toBe('2026-11-12 09:05')
    expect(formatDate(date, 'dddd, DD/MM')).toBe('quinta-feira, 12/11')
  })
})

describe('dailyNotePath', () => {
  it('monta o caminho com pasta e formato, sem caracteres inválidos', () => {
    expect(dailyNotePath(date, { folder: 'Diário/', format: 'YYYY-MM-DD', template: '', templatesFolder: '' })).toBe('Diário/2026-11-12.md')
    expect(dailyNotePath(date, { folder: '', format: 'DD/MM/YYYY', template: '', templatesFolder: '' })).toBe('12-11-2026.md')
  })
})

describe('renderTemplate', () => {
  it('troca title, date, time e formatos personalizados', () => {
    const out = renderTemplate('# {{title}}\n{{date}} {{time}} {{date:dddd}} {{ time:HH }}', { title: 'Reunião', date })
    expect(out).toBe('# Reunião\n2026-11-12 09:05 quinta-feira 09')
  })
})
