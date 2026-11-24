import { describe, expect, it } from 'vitest'
import { expandTag, maskCode, parseNote, splitLinkInner } from './parse'
import { LinkResolver } from './resolve'

describe('wikilinks', () => {
  it('reconhece as três formas básicas', () => {
    const { links } = parseNote('Veja [[Nota]], [[Nota#Seção]] e [[Pasta/Nota|apelido]].')
    expect(links.map((l) => [l.target, l.section, l.alias])).toEqual([
      ['Nota', null, null],
      ['Nota', 'Seção', null],
      ['Pasta/Nota', null, 'apelido'],
    ])
  })

  it('combina seção e apelido', () => {
    expect(splitLinkInner('Nota#Parte 2|ver parte')).toEqual({ target: 'Nota', section: 'Parte 2', alias: 'ver parte' })
  })

  it('aceita link só para seção da própria nota', () => {
    const [link] = parseNote('[[#Resumo]]').links
    expect(link).toMatchObject({ target: '', section: 'Resumo' })
  })

  it('marca incorporações e guarda posição e linha', () => {
    const text = 'linha 0\n![[Imagem]]'
    const [link] = parseNote(text).links
    expect(link).toMatchObject({ embed: true, target: 'Imagem', line: 1, from: 8, to: text.length })
  })

  it('ignora links dentro de código', () => {
    const text = 'a `[[inline]]` b\n```\n[[bloco]]\n```\n[[real]]'
    expect(parseNote(text).links.map((l) => l.target)).toEqual(['real'])
  })

  it('ignora colchetes vazios ou quebrados', () => {
    expect(parseNote('[[]] [[a\nb]] [[ok]]').links.map((l) => l.target)).toEqual(['ok'])
  })
})

describe('tags', () => {
  it('encontra tags simples, aninhadas e com acento', () => {
    const { tagSet } = parseNote('#ideia texto #projeto/opalite e #ação')
    expect(tagSet).toEqual(['ideia', 'projeto/opalite', 'ação'])
  })

  it('não confunde títulos, números, âncoras e links', () => {
    const { tagSet } = parseNote('# Título\n#2024 e a#b e [[Nota#Seção]] e url.com/#x')
    expect(tagSet).toEqual([])
  })

  it('ignora tags dentro de código', () => {
    expect(parseNote('`#nao` e\n```\n#tambem\n```\n#sim').tagSet).toEqual(['sim'])
  })

  it('junta as tags do frontmatter', () => {
    const { tagSet } = parseNote('---\ntags: [estudo, "#ads"]\n---\ncorpo #extra')
    expect(tagSet.sort()).toEqual(['ads', 'estudo', 'extra'])
  })

  it('expande tags aninhadas', () => {
    expect(expandTag('a/b/c')).toEqual(['a', 'a/b', 'a/b/c'])
  })
})

describe('frontmatter e títulos', () => {
  it('lê aliases e não indexa o YAML como texto', () => {
    const note = parseNote('---\naliases: Apelido, Outro\ntitle: "#nao-e-tag"\n---\n# Começo')
    expect(note.aliases).toEqual(['Apelido', 'Outro'])
    expect(note.tagSet).toEqual([])
    expect(note.headings).toEqual([{ level: 1, text: 'Começo', line: 4 }])
  })

  it('tolera YAML inválido', () => {
    const note = parseNote('---\n: : :\n  - [\n---\ntexto')
    expect(note.frontmatter).toEqual({})
  })

  it('lista títulos com nível, ignorando os de dentro de código', () => {
    const note = parseNote('# A\n```\n# não\n```\n### B ###')
    expect(note.headings.map((h) => [h.level, h.text])).toEqual([
      [1, 'A'],
      [3, 'B'],
    ])
  })
})

describe('maskCode', () => {
  it('preserva o tamanho do texto e as quebras de linha', () => {
    const text = 'a `b` c\n```\nx\n```'
    const masked = maskCode(text)
    expect(masked.length).toBe(text.length)
    expect(masked.split('\n').length).toBe(text.split('\n').length)
  })
})

describe('LinkResolver', () => {
  const resolver = new LinkResolver([
    { path: 'Nota.md' },
    { path: 'Projetos/Nota.md' },
    { path: 'Projetos/Opalite.md', aliases: ['Opala'] },
    { path: 'Arquivo/2024/Resumo.md' },
  ])

  it('resolve pelo nome, sem diferenciar caixa e ignorando .md', () => {
    expect(resolver.resolve('opalite')).toBe('Projetos/Opalite.md')
    expect(resolver.resolve('Opalite.md')).toBe('Projetos/Opalite.md')
  })

  it('desempata pela pasta da origem e depois pelo caminho mais curto', () => {
    expect(resolver.resolve('Nota', 'Projetos/Outra.md')).toBe('Projetos/Nota.md')
    expect(resolver.resolve('Nota', 'Arquivo/x.md')).toBe('Nota.md')
  })

  it('resolve caminhos completos e parciais', () => {
    expect(resolver.resolve('Projetos/Nota')).toBe('Projetos/Nota.md')
    expect(resolver.resolve('2024/Resumo')).toBe('Arquivo/2024/Resumo.md')
  })

  it('usa apelidos quando não há arquivo com o nome', () => {
    expect(resolver.resolve('opala')).toBe('Projetos/Opalite.md')
  })

  it('devolve null para notas inexistentes', () => {
    expect(resolver.resolve('Fantasma')).toBeNull()
  })

  it('gera o texto de link mais curto possível', () => {
    expect(resolver.linkTextFor('Projetos/Opalite.md')).toBe('Opalite')
    expect(resolver.linkTextFor('Projetos/Nota.md')).toBe('Projetos/Nota')
  })
})
