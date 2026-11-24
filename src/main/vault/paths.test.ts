import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  VaultPathError,
  isHiddenRel,
  normalizeRel,
  resolveInVault,
  sanitizeFileName,
  uniqueRel,
  withNoteExt,
} from './paths'

const root = path.resolve('/cofre-de-teste')

describe('normalizeRel', () => {
  it('padroniza separadores e remove segmentos vazios', () => {
    expect(normalizeRel('Pasta\\Sub//Nota.md')).toBe('Pasta/Sub/Nota.md')
    expect(normalizeRel('/Pasta/./Nota.md')).toBe('Pasta/Nota.md')
  })

  it('rejeita tentativas de sair do cofre', () => {
    expect(() => normalizeRel('../fora.md')).toThrow(VaultPathError)
    expect(() => normalizeRel('Pasta/../../fora.md')).toThrow(VaultPathError)
  })

  it('rejeita letras de unidade e caracteres inválidos', () => {
    expect(() => normalizeRel('C:/Windows/win.ini')).toThrow(VaultPathError)
    expect(() => normalizeRel('nota?.md')).toThrow(VaultPathError)
  })

  it('rejeita valores que não são texto', () => {
    expect(() => normalizeRel(42)).toThrow(VaultPathError)
    expect(() => normalizeRel(null)).toThrow(VaultPathError)
  })
})

describe('resolveInVault', () => {
  it('resolve caminhos dentro da raiz', () => {
    expect(resolveInVault(root, 'Pasta/Nota.md')).toBe(path.join(root, 'Pasta', 'Nota.md'))
  })

  it('só aceita a própria raiz quando permitido', () => {
    expect(() => resolveInVault(root, '')).toThrow(VaultPathError)
    expect(resolveInVault(root, '', { allowRoot: true })).toBe(root)
  })

  it('aceita nomes que começam com ".." mas não são "..', () => {
    expect(resolveInVault(root, '..ideias.md')).toBe(path.join(root, '..ideias.md'))
  })
})

describe('sanitizeFileName', () => {
  it('troca caracteres proibidos por espaço', () => {
    expect(sanitizeFileName('Aula: 1/2?')).toBe('Aula 1 2')
  })

  it('remove pontos iniciais e finais', () => {
    expect(sanitizeFileName('..oculto')).toBe('oculto')
    expect(sanitizeFileName('fim...')).toBe('fim')
  })

  it('usa um nome padrão quando sobra nada', () => {
    expect(sanitizeFileName('   ')).toBe('Sem título')
    expect(sanitizeFileName('???')).toBe('Sem título')
  })

  it('protege nomes reservados do Windows', () => {
    expect(sanitizeFileName('CON')).toBe('_CON')
    expect(sanitizeFileName('com1')).toBe('_com1')
  })

  it('preserva acentos', () => {
    expect(sanitizeFileName('Reunião de ação')).toBe('Reunião de ação')
  })
})

describe('isHiddenRel', () => {
  it('detecta qualquer segmento oculto', () => {
    expect(isHiddenRel('.git/config')).toBe(true)
    expect(isHiddenRel('Pasta/.opalite/x.json')).toBe(true)
    expect(isHiddenRel('Pasta/Nota.md')).toBe(false)
  })
})

describe('withNoteExt', () => {
  it('não duplica a extensão', () => {
    expect(withNoteExt('Nota')).toBe('Nota.md')
    expect(withNoteExt('Nota.md')).toBe('Nota.md')
    expect(withNoteExt('Nota.MD')).toBe('Nota.MD')
  })
})

describe('uniqueRel', () => {
  it('numera até encontrar um nome livre', async () => {
    const taken = new Set(['Pasta/Nota.md', 'Pasta/Nota 1.md'])
    const result = await uniqueRel('Pasta/Nota.md', async (c) => taken.has(c))
    expect(result).toBe('Pasta/Nota 2.md')
  })

  it('funciona com pastas (sem extensão)', async () => {
    const taken = new Set(['Projetos'])
    expect(await uniqueRel('Projetos', async (c) => taken.has(c))).toBe('Projetos 1')
  })
})
