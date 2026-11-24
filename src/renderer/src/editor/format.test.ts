import { describe, expect, it } from 'vitest'
import { clearFormatting, highlightMarkers, nextFootnoteNumber } from './format'

describe('clearFormatting', () => {
  it('remove negrito, itálico, tachado, realce e código', () => {
    expect(clearFormatting('**forte** e *leve* e ~~riscado~~ e ==marca== e `cod`')).toBe(
      'forte e leve e riscado e marca e cod',
    )
  })

  it('remove realces coloridos, comentários e equações inline', () => {
    expect(clearFormatting('<mark style="background: red">cor</mark> %%oculto%% $x^2$')).toBe('cor oculto x^2')
  })

  it('não mexe em blocos de código nem em equações em bloco', () => {
    const text = '**a**\n```base\nfiltro: **x**\n```\n$$\n\\frac{a}{b} *c*\n$$\n`b`'
    expect(clearFormatting(text)).toBe('a\n```base\nfiltro: **x**\n```\n$$\n\\frac{a}{b} *c*\n$$\nb')
  })

  it('preserva texto comum e sublinhados dentro de palavras', () => {
    expect(clearFormatting('nome_de_arquivo custa 5 reais')).toBe('nome_de_arquivo custa 5 reais')
  })
})

describe('highlightMarkers', () => {
  it('usa == para o padrão e <mark> para cores', () => {
    expect(highlightMarkers('default')).toEqual(['==', '=='])
    const [open, close] = highlightMarkers('red')
    expect(open).toMatch(/^<mark style="background: rgba/)
    expect(close).toBe('</mark>')
  })
})

describe('nextFootnoteNumber', () => {
  it('continua a numeração existente', () => {
    expect(nextFootnoteNumber('sem notas')).toBe(1)
    expect(nextFootnoteNumber('a[^1] b[^3]\n[^1]: x\n[^3]: y')).toBe(4)
  })
})
