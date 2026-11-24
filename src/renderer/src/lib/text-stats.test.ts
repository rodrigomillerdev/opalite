import { describe, expect, it } from 'vitest'
import { countChars, countWords } from './text-stats'

describe('countWords', () => {
  it('conta palavras com acentos e pontuação', () => {
    expect(countWords('Olá, mundo! Ação e reação.')).toBe(5)
  })

  it('trata hífen e apóstrofo internos como uma palavra', () => {
    expect(countWords("guarda-chuva d'água")).toBe(2)
  })

  it('ignora marcadores de Markdown', () => {
    expect(countWords('# Título\n\n- **negrito** e `código`')).toBe(4)
  })

  it('retorna zero para texto vazio', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   \n  ')).toBe(0)
  })
})

describe('countChars', () => {
  it('conta caracteres Unicode corretamente', () => {
    expect(countChars('ação')).toBe(4)
    expect(countChars('𝛑')).toBe(1)
  })
})
