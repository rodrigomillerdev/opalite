import { describe, expect, it } from 'vitest'
import { formatImageLink, parseImageOpts } from './image-opts'

describe('opções de imagem no link', () => {
  it('lê tamanho, alinhamento e legenda em qualquer ordem', () => {
    expect(parseImageOpts('|300')).toEqual({ alt: null, align: null, width: 300, height: null })
    expect(parseImageOpts('|Praia ao pôr do sol|center|400x250')).toEqual({ alt: 'Praia ao pôr do sol', align: 'center', width: 400, height: 250 })
    expect(parseImageOpts('|right|120')).toMatchObject({ align: 'right', width: 120 })
  })

  it('escreve no formato compatível com o Obsidian', () => {
    expect(formatImageLink('Anexos/praia.png', { alt: null, align: null, width: 320, height: null })).toBe('![[Anexos/praia.png|320]]')
    expect(formatImageLink('a.png', { alt: 'x', align: 'center', width: 400.4, height: 199.6 })).toBe('![[a.png|x|center|400x200]]')
    expect(formatImageLink('a.png', { alt: null, align: null, width: null, height: null })).toBe('![[a.png]]')
  })
})
