import { describe, expect, it } from 'vitest'
import { addMonths, isoWeek, monthGrid, sameDay } from './calendar'

describe('monthGrid', () => {
  it('cobre 6 semanas começando no domingo', () => {
    const grid = monthGrid(2026, 10) // novembro de 2026: dia 1 é domingo
    expect(grid).toHaveLength(42)
    expect(grid[0]!.getDay()).toBe(0)
    expect(sameDay(grid[0]!, new Date(2026, 10, 1))).toBe(true)
  })

  it('inclui o fim do mês anterior quando o dia 1 não é domingo', () => {
    const grid = monthGrid(2026, 11) // dezembro de 2026: dia 1 é terça
    expect(sameDay(grid[0]!, new Date(2026, 10, 29))).toBe(true)
    expect(sameDay(grid[2]!, new Date(2026, 11, 1))).toBe(true)
  })
})

describe('addMonths', () => {
  it('atravessa a virada do ano', () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month: 0 })
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month: 11 })
  })
})

describe('isoWeek', () => {
  it('calcula a semana ISO', () => {
    expect(isoWeek(new Date(2026, 10, 12))).toBe(46)
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53)
  })
})
