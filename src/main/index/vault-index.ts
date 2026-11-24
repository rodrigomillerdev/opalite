import MiniSearch from 'minisearch'
import { expandTag, maskCode, parseNote, type NoteParse } from '../../shared/markdown/parse'
import { LinkResolver, basenameNoExt, stripMd } from '../../shared/markdown/resolve'
import { normalizeText } from '../../shared/text'
import type {
  Backlinks,
  GraphData,
  GraphEdge,
  GraphNode,
  MentionGroup,
  NoteSummary,
  SearchMatch,
  SearchResult,
  TagCount,
} from '../../shared/types'

/*
 * Índice do cofre, mantido em memória no processo principal.
 *
 * Ele é DERIVADO dos arquivos: é reconstruído ao abrir o cofre e atualizado
 * a cada gravação ou evento do observador. Se algo der errado, basta reabrir
 * o cofre. Os arquivos .md continuam sendo a única fonte da verdade.
 */

interface IndexedNote {
  path: string
  title: string
  content: string
  parse: NoteParse
  /** Calculados sob demanda e guardados (menções não vinculadas). */
  masked?: string
  lineStarts?: number[]
}

/** Linha (0-based) de uma posição, por busca binária nos inícios de linha. */
function lineAt(note: IndexedNote, pos: number): number {
  if (!note.lineStarts) {
    const starts = [0]
    for (let i = note.content.indexOf('\n'); i !== -1; i = note.content.indexOf('\n', i + 1)) starts.push(i + 1)
    note.lineStarts = starts
  }
  const starts = note.lineStarts
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid]! <= pos) lo = mid
    else hi = mid - 1
  }
  return lo
}

interface SearchDoc {
  path: string
  title: string
  aliases: string
  content: string
}

export interface FileEdit {
  path: string
  content: string
}

const normalize = normalizeText

interface CanvasLike {
  nodes: Array<{ type?: unknown; file?: unknown; [key: string]: unknown }>
  edges?: unknown[]
  [key: string]: unknown
}

function safeCanvas(json: string): CanvasLike | null {
  try {
    const data = JSON.parse(json) as unknown
    if (data && typeof data === 'object' && Array.isArray((data as CanvasLike).nodes)) return data as CanvasLike
  } catch {
    // JSON inválido
  }
  return null
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isWithin(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`)
}

function replacePrefix(path: string, from: string, to: string): string {
  return path === from ? to : `${to}${path.slice(from.length)}`
}

/** Frontmatter -> { chave: texto }. Listas viram "a, b"; objetos aninhados são ignorados. */
function simpleProperties(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value)) {
      out[key] = value.filter((v) => typeof v !== 'object').map(String).join(', ')
    } else if (value instanceof Date) {
      out[key] = value.toISOString().slice(0, 10)
    } else if (typeof value !== 'object') {
      out[key] = String(value)
    }
  }
  return out
}

function lineText(note: IndexedNote, line: number): string {
  lineAt(note, 0) // garante os inícios de linha
  const starts = note.lineStarts!
  const from = starts[line] ?? 0
  const to = line + 1 < starts.length ? starts[line + 1]! - 1 : note.content.length
  return note.content.slice(from, to).trim().slice(0, 240)
}

export class VaultIndex {
  private notes = new Map<string, IndexedNote>()
  /** Canvas: caminho -> conteúdo JSON (para o grafo e para atualizar caminhos ao renomear). */
  private canvases = new Map<string, string>()
  /** Anexos do cofre (PDF, imagens...): resolvem ![[...]] e são atualizados ao renomear. */
  private files = new Set<string>()
  private resolverCache: LinkResolver | null = null
  private search = VaultIndex.createSearch()

  private static createSearch(): MiniSearch<SearchDoc> {
    return new MiniSearch<SearchDoc>({
      idField: 'path',
      fields: ['title', 'aliases', 'content'],
      processTerm: (term) => normalize(term),
      searchOptions: {
        boost: { title: 4, aliases: 2 },
        prefix: true,
        fuzzy: (term) => (term.length > 4 ? 0.2 : false),
        combineWith: 'AND',
      },
    })
  }

  clear(): void {
    this.notes.clear()
    this.canvases.clear()
    this.files.clear()
    this.search = VaultIndex.createSearch()
    this.resolverCache = null
  }

  get size(): number {
    return this.notes.size
  }

  has(path: string): boolean {
    return this.notes.has(path)
  }

  /** Lê e indexa várias notas com no máximo 16 leituras simultâneas. */
  async build(paths: string[], read: (path: string) => Promise<string>): Promise<void> {
    this.clear()
    let next = 0
    const worker = async () => {
      while (next < paths.length) {
        const path = paths[next++]!
        try {
          this.set(path, await read(path))
        } catch {
          // arquivo sumiu ou está bloqueado: será indexado no próximo evento
        }
        // Cede o processo a cada 50 notas: a janela continua respondendo.
        if (next % 50 === 0) await new Promise((r) => setImmediate(r))
      }
    }
    await Promise.all(Array.from({ length: Math.min(16, paths.length) }, worker))
  }

  /** Indexa (ou reindexa) uma nota. Devolve false se o conteúdo não mudou. */
  set(path: string, content: string): boolean {
    const previous = this.notes.get(path)
    if (previous && previous.content === content) return false
    const parse = parseNote(content)
    const note: IndexedNote = { path, title: basenameNoExt(path), content, parse }
    this.notes.set(path, note)
    if (!previous || previous.parse.aliases.join('\n') !== parse.aliases.join('\n')) this.resolverCache = null
    if (this.search.has(path)) this.search.discard(path)
    this.search.add({ path, title: note.title, aliases: parse.aliases.join(' '), content: content.slice(parse.bodyStart) })
    return true
  }

  setFiles(paths: Iterable<string>): void {
    this.files = new Set(paths)
    this.resolverCache = null
  }

  addFile(path: string): void {
    if (this.files.has(path)) return
    this.files.add(path)
    this.resolverCache = null
  }

  setCanvas(path: string, json: string): void {
    this.canvases.set(path, json)
  }

  remove(path: string): void {
    for (const key of [...this.canvases.keys()]) if (isWithin(key, path)) this.canvases.delete(key)
    for (const key of [...this.files]) {
      if (!isWithin(key, path)) continue
      this.files.delete(key)
      this.resolverCache = null
    }
    for (const key of [...this.notes.keys()]) {
      if (!isWithin(key, path)) continue
      this.notes.delete(key)
      if (this.search.has(key)) this.search.discard(key)
      this.resolverCache = null
    }
  }

  /** Renomeia uma nota ou pasta no índice (sem reler arquivos). */
  rename(from: string, to: string): void {
    for (const [key, json] of [...this.canvases]) {
      if (!isWithin(key, from)) continue
      this.canvases.delete(key)
      this.canvases.set(replacePrefix(key, from, to), json)
    }
    for (const key of [...this.files]) {
      if (!isWithin(key, from)) continue
      this.files.delete(key)
      this.files.add(replacePrefix(key, from, to))
    }
    // Reaproveita o parse: só o caminho (e o título) mudam.
    for (const [key, note] of [...this.notes]) {
      if (!isWithin(key, from)) continue
      const path = replacePrefix(key, from, to)
      this.notes.delete(key)
      if (this.search.has(key)) this.search.discard(key)
      const moved: IndexedNote = { path, title: basenameNoExt(path), content: note.content, parse: note.parse }
      this.notes.set(path, moved)
      this.search.add({ path, title: moved.title, aliases: note.parse.aliases.join(' '), content: note.content.slice(note.parse.bodyStart) })
    }
    this.resolverCache = null
  }

  resolver(): LinkResolver {
    this.resolverCache ??= new LinkResolver([
      ...[...this.notes.values()].map((n) => ({ path: n.path, aliases: n.parse.aliases })),
      ...[...this.files].map((path) => ({ path })),
    ])
    return this.resolverCache
  }

  summaries(): NoteSummary[] {
    return [...this.notes.values()].map((n) => ({
      path: n.path,
      title: n.title,
      aliases: n.parse.aliases,
      tags: n.parse.tagSet,
      properties: simpleProperties(n.parse.frontmatter),
    }))
  }

  headings(path: string): string[] {
    return this.notes.get(path)?.parse.headings.map((h) => h.text) ?? []
  }

  /** Contagem de notas por tag. Tags-pai contam as filhas (#a conta #a/b). */
  tags(): TagCount[] {
    const counts = new Map<string, number>()
    for (const note of this.notes.values()) {
      const expanded = new Set(note.parse.tagSet.flatMap(expandTag))
      for (const tag of expanded) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag, 'pt-BR'))
  }

  backlinks(target: string, options: { unlinked?: boolean } = {}): Backlinks {
    const resolver = this.resolver()
    const linked: MentionGroup[] = []
    const linkingSources = new Set<string>()

    for (const note of this.notes.values()) {
      if (note.path === target) continue
      const hits = note.parse.links.filter((l) => l.target && resolver.resolve(l.target, note.path) === target)
      if (hits.length === 0) continue
      linkingSources.add(note.path)
      linked.push({
        path: note.path,
        title: note.title,
        mentions: hits.map((l) => ({ line: l.line, text: lineText(note, l.line), from: l.from, to: l.to })),
      })
    }

    // Menções não vinculadas: o título (ou apelido) aparece como palavra
    // inteira em notas que ainda não têm link para a nota alvo.
    const unlinked: MentionGroup[] = []
    const targetNote = this.notes.get(target)
    const names = [basenameNoExt(target), ...(targetNote?.parse.aliases ?? [])].filter((n) => n.length >= 3)
    if (options.unlinked !== false && names.length > 0) {
      const pattern = new RegExp(
        `(?<![\\p{L}\\p{N}_])(?:${names.map(escapeRegex).join('|')})(?![\\p{L}\\p{N}_])`,
        'giu',
      )
      for (const note of this.notes.values()) {
        if (note.path === target || linkingSources.has(note.path)) continue
        note.masked ??= maskCode(note.content, note.parse.bodyStart)
        const masked = note.masked
        const mentions = []
        for (const m of masked.matchAll(pattern)) {
          const from = m.index
          const to = from + m[0].length
          if (note.parse.links.some((l) => from < l.to && to > l.from)) continue
          const line = lineAt(note, from)
          mentions.push({ line, text: lineText(note, line), from, to })
          if (mentions.length >= 20) break
        }
        if (mentions.length) unlinked.push({ path: note.path, title: note.title, mentions })
      }
    }

    const byTitle = (a: MentionGroup, b: MentionGroup) => a.title.localeCompare(b.title, 'pt-BR')
    return { linked: linked.sort(byTitle), unlinked: unlinked.sort(byTitle) }
  }

  /**
   * Transforma uma menção solta em link: "Opalite" -> "[[Opalite]]".
   * Confere se o texto ainda está na posição esperada (o arquivo pode ter mudado).
   */
  linkMention(source: string, from: number, to: number, target: string): FileEdit {
    const note = this.notes.get(source)
    if (!note) throw new Error('Nota de origem não encontrada.')
    const original = note.content.slice(from, to)
    const names = [basenameNoExt(target), ...(this.notes.get(target)?.parse.aliases ?? [])].map(normalize)
    if (!names.includes(normalize(original))) throw new Error('A nota mudou. Atualize o painel e tente de novo.')
    const linkText = this.resolver().linkTextFor(target)
    const link = original === linkText ? `[[${linkText}]]` : `[[${linkText}|${original}]]`
    return { path: source, content: note.content.slice(0, from) + link + note.content.slice(to) }
  }

  /**
   * Calcula as edições necessárias para manter os links funcionando depois de
   * renomear `from` para `to` (nota ou pasta). Deve ser chamado ANTES de
   * `rename()`, pois resolve os links com o estado antigo do cofre.
   * Os caminhos devolvidos já são os novos.
   */
  computeRenameEdits(from: string, to: string): FileEdit[] {
    const oldResolver = this.resolver()
    const move = (p: string) => (isWithin(p, from) ? replacePrefix(p, from, to) : p)
    const newResolver = new LinkResolver([
      ...[...this.notes.values()].map((n) => ({ path: move(n.path), aliases: n.parse.aliases })),
      ...[...this.files].map((p) => ({ path: move(p) })),
    ])
    const edits: FileEdit[] = []

    for (const note of this.notes.values()) {
      let content = note.content
      let changed = false
      // De trás para frente: substituir não desloca as posições anteriores.
      for (const link of [...note.parse.links].reverse()) {
        if (!link.target) continue
        const resolved = oldResolver.resolve(link.target, note.path)
        if (!resolved || !isWithin(resolved, from)) continue
        const newPath = replacePrefix(resolved, from, to)
        const usedPath = link.target.includes('/')
        const newTarget = usedPath ? stripMd(newPath) : newResolver.linkTextFor(newPath)
        if (newTarget === link.target) continue
        const inner = newTarget + (link.section ? `#${link.section}` : '') + (link.alias ? `|${link.alias}` : '')
        content = content.slice(0, link.from) + `${link.embed ? '!' : ''}[[${inner}]]` + content.slice(link.to)
        changed = true
      }
      if (changed) {
        const path = isWithin(note.path, from) ? replacePrefix(note.path, from, to) : note.path
        edits.push({ path, content })
      }
    }

    // Canvas guardam o caminho dos arquivos nos cartões de nota ("file").
    for (const [canvasPath, json] of this.canvases) {
      const data = safeCanvas(json)
      if (!data) continue
      let changed = false
      for (const node of data.nodes) {
        if (node.type === 'file' && typeof node.file === 'string' && isWithin(node.file, from)) {
          node.file = replacePrefix(node.file, from, to)
          changed = true
        }
      }
      if (changed) {
        edits.push({
          path: isWithin(canvasPath, from) ? replacePrefix(canvasPath, from, to) : canvasPath,
          content: `${JSON.stringify(data, null, 2)}
`,
        })
      }
    }
    return edits
  }

  /**
   * Dados da visualização em gráfico: notas, canvas, notas ainda não criadas
   * e tags, com as conexões entre eles. A interface filtra o que exibir.
   */
  graph(): GraphData {
    const resolver = this.resolver()
    const nodes = new Map<string, GraphNode>()
    const edges = new Map<string, GraphEdge>()
    const addEdge = (source: string, target: string) => {
      if (source === target) return
      const key = source < target ? `${source}|${target}` : `${target}|${source}`
      if (!edges.has(key)) edges.set(key, { source, target })
    }
    const topFolder = (path: string) => (path.includes('/') ? path.slice(0, path.indexOf('/')) : '')

    for (const note of this.notes.values()) {
      nodes.set(note.path, { id: note.path, label: note.title, kind: 'note', folder: topFolder(note.path), tags: note.parse.tagSet.slice(0, 1) })
    }
    for (const path of this.canvases.keys()) {
      nodes.set(path, { id: path, label: basenameNoExt(path.replace(/\.canvas$/i, '.md')), kind: 'canvas', folder: topFolder(path), tags: [] })
    }
    for (const note of this.notes.values()) {
      for (const link of note.parse.links) {
        if (!link.target) continue
        const target = resolver.resolve(link.target, note.path)
        if (target && this.files.has(target)) continue // anexos não entram no gráfico
        if (target) addEdge(note.path, target)
        else {
          const id = `?:${link.target.toLowerCase()}`
          if (!nodes.has(id)) nodes.set(id, { id, label: link.target, kind: 'unresolved', folder: '', tags: [] })
          addEdge(note.path, id)
        }
      }
      for (const tag of note.parse.tagSet) {
        const id = `tag:${tag}`
        if (!nodes.has(id)) nodes.set(id, { id, label: `#${tag}`, kind: 'tag', folder: '', tags: [tag] })
        addEdge(note.path, id)
      }
    }
    for (const [path, json] of this.canvases) {
      const data = safeCanvas(json)
      for (const node of data?.nodes ?? []) {
        if (node.type === 'file' && typeof node.file === 'string' && nodes.has(node.file)) addEdge(path, node.file)
      }
    }
    return { nodes: [...nodes.values()], edges: [...edges.values()] }
  }

  query(raw: string, limit = 60): SearchResult[] {
    const q = parseQuery(raw)
    if (!q.terms.length && !q.phrases.length && !q.tags.length && !q.paths.length && !q.files.length) return []

    const textQuery = [...q.terms, ...q.phrases].join(' ')
    // O MiniSearch já devolve por relevância; sem texto, ordena por título.
    const candidates: Array<{ path: string; score: number }> = textQuery
      ? this.search.search(textQuery).map((r) => ({ path: String(r.id), score: r.score }))
      : [...this.notes.values()]
          .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'))
          .map((n) => ({ path: n.path, score: 0 }))

    const terms = [...q.phrases, ...q.terms]
    const results: SearchResult[] = []
    for (const { path, score } of candidates) {
      if (results.length >= limit) break
      const note = this.notes.get(path)
      if (!note) continue
      if (q.tags.length) {
        const tags = new Set(note.parse.tagSet.flatMap(expandTag).map(normalize))
        if (!q.tags.every((t) => tags.has(t))) continue
      }
      if (q.paths.length) {
        const normPath = normalize(path)
        if (!q.paths.every((p) => normPath.includes(p))) continue
      }
      if (q.files.length && !q.files.every((f) => normalize(note.title).includes(f))) continue
      // Normalizar o texto inteiro é caro: só quando há frase exata.
      if (q.phrases.length) {
        const normContent = normalize(note.content)
        if (!q.phrases.every((p) => normContent.includes(p))) continue
      }
      results.push({ path, title: note.title, score, matches: findMatches(note.content, terms) })
    }
    return results
  }
}

export interface ParsedQuery {
  terms: string[]
  phrases: string[]
  tags: string[]
  paths: string[]
  files: string[]
}

/** Interpreta a busca: texto livre, "frase exata", tag:x ou #x, path:x, file:x. */
export function parseQuery(raw: string): ParsedQuery {
  const q: ParsedQuery = { terms: [], phrases: [], tags: [], paths: [], files: [] }
  const token = /(\w+):"([^"]*)"|(\w+):(\S+)|"([^"]*)"|(\S+)/g
  for (const m of raw.matchAll(token)) {
    const key = (m[1] ?? m[3])?.toLowerCase()
    const value = normalize((m[2] ?? m[4] ?? '').trim())
    if (key && value) {
      if (key === 'tag') q.tags.push(value.replace(/^#/, ''))
      else if (key === 'path') q.paths.push(value)
      else if (key === 'file') q.files.push(value)
      else q.terms.push(normalize(m[0]))
      continue
    }
    if (m[5] !== undefined) {
      const phrase = normalize(m[5].trim())
      if (phrase) q.phrases.push(phrase)
      continue
    }
    const word = normalize(m[6] ?? '')
    if (word.startsWith('#') && word.length > 1) q.tags.push(word.slice(1))
    else if (word) q.terms.push(word)
  }
  return q
}

/** Até 3 linhas que contêm algum termo, com as faixas para destacar. */
function findMatches(content: string, terms: string[]): SearchMatch[] {
  if (!terms.length) return []
  const matches: SearchMatch[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length && matches.length < 3; i++) {
    const line = lines[i]!
    const norm = normalize(line)
    const ranges: Array<[number, number]> = []
    for (const term of terms) {
      let at = norm.indexOf(term)
      while (at !== -1) {
        ranges.push([at, at + term.length])
        at = norm.indexOf(term, at + term.length)
      }
    }
    if (!ranges.length) continue
    // Recorta linhas longas em volta da primeira ocorrência.
    ranges.sort((a, b) => a[0] - b[0])
    const start = Math.max(0, ranges[0]![0] - 60)
    const text = line.slice(start, start + 220)
    matches.push({
      line: i,
      text: (start > 0 ? '…' : '') + text,
      ranges: ranges
        .filter(([a]) => a >= start && a < start + 220)
        .map(([a, b]) => [a - start + (start > 0 ? 1 : 0), Math.min(b, start + 220) - start + (start > 0 ? 1 : 0)]),
    })
  }
  return matches
}
