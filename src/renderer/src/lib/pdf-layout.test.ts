import { describe, expect, it } from 'vitest'
import { bodySizeOf, groupLines, linesToBlocks, type TextPiece } from './pdf-layout'

const piece = (str: string, x: number, y: number, size = 11, bold = false): TextPiece => ({ str, x, y, width: str.length * size * 0.5, size, bold })

describe('groupLines', () => {
  it('junta pedaços na mesma altura e ordena da esquerda para a direita', () => {
    const lines = groupLines([piece('mundo', 60, 700), piece('Olá', 20, 700.5), piece('abaixo', 20, 680)])
    expect(lines.map((l) => l.pieces.map((p) => p.str).join('|'))).toEqual(['Olá|mundo', 'abaixo'])
  })
})

describe('linesToBlocks', () => {
  it('reconhece títulos pelo tamanho e junta linhas do mesmo parágrafo', () => {
    const lines = groupLines([
      piece('Relatório anual', 20, 760, 22, true),
      piece('Introdução', 20, 720, 15, true),
      piece('Este é o primeiro parágrafo que continua', 20, 700),
      piece('na linha de baixo.', 20, 686),
      piece('Outro parágrafo depois de um espaço.', 20, 650),
    ])
    const blocks = linesToBlocks(lines)
    expect(blocks.map((b) => [b.type, b.runs.map((r) => r.text).join('')])).toEqual([
      ['heading1', 'Relatório anual'],
      ['heading2', 'Introdução'],
      ['paragraph', 'Este é o primeiro parágrafo que continua na linha de baixo.'],
      ['paragraph', 'Outro parágrafo depois de um espaço.'],
    ])
  })

  it('detecta listas e remove o marcador', () => {
    const blocks = linesToBlocks(groupLines([piece('• Primeiro item', 30, 700), piece('• Segundo item', 30, 686), piece('1. Passo um', 30, 660)]), 11)
    expect(blocks.map((b) => [b.type, b.runs[0]!.text])).toEqual([
      ['bullet', 'Primeiro item'],
      ['bullet', 'Segundo item'],
      ['numbered', 'Passo um'],
    ])
  })

  it('junta palavras hifenizadas e preserva negrito', () => {
    const blocks = linesToBlocks(groupLines([piece('Um texto com compu-', 20, 700), piece('tador e ', 20, 686), piece('negrito', 70, 686, 11, true)]), 11)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.runs).toEqual([
      { text: 'Um texto com computador e ', bold: false },
      { text: 'negrito', bold: true },
    ])
  })
})

describe('bodySizeOf', () => {
  it('usa a fonte com mais texto como corpo', () => {
    expect(bodySizeOf([[piece('Título', 0, 0, 24), piece('muito texto de corpo aqui', 0, 0, 11)]])).toBe(11)
  })
})
