import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyMatch } from './fuzzy'

describe('fuzzyMatch', () => {
  it('casa subsequências e iniciais de palavras', () => {
    expect(fuzzyMatch('nnt', 'Nova nota')).not.toBeNull()
    expect(fuzzyMatch('xyz', 'Nova nota')).toBeNull()
  })

  it('ignora acentos e maiúsculas', () => {
    expect(fuzzyMatch('reuniao', 'Reunião de pauta')?.indices).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('exige todas as palavras da consulta', () => {
    expect(fuzzyMatch('nota pasta', 'Nova nota na pasta')).not.toBeNull()
    expect(fuzzyMatch('nota cofre', 'Nova nota na pasta')).toBeNull()
  })

  it('consulta vazia casa tudo', () => {
    expect(fuzzyMatch('  ', 'qualquer')).toEqual({ score: 0, indices: [] })
  })
})

describe('fuzzyFilter', () => {
  it('ordena prefixo e trecho contínuo antes de letras espalhadas', () => {
    const items = ['Notas antigas', 'Abrir troca rápida', 'Nota', 'Inserir tabela']
    expect(fuzzyFilter(items, 'nota', (s) => s).map((r) => r.item)).toEqual(['Nota', 'Notas antigas'])
  })

  it('prefere início de palavra a meio de palavra', () => {
    const items = ['Barra lateral', 'Alternar tema']
    expect(fuzzyFilter(items, 'tema', (s) => s)[0]?.item).toBe('Alternar tema')
    expect(fuzzyFilter(items, 'lat', (s) => s)[0]?.item).toBe('Barra lateral')
  })
})
