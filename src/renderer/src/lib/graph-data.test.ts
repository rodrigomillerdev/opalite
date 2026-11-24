import { describe, expect, it } from 'vitest'
import type { GraphData } from '../../../shared/types'
import { DEFAULT_GRAPH_SETTINGS, filterGraph, groupOf, neighborhood } from './graph-data'

const data: GraphData = {
  nodes: [
    { id: 'A.md', label: 'A', kind: 'note', folder: '', tags: ['x'] },
    { id: 'P/B.md', label: 'B', kind: 'note', folder: 'P', tags: [] },
    { id: 'P/C.md', label: 'C', kind: 'note', folder: 'P', tags: [] },
    { id: 'Solta.md', label: 'Solta', kind: 'note', folder: '', tags: [] },
    { id: '?:nova', label: 'Nova', kind: 'unresolved', folder: '', tags: [] },
    { id: 'tag:x', label: '#x', kind: 'tag', folder: '', tags: ['x'] },
    { id: 'M.canvas', label: 'M', kind: 'canvas', folder: '', tags: [] },
  ],
  edges: [
    { source: 'A.md', target: 'P/B.md' },
    { source: 'P/B.md', target: 'P/C.md' },
    { source: 'A.md', target: '?:nova' },
    { source: 'A.md', target: 'tag:x' },
    { source: 'M.canvas', target: 'P/C.md' },
  ],
}

const ids = (g: GraphData) => g.nodes.map((n) => n.id).sort()

describe('filterGraph', () => {
  it('esconde tags e notas não criadas por padrão', () => {
    expect(ids(filterGraph(data, DEFAULT_GRAPH_SETTINGS))).toEqual(['A.md', 'M.canvas', 'P/B.md', 'P/C.md', 'Solta.md'])
  })

  it('mostra tags, não criadas e esconde órfãs quando pedido', () => {
    const g = filterGraph(data, { ...DEFAULT_GRAPH_SETTINGS, showTags: true, showUnresolved: true, showOrphans: false })
    expect(ids(g)).toEqual(['?:nova', 'A.md', 'M.canvas', 'P/B.md', 'P/C.md', 'tag:x'])
    expect(g.edges).toHaveLength(5)
  })

  it('filtra pela busca, sem acentos', () => {
    expect(ids(filterGraph(data, { ...DEFAULT_GRAPH_SETTINGS, search: 'p/' }))).toEqual(['P/B.md', 'P/C.md'])
  })

  it('gráfico local respeita a profundidade', () => {
    expect(ids(filterGraph(data, DEFAULT_GRAPH_SETTINGS, 'A.md'))).toEqual(['A.md', 'P/B.md'])
    expect(ids(filterGraph(data, { ...DEFAULT_GRAPH_SETTINGS, depth: 2 }, 'A.md'))).toEqual(['A.md', 'M.canvas', 'P/B.md', 'P/C.md'].filter((x) => x !== 'M.canvas'))
  })
})

describe('neighborhood', () => {
  it('percorre as conexões nos dois sentidos', () => {
    expect([...neighborhood('P/C.md', data.edges, 1)].sort()).toEqual(['M.canvas', 'P/B.md', 'P/C.md'])
  })
})

describe('groupOf', () => {
  it('agrupa por pasta, tag ou nada', () => {
    expect(groupOf(data.nodes[1]!, 'folder')).toBe('P')
    expect(groupOf(data.nodes[0]!, 'tag')).toBe('x')
    expect(groupOf(data.nodes[0]!, 'none')).toBe('')
  })
})
