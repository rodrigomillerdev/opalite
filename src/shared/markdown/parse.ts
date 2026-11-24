import { parse as parseYaml } from 'yaml'

// Parser de metadados de uma nota: wikilinks, tags, títulos e frontmatter YAML.
// Escrito do zero a partir da sintaxe pública (CommonMark + convenções abertas
// de wikilinks). Roda no processo principal (índice) e na interface (editor).

export interface WikiLink {
  /** Texto completo, ex.: "[[Nota#Seção|apelido]]". */
  raw: string
  /** Nome ou caminho da nota de destino, sem a seção. Ex.: "Nota". */
  target: string
  /** Título ou bloco após "#", se houver. */
  section: string | null
  /** Texto após "|", se houver. */
  alias: string | null
  /** true para incorporações: "![[...]]". */
  embed: boolean
  from: number
  to: number
  /** Linha (0-based) onde o link começa. */
  line: number
}

export interface Heading {
  level: number
  text: string
  line: number
}

export interface TagRef {
  /** Sem o "#", ex.: "projeto/opalite". */
  tag: string
  from: number
  to: number
  line: number
}

export interface NoteParse {
  frontmatter: Record<string, unknown>
  /** Fim do bloco de frontmatter (0 se não houver). */
  bodyStart: number
  links: WikiLink[]
  tags: TagRef[]
  /** Tags únicas da nota (corpo + frontmatter), sem "#". */
  tagSet: string[]
  aliases: string[]
  headings: Heading[]
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/
const WIKILINK = /(!?)\[\[([^[\]\n]+?)\]\]/g
// "#" precedido de início/espaço/parêntese; letras, números, _, - e / (aninhamento).
const TAG = /(^|[\s(,;])#([\p{L}\p{N}_\-/]+)/gu
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm

/**
 * Substitui código (blocos cercados, código inline) e o frontmatter por espaços,
 * preservando as posições. Assim "[[x]]" dentro de código não vira link.
 */
export function maskCode(text: string, bodyStart = 0): string {
  // Coleta os intervalos a apagar e monta o resultado uma única vez.
  const ranges: Array<[number, number]> = []
  if (bodyStart > 0) ranges.push([0, bodyStart])

  // Blocos cercados com ``` ou ~~~ (com tolerância a até 3 espaços de recuo).
  const fence = /^ {0,3}(`{3,}|~{3,})[^\n]*$/gm
  let open: { marker: string; from: number } | null = null
  let m: RegExpExecArray | null
  while ((m = fence.exec(text))) {
    if (m.index < bodyStart) continue
    const marker = m[1]!
    if (!open) open = { marker, from: m.index }
    else if (marker[0] === open.marker[0] && marker.length >= open.marker.length) {
      ranges.push([open.from, m.index + m[0].length])
      open = null
    }
  }
  if (open) ranges.push([open.from, text.length])

  // Código inline fora dos blocos: N crases até a próxima sequência de N crases.
  if (text.includes('`')) {
    const inBlock = (pos: number) => ranges.some(([f, t]) => pos >= f && pos < t)
    const inline = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g
    while ((m = inline.exec(text))) {
      if (inBlock(m.index)) continue
      ranges.push([m.index, m.index + m[0].length])
    }
  }
  if (ranges.length === 0) return text

  ranges.sort((x, y) => x[0] - y[0])
  let out = ''
  let pos = 0
  for (const [from, to] of ranges) {
    if (to <= pos) continue
    const start = Math.max(from, pos)
    out += text.slice(pos, start)
    // Troca por espaços, preservando quebras de linha (as posições não mudam).
    out += text.slice(start, to).replace(/[^\n]/g, ' ')
    pos = to
  }
  return out + text.slice(pos)
}

function lineIndex(text: string): (pos: number) => number {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  return (pos) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid]! <= pos) lo = mid
      else hi = mid - 1
    }
    return lo
  }
}

export function parseFrontmatter(text: string): { data: Record<string, unknown>; end: number } {
  const m = FRONTMATTER.exec(text)
  if (!m) return { data: {}, end: 0 }
  try {
    const data = parseYaml(m[1]!) as unknown
    return {
      data: data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {},
      end: m[0].length,
    }
  } catch {
    return { data: {}, end: m[0].length } // YAML inválido: ignora, mas não indexa como texto
  }
}

/** Divide o conteúdo interno de [[...]] em destino, seção e apelido. */
export function splitLinkInner(inner: string): { target: string; section: string | null; alias: string | null } {
  const pipe = inner.indexOf('|')
  const dest = pipe === -1 ? inner : inner.slice(0, pipe)
  const alias = pipe === -1 ? null : inner.slice(pipe + 1).trim() || null
  const hash = dest.indexOf('#')
  const target = (hash === -1 ? dest : dest.slice(0, hash)).trim()
  const section = hash === -1 ? null : dest.slice(hash + 1).trim() || null
  return { target, section, alias }
}

/** Uma tag precisa ter ao menos um caractere que não seja dígito (#2024 não é tag). */
export function isValidTag(tag: string): boolean {
  return /[^\d/]/.test(tag) && !tag.startsWith('/') && !tag.endsWith('/')
}

function toStringList(value: unknown): string[] {
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean)
  if (Array.isArray(value)) return value.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number').map(String)
  return []
}

/** "a/b/c" -> ["a", "a/b", "a/b/c"]: buscar #a encontra as tags filhas. */
export function expandTag(tag: string): string[] {
  const parts = tag.split('/')
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

export function parseNote(text: string): NoteParse {
  const { data, end } = parseFrontmatter(text)
  const masked = maskCode(text, end)
  const lineOf = lineIndex(text)

  const links: WikiLink[] = []
  for (const m of masked.matchAll(WIKILINK)) {
    const { target, section, alias } = splitLinkInner(m[2]!)
    if (!target && !section) continue
    const from = m.index
    links.push({
      raw: m[0],
      target,
      section,
      alias,
      embed: m[1] === '!',
      from,
      to: from + m[0].length,
      line: lineOf(from),
    })
  }

  const tags: TagRef[] = []
  for (const m of masked.matchAll(TAG)) {
    const tag = m[2]!
    if (!isValidTag(tag)) continue
    const from = m.index + m[1]!.length
    // Ignora "#" dentro de um wikilink (ex.: [[Nota#Seção]] já foi tratado).
    if (links.some((l) => from >= l.from && from < l.to)) continue
    tags.push({ tag, from, to: from + 1 + tag.length, line: lineOf(from) })
  }

  const headings: Heading[] = []
  for (const m of masked.matchAll(HEADING)) {
    headings.push({ level: m[1]!.length, text: m[2]!.trim(), line: lineOf(m.index) })
  }

  const fmTags = toStringList(data['tags'] ?? data['tag']).map((t) => t.replace(/^#/, '')).filter(isValidTag)
  const tagSet = [...new Set([...tags.map((t) => t.tag), ...fmTags])]
  const aliases = toStringList(data['aliases'] ?? data['alias'])

  return { frontmatter: data, bodyStart: end, links, tags, tagSet, aliases, headings }
}
