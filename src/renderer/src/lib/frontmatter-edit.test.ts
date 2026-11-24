import { describe, expect, it } from 'vitest'
import { frontmatterLength, setFrontmatter } from './frontmatter-edit'

describe('setFrontmatter', () => {
  it('cria o frontmatter quando a nota não tem', () => {
    expect(setFrontmatter('# Título\ntexto', { banner: 'gradient:opala' })).toBe('---\nbanner: gradient:opala\n---\n\n# Título\ntexto')
  })

  it('troca uma chave existente mantendo as outras e a ordem', () => {
    const text = '---\ntags: [a, b]\nbanner: velho.png\nstatus: ativo\n---\ncorpo'
    expect(setFrontmatter(text, { banner: 'Anexos/novo.jpg' })).toBe('---\ntags: [a, b]\nbanner: Anexos/novo.jpg\nstatus: ativo\n---\ncorpo')
  })

  it('remove a chave e apaga o bloco se ficar vazio', () => {
    expect(setFrontmatter('---\nbanner: x.png\n---\ncorpo', { banner: null })).toBe('corpo')
    expect(setFrontmatter('---\nbanner: x.png\nbanner_y: 30\ntags: [a]\n---\ncorpo', { banner: null, banner_y: null })).toBe('---\ntags: [a]\n---\ncorpo')
  })

  it('remove também as linhas de lista da chave', () => {
    expect(setFrontmatter('---\naliases:\n  - A\n  - B\nbanner: x\n---\nc', { aliases: null })).toBe('---\nbanner: x\n---\nc')
  })

  it('coloca aspas quando necessário', () => {
    expect(setFrontmatter('x', { banner: 'Fotos/Praia: verão #1.jpg' })).toContain('banner: "Fotos/Praia: verão #1.jpg"')
    expect(setFrontmatter('x', { banner_y: '40' })).toContain('banner_y: "40"')
  })

  it('não fecha o bloco num valor que termina com ---', () => {
    expect(setFrontmatter('---\nsep: a---\ntags: [x]\n---\ncorpo', { banner: 'y' })).toBe('---\nsep: a---\ntags: [x]\nbanner: y\n---\ncorpo')
  })

  it('preserva quebras de linha CRLF', () => {
    expect(setFrontmatter('---\r\ntags: [a]\r\n---\r\ncorpo', { banner: 'x' })).toBe('---\r\ntags: [a]\r\nbanner: x\r\n---\r\ncorpo')
  })

  it('mede o bloco', () => {
    expect(frontmatterLength('---\na: 1\n---\ncorpo')).toBe(13)
    expect(frontmatterLength('corpo')).toBe(0)
  })
})
