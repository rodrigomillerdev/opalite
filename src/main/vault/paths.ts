import path from 'node:path'

// Este módulo é a fronteira de segurança do cofre: a interface só fala em
// caminhos relativos, e aqui garantimos que nenhum deles escape da pasta raiz
// (ex.: "../../Windows/system32" ou "C:/outra-pasta").

export class VaultPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaultPathError'
  }
}

export const NOTE_EXT = '.md'
export const CANVAS_EXT = '.canvas'
/** Canvas vazio no formato aberto JSON Canvas (jsoncanvas.org). */
export const EMPTY_CANVAS = `${JSON.stringify({ nodes: [], edges: [] }, null, 2)}\n`

export function isCanvasName(name: string): boolean {
  return name.toLowerCase().endsWith(CANVAS_EXT)
}

export type FileKind = 'md' | 'canvas' | 'pdf' | 'docx' | 'image' | 'file'

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']
/**
 * Anexos aceitos no cofre (importar, listar, abrir no app padrão).
 * É uma lista de permissão: executáveis e scripts (.exe, .bat, .ps1, .js...)
 * nunca entram, para o "abrir no app padrão" não virar um jeito de rodar programas.
 */
const ATTACHMENT_EXTS = new Set([
  'pdf', 'docx', 'doc', 'odt', 'rtf', 'txt', 'csv', 'xlsx', 'xls', 'ods', 'pptx', 'ppt', 'odp',
  'epub', 'json', 'xml', 'html', 'htm', 'zip', 'mp3', 'wav', 'ogg', 'm4a', 'mp4', 'webm', 'mov', 'mkv',
  ...IMAGE_EXTS,
])

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase()
}

/** Tipo do arquivo para a árvore e os visualizadores, ou null se não for exibido. */
export function fileKind(name: string): FileKind | null {
  const ext = extOf(name)
  if (ext === 'md') return 'md'
  if (ext === 'canvas') return 'canvas'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (IMAGE_EXTS.includes(ext)) return 'image'
  return ATTACHMENT_EXTS.has(ext) ? 'file' : null
}

export function isAllowedAttachment(name: string): boolean {
  const ext = extOf(name)
  return ext === 'md' || ATTACHMENT_EXTS.has(ext)
}

/** Extensão de um arquivo que o app sabe abrir (.md ou .canvas), ou undefined. */
export function editableExt(name: string): string | undefined {
  const lower = name.toLowerCase()
  if (lower.endsWith(NOTE_EXT)) return NOTE_EXT
  if (lower.endsWith(CANVAS_EXT)) return CANVAS_EXT
  return undefined
}
export const DEFAULT_NOTE_NAME = 'Sem título'

/** Caracteres proibidos em nomes de arquivo no Windows (o sistema mais restritivo). */
const INVALID_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g
/** Mesmos caracteres, para validação (sem a flag global, que guarda estado). */
const HAS_INVALID_SEGMENT_CHARS = /[:*?"<>|\u0000-\u001f]/
/** Nomes reservados pelo Windows, inválidos com qualquer extensão. */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

export function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

/**
 * Normaliza um caminho relativo vindo da interface: troca "\" por "/",
 * remove barras iniciais e segmentos vazios ou ".", e rejeita "..".
 */
export function normalizeRel(rel: unknown): string {
  if (typeof rel !== 'string') throw new VaultPathError('Caminho inválido.')
  const parts = rel
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.')
  for (const seg of parts) {
    if (seg === '..') throw new VaultPathError('O caminho sai do cofre.')
    if (HAS_INVALID_SEGMENT_CHARS.test(seg)) {
      throw new VaultPathError(`Nome inválido: "${seg}".`)
    }
  }
  return parts.join('/')
}

/** true se `abs` for a própria raiz ou estiver dentro dela. */
export function isInside(root: string, abs: string): boolean {
  const rel = path.relative(root, abs)
  if (rel === '') return true
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
}

/** Converte relativo em absoluto, garantindo que o resultado fique no cofre. */
export function resolveInVault(
  root: string,
  rel: unknown,
  options: { allowRoot?: boolean } = {},
): string {
  const norm = normalizeRel(rel)
  if (norm === '' && !options.allowRoot) {
    throw new VaultPathError('A raiz do cofre não pode ser usada aqui.')
  }
  const abs = path.resolve(root, ...norm.split('/'))
  // Defesa em profundidade: mesmo após a normalização, conferimos o resultado.
  if (!isInside(root, abs)) throw new VaultPathError('O caminho sai do cofre.')
  return abs
}

/** Arquivos e pastas que começam com "." (.git, .opalite, .trash) ficam ocultos. */
export function isHiddenRel(rel: string): boolean {
  return rel.split('/').some((seg) => seg.startsWith('.'))
}

export function isNoteName(name: string): boolean {
  return name.toLowerCase().endsWith(NOTE_EXT)
}

/** Transforma o que a pessoa digitou em um nome de arquivo válido em todos os SOs. */
export function sanitizeFileName(name: string): string {
  let clean = name
    .replace(INVALID_NAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '') // sem ponto inicial: o arquivo ficaria oculto
    .replace(/[. ]+$/, '') // o Windows não aceita ponto ou espaço no final
    .trim()
  if (clean === '') clean = DEFAULT_NOTE_NAME
  if (RESERVED_NAMES.test(clean)) clean = `_${clean}`
  return clean.slice(0, 200)
}

/** Garante a extensão .md, sem duplicá-la ("Nota.md.md"). */
export function withNoteExt(name: string): string {
  return isNoteName(name) ? name : `${name}${NOTE_EXT}`
}

export function dirnameRel(rel: string): string {
  const i = rel.lastIndexOf('/')
  return i === -1 ? '' : rel.slice(0, i)
}

export function basenameRel(rel: string): string {
  return rel.slice(rel.lastIndexOf('/') + 1)
}

export function joinRel(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

/**
 * Se `rel` já existir, devolve "Nome 1.md", "Nome 2.md"... até achar um livre.
 * `exists` é injetado para a função ser testável sem disco.
 */
export async function uniqueRel(
  rel: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  if (!(await exists(rel))) return rel
  const dir = dirnameRel(rel)
  const name = basenameRel(rel)
  // Mantém a extensão no fim: "foto.png" -> "foto 1.png" (pastas não têm extensão).
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot) : ''
  const stem = ext ? name.slice(0, -ext.length) : name
  for (let i = 1; i < 10_000; i++) {
    const candidate = joinRel(dir, `${stem} ${i}${ext}`)
    if (!(await exists(candidate))) return candidate
  }
  throw new VaultPathError('Não foi possível gerar um nome livre.')
}
