import { parse as parseYaml } from 'yaml'
import { expandTag } from '../../../shared/markdown/parse'
import { normalizeText } from '../../../shared/text'
import type { NoteSummary } from '../../../shared/types'

/*
 * Bases: uma tabela viva de notas dentro de outra nota, escrita como um
 * bloco de código "base" em YAML (formato próprio do Opalite):
 *
 *   ```base
 *   filtro: tag:projeto path:Projetos
 *   colunas: [arquivo, pasta, tags, status]
 *   ordenar: -status
 *   limite: 50
 *   ```
 *
 * Filtro: tag:x, path:x, file:x, propriedade:valor (do frontmatter) e
 * palavras soltas (procuradas no título). Tudo precisa casar (E).
 * Colunas especiais: arquivo, pasta, tags, apelidos; as demais são
 * propriedades do frontmatter. "ordenar" aceita "-" para ordem decrescente.
 */

export interface BaseSpec {
  filter: string
  columns: string[]
  sort: { column: string; desc: boolean } | null
  limit: number
  error: string | null
}

export interface BaseRow {
  path: string
  cells: string[]
}

const DEFAULT_COLUMNS = ['arquivo', 'pasta', 'tags']

export function parseBase(source: string): BaseSpec {
  const spec: BaseSpec = { filter: '', columns: DEFAULT_COLUMNS, sort: null, limit: 200, error: null }
  let data: unknown
  try {
    data = parseYaml(source)
  } catch (err) {
    return { ...spec, error: `YAML inválido: ${(err as Error).message.split('\n')[0]}` }
  }
  if (data === null || data === undefined) return spec
  if (typeof data !== 'object' || Array.isArray(data)) return { ...spec, error: 'Use chaves como "filtro:" e "colunas:".' }
  const d = data as Record<string, unknown>

  if (d['filtro'] !== undefined) spec.filter = String(d['filtro'])
  const cols = d['colunas']
  if (Array.isArray(cols)) spec.columns = cols.map(String).filter(Boolean)
  else if (typeof cols === 'string') spec.columns = cols.split(',').map((c) => c.trim()).filter(Boolean)
  if (spec.columns.length === 0) spec.columns = DEFAULT_COLUMNS
  if (typeof d['ordenar'] === 'string' && d['ordenar'].trim()) {
    const raw = d['ordenar'].trim()
    spec.sort = { column: raw.replace(/^-/, ''), desc: raw.startsWith('-') }
  }
  const limit = Number(d['limite'])
  if (Number.isFinite(limit) && limit > 0) spec.limit = Math.min(Math.floor(limit), 1000)
  return spec
}

function folderOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

export function cellValue(note: NoteSummary, column: string): string {
  switch (normalizeText(column)) {
    case 'arquivo':
    case 'file':
      return note.title
    case 'pasta':
    case 'folder':
      return folderOf(note.path)
    case 'tags':
      return note.tags.map((t) => `#${t}`).join(' ')
    case 'apelidos':
    case 'aliases':
      return note.aliases.join(', ')
    default: {
      const key = Object.keys(note.properties).find((k) => normalizeText(k) === normalizeText(column))
      return key ? note.properties[key]! : ''
    }
  }
}

function matchesFilter(note: NoteSummary, filter: string): boolean {
  const tokens = filter.match(/(\S+?):"([^"]*)"|\S+/g) ?? []
  for (const token of tokens) {
    const m = /^([^:\s]+):(.*)$/.exec(token)
    if (!m) {
      const word = normalizeText(token.replace(/^#/, ''))
      if (token.startsWith('#')) {
        if (!note.tags.flatMap(expandTag).some((t) => normalizeText(t) === word)) return false
      } else if (!normalizeText(note.title).includes(word)) return false
      continue
    }
    const key = normalizeText(m[1]!)
    const value = normalizeText(m[2]!.replace(/^"|"$/g, '').replace(/^#/, ''))
    if (key === 'tag') {
      if (!note.tags.flatMap(expandTag).some((t) => normalizeText(t) === value)) return false
    } else if (key === 'path') {
      if (!normalizeText(note.path).includes(value)) return false
    } else if (key === 'file') {
      if (!normalizeText(note.title).includes(value)) return false
    } else if (!normalizeText(cellValue(note, m[1]!)).includes(value)) {
      return false
    }
  }
  return true
}

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })

export function evaluateBase(spec: BaseSpec, notes: NoteSummary[], excludePath?: string | null): BaseRow[] {
  let rows = notes.filter((n) => n.path !== excludePath && matchesFilter(n, spec.filter))
  const sort = spec.sort
  if (sort) {
    rows = rows.sort((a, b) => {
      const va = cellValue(a, sort.column)
      const vb = cellValue(b, sort.column)
      // Vazios sempre no fim.
      if (!va !== !vb) return va ? -1 : 1
      const c = collator.compare(va, vb)
      return sort.desc ? -c : c
    })
  } else {
    rows = rows.sort((a, b) => collator.compare(a.title, b.title))
  }
  return rows.slice(0, spec.limit).map((n) => ({ path: n.path, cells: spec.columns.map((c) => cellValue(n, c)) }))
}
