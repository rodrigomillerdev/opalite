import { beforeEach, describe, expect, it } from 'vitest'
import { VaultIndex, parseQuery } from './vault-index'

let index: VaultIndex

function seed(files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) index.set(path, content)
}

beforeEach(() => {
  index = new VaultIndex()
  seed({
    'Opalite.md': '---\naliases: [Opala]\n---\n# Opalite\nEditor de notas. #projeto/opalite',
    'Diário/Hoje.md': 'Trabalhei no [[Opalite#Roadmap|app]] hoje. #diario',
    'Ideias.md': 'Uma ideia para o opalite: grafo opalescente.\n[[Fantasma]]',
    'Projetos/Plano.md': 'Ver ![[Opalite]] e também [[Ideias]].\n`[[Opalite]] em código não conta`',
    'Ação.md': 'Reunião sobre ação e reação. #projeto',
  })
})

describe('backlinks', () => {
  it('lista notas com link para a nota, com a linha de contexto', () => {
    const { linked } = index.backlinks('Opalite.md')
    expect(linked.map((g) => g.path)).toEqual(['Diário/Hoje.md', 'Projetos/Plano.md'])
    expect(linked[0]!.mentions[0]).toMatchObject({ line: 0, text: 'Trabalhei no [[Opalite#Roadmap|app]] hoje. #diario' })
    // O link dentro de código não aparece.
    expect(linked[1]!.mentions).toHaveLength(1)
  })

  it('encontra menções não vinculadas, sem diferenciar caixa', () => {
    const { unlinked } = index.backlinks('Opalite.md')
    expect(unlinked.map((g) => g.path)).toEqual(['Ideias.md'])
    expect(unlinked[0]!.mentions[0]!.text).toContain('opalite')
  })

  it('reflete atualizações e remoções', () => {
    index.set('Diário/Hoje.md', 'sem links agora')
    index.remove('Projetos')
    expect(index.backlinks('Opalite.md').linked).toEqual([])
  })
})

describe('linkMention', () => {
  it('transforma a menção em link preservando o texto original', () => {
    const { unlinked } = index.backlinks('Opalite.md')
    const m = unlinked[0]!.mentions[0]!
    const edit = index.linkMention('Ideias.md', m.from, m.to, 'Opalite.md')
    expect(edit.content.split('\n')[0]).toBe('Uma ideia para o [[Opalite|opalite]]: grafo opalescente.')
  })

  it('recusa se o texto não estiver mais na posição', () => {
    expect(() => index.linkMention('Ideias.md', 0, 3, 'Opalite.md')).toThrow(/mudou/)
  })
})

describe('tags', () => {
  it('conta notas por tag, incluindo as tags-pai', () => {
    expect(index.tags()).toEqual([
      { tag: 'diario', count: 1 },
      { tag: 'projeto', count: 2 },
      { tag: 'projeto/opalite', count: 1 },
    ])
  })
})

describe('computeRenameEdits', () => {
  it('reescreve os links preservando seção, apelido e incorporação', () => {
    const edits = index.computeRenameEdits('Opalite.md', 'Opalite 2.md')
    const byPath = Object.fromEntries(edits.map((e) => [e.path, e.content]))
    expect(byPath['Diário/Hoje.md']).toBe('Trabalhei no [[Opalite 2#Roadmap|app]] hoje. #diario')
    expect(byPath['Projetos/Plano.md']).toContain('![[Opalite 2]]')
    // Código não é tocado.
    expect(byPath['Projetos/Plano.md']).toContain('`[[Opalite]] em código não conta`')
  })

  it('usa o caminho quando o novo nome fica ambíguo', () => {
    index.set('Arquivo/Ideias.md', 'outra')
    const edits = index.computeRenameEdits('Arquivo/Ideias.md', 'Arquivo/Velhas.md')
    expect(edits).toEqual([]) // ninguém apontava para ela (o link resolve para Ideias.md da raiz)
    const edits2 = index.computeRenameEdits('Ideias.md', 'Projetos/Ideias.md')
    expect(edits2.find((e) => e.path === 'Projetos/Plano.md')?.content).toContain('[[Projetos/Ideias]]')
  })

  it('atualiza links ao mover uma pasta inteira e devolve os caminhos novos', () => {
    index.set('Raiz.md', 'link [[Projetos/Plano]]')
    const edits = index.computeRenameEdits('Projetos', 'Trabalho')
    expect(edits.find((e) => e.path === 'Raiz.md')?.content).toBe('link [[Trabalho/Plano]]')
  })
})

describe('busca', () => {
  it('encontra palavras ignorando acentos, com o trecho destacado', () => {
    const [first] = index.query('acao')
    expect(first?.path).toBe('Ação.md')
    expect(first?.matches[0]?.text).toContain('ação')
  })

  it('combina texto e filtros', () => {
    expect(index.query('tag:projeto').map((r) => r.path).sort()).toEqual(['Ação.md', 'Opalite.md'])
    expect(index.query('#diario').map((r) => r.path)).toEqual(['Diário/Hoje.md'])
    expect(index.query('path:projetos').map((r) => r.path)).toEqual(['Projetos/Plano.md'])
    expect(index.query('file:plano').map((r) => r.path)).toEqual(['Projetos/Plano.md'])
    expect(index.query('editor tag:projeto/opalite').map((r) => r.path)).toEqual(['Opalite.md'])
  })

  it('aceita frase exata entre aspas', () => {
    expect(index.query('"grafo opalescente"').map((r) => r.path)).toEqual(['Ideias.md'])
    expect(index.query('"opalescente grafo"')).toEqual([])
  })

  it('encontra pelo apelido do frontmatter', () => {
    expect(index.query('opala')[0]?.path).toBe('Opalite.md')
  })
})

describe('parseQuery', () => {
  it('separa termos, frases e filtros', () => {
    expect(parseQuery('Olá "frase Exata" tag:#A path:"Minha Pasta" file:x')).toEqual({
      terms: ['ola'],
      phrases: ['frase exata'],
      tags: ['a'],
      paths: ['minha pasta'],
      files: ['x'],
    })
  })
})

describe('graph', () => {
  it('liga notas, notas não criadas, tags e canvas', () => {
    index.setCanvas('Mapa.canvas', JSON.stringify({ nodes: [{ id: 'a', type: 'file', file: 'Ideias.md', x: 0, y: 0, width: 1, height: 1 }], edges: [] }))
    const { nodes, edges } = index.graph()
    const kinds = Object.fromEntries(nodes.map((n) => [n.id, n.kind]))
    expect(kinds['Opalite.md']).toBe('note')
    expect(kinds['?:fantasma']).toBe('unresolved')
    expect(kinds['tag:projeto']).toBe('tag')
    expect(kinds['Mapa.canvas']).toBe('canvas')
    const has = (a: string, b: string) => edges.some((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a))
    expect(has('Diário/Hoje.md', 'Opalite.md')).toBe(true)
    expect(has('Ideias.md', '?:fantasma')).toBe(true)
    expect(has('Mapa.canvas', 'Ideias.md')).toBe(true)
    // Links repetidos viram uma única aresta, e o link em código não conta.
    expect(edges.filter((e) => has(e.source, e.target) && [e.source, e.target].includes('Projetos/Plano.md') && [e.source, e.target].includes('Opalite.md'))).toHaveLength(1)
  })

  it('usa a pasta de primeiro nível como grupo', () => {
    expect(index.graph().nodes.find((n) => n.id === 'Diário/Hoje.md')?.folder).toBe('Diário')
  })
})

describe('canvas ao renomear', () => {
  it('atualiza o caminho dos cartões de nota', () => {
    index.setCanvas('Mapa.canvas', JSON.stringify({ nodes: [{ id: 'a', type: 'file', file: 'Projetos/Plano.md' }], edges: [] }))
    const edit = index.computeRenameEdits('Projetos', 'Trabalho').find((e) => e.path === 'Mapa.canvas')
    expect(JSON.parse(edit!.content).nodes[0].file).toBe('Trabalho/Plano.md')
  })
})

describe('desempenho e integridade', () => {
  it('set() devolve false quando o conteúdo não mudou (eco do próprio save)', () => {
    const content = 'Editor de notas.'
    index.set('Eco.md', content)
    expect(index.set('Eco.md', content)).toBe(false)
    expect(index.set('Eco.md', content + '!')).toBe(true)
  })

  it('backlinks sem menções soltas quando pedido', () => {
    expect(index.backlinks('Opalite.md', { unlinked: false }).unlinked).toEqual([])
    expect(index.backlinks('Opalite.md').unlinked.length).toBeGreaterThan(0)
  })

  it('a busca respeita o limite', () => {
    for (let i = 0; i < 30; i++) index.set(`Lote/N${i}.md`, 'texto sobre opalite')
    expect(index.query('opalite', 5)).toHaveLength(5)
  })

  it('renomear um anexo atualiza os embeds', () => {
    index.setFiles(['Anexos/foto.png'])
    index.set('Com imagem.md', 'Veja ![[Anexos/foto.png]] e [[foto.png]].')
    const edits = index.computeRenameEdits('Anexos', 'Imagens')
    expect(edits.find((e) => e.path === 'Com imagem.md')?.content).toBe('Veja ![[Imagens/foto.png]] e [[foto.png]].')
  })

  it('renomear pasta preserva o índice e a busca', () => {
    index.rename('Projetos', 'Trabalho')
    expect(index.has('Trabalho/Plano.md')).toBe(true)
    expect(index.has('Projetos/Plano.md')).toBe(false)
    expect(index.query('file:plano').map((r) => r.path)).toEqual(['Trabalho/Plano.md'])
  })
})
