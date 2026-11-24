import { describe, expect, it } from 'vitest'
import type { NoteSummary } from '../../../shared/types'
import { evaluateBase, parseBase } from './base'

const notes: NoteSummary[] = [
  { path: 'Projetos/Opalite.md', title: 'Opalite', aliases: ['Opala'], tags: ['projeto/opalite'], properties: { status: 'ativo', prioridade: '1' } },
  { path: 'Projetos/Hygeia.md', title: 'Hygeia', aliases: [], tags: ['projeto'], properties: { status: 'pausado', prioridade: '2' } },
  { path: 'Faculdade/Aula 10.md', title: 'Aula 10', aliases: [], tags: ['faculdade'], properties: {} },
  { path: 'Faculdade/Aula 2.md', title: 'Aula 2', aliases: [], tags: ['faculdade'], properties: { status: 'ativo' } },
]

describe('parseBase', () => {
  it('lê filtro, colunas, ordenação e limite', () => {
    const spec = parseBase('filtro: tag:projeto\ncolunas: [arquivo, status]\nordenar: -prioridade\nlimite: 5')
    expect(spec).toEqual({
      filter: 'tag:projeto',
      columns: ['arquivo', 'status'],
      sort: { column: 'prioridade', desc: true },
      limit: 5,
      error: null,
    })
  })

  it('usa padrões para bloco vazio e reporta YAML inválido', () => {
    expect(parseBase('').columns).toEqual(['arquivo', 'pasta', 'tags'])
    expect(parseBase('filtro: [aberto').error).toMatch(/YAML inválido/)
  })
})

describe('evaluateBase', () => {
  it('filtra por tag (incluindo filhas) e ordena', () => {
    const rows = evaluateBase(parseBase('filtro: tag:projeto\ncolunas: [arquivo, status]\nordenar: -prioridade'), notes)
    expect(rows).toEqual([
      { path: 'Projetos/Hygeia.md', cells: ['Hygeia', 'pausado'] },
      { path: 'Projetos/Opalite.md', cells: ['Opalite', 'ativo'] },
    ])
  })

  it('combina pasta, propriedade e palavras do título', () => {
    expect(evaluateBase(parseBase('filtro: path:faculdade status:ativo'), notes).map((r) => r.path)).toEqual(['Faculdade/Aula 2.md'])
    expect(evaluateBase(parseBase('filtro: aula'), notes).map((r) => r.cells[0])).toEqual(['Aula 2', 'Aula 10'])
  })

  it('não lista a própria nota que contém a base', () => {
    expect(evaluateBase(parseBase('filtro: tag:projeto'), notes, 'Projetos/Opalite.md').map((r) => r.path)).toEqual([
      'Projetos/Hygeia.md',
    ])
  })

  it('deixa células vazias no fim ao ordenar', () => {
    const rows = evaluateBase(parseBase('filtro: path:faculdade\ncolunas: [arquivo, status]\nordenar: status'), notes)
    expect(rows.map((r) => r.cells[0])).toEqual(['Aula 2', 'Aula 10'])
  })
})
