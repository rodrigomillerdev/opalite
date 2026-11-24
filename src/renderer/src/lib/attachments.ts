import type { FileKind, TreeNode } from '../../../shared/types'

/*
 * Anexos (PDF, DOCX, imagens e outros arquivos) na interface:
 * tipo por extensão, URLs "blob:" para exibir sem acessar o disco direto,
 * importação de arquivos soltos na janela e o texto de incorporação.
 */

export const ATTACHMENTS_FOLDER = 'Anexos'

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']
const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
}

export function extOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const i = name.lastIndexOf('.')
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase()
}

export function kindOf(path: string): FileKind {
  const ext = extOf(path)
  if (ext === 'md') return 'md'
  if (ext === 'canvas') return 'canvas'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (IMAGE_EXTS.includes(ext)) return 'image'
  return 'file'
}

export function isAttachment(path: string): boolean {
  const k = kindOf(path)
  return k !== 'md' && k !== 'canvas'
}

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

// ------------------------------------------------------------ blobs

const blobs = new Map<string, Promise<string>>()

/** URL temporária para exibir um arquivo do cofre (imagens, capas). */
const MAX_BLOBS = 80

export function blobUrl(path: string): Promise<string> {
  let url = blobs.get(path)
  if (url) {
    // Reinsere para marcar como usado recentemente.
    blobs.delete(path)
    blobs.set(path, url)
  } else {
    url = window.opalite.files.readBinary(path).then((bytes) =>
      URL.createObjectURL(new Blob([bytes as BlobPart], { type: MIME[extOf(path)] ?? 'application/octet-stream' })),
    )
    url.catch(() => blobs.delete(path))
    blobs.set(path, url)
    // Libera as URLs mais antigas (cada uma segura o arquivo inteiro na memória).
    while (blobs.size > MAX_BLOBS) forgetBlob(blobs.keys().next().value!)
  }
  return url
}

/** Ao fechar ou trocar de cofre. */
export function clearBlobs(): void {
  for (const path of [...blobs.keys()]) forgetBlob(path)
}

/** O arquivo mudou ou sumiu: descarta a URL antiga. */
export function forgetBlob(path: string): void {
  const url = blobs.get(path)
  if (!url) return
  blobs.delete(path)
  void url.then((u) => URL.revokeObjectURL(u)).catch(() => undefined)
}

// ------------------------------------------------------------ árvore

export function flattenFiles(nodes: TreeNode[], out: Array<{ path: string; ext: FileKind }> = []) {
  for (const n of nodes) {
    if (n.kind === 'file') out.push({ path: n.path, ext: n.ext })
    else flattenFiles(n.children, out)
  }
  return out
}

/**
 * Encontra um arquivo citado em ![[...]] ou [[...]]: caminho exato,
 * depois o nome do arquivo em qualquer pasta (o mais raso vence).
 */
export function findFile(tree: TreeNode[], target: string): string | null {
  const wanted = target.trim().replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
  const files = flattenFiles(tree)
  const exact = files.find((f) => f.path.toLowerCase() === wanted)
  if (exact) return exact.path
  const byName = files.filter((f) => fileName(f.path).toLowerCase() === fileName(wanted))
  byName.sort((a, b) => a.path.split('/').length - b.path.split('/').length)
  return byName[0]?.path ?? null
}

/** Texto para inserir na nota: imagens e PDFs são incorporados (![[...]]); o resto vira link. */
export function embedFor(path: string): string {
  const k = kindOf(path)
  if (k === 'md') return `[[${path.replace(/\.md$/i, '')}]]`
  return k === 'image' || k === 'pdf' ? `![[${path}]]` : `[[${path}]]`
}

// ------------------------------------------------------------ importação

export interface ImportResult {
  paths: string[]
  errors: string[]
}

/** Copia arquivos (soltos na janela ou escolhidos) para uma pasta do cofre. */
export async function importFiles(files: File[], dir: string): Promise<ImportResult> {
  const result: ImportResult = { paths: [], errors: [] }
  for (const file of files) {
    try {
      if (file.size === 0 && !file.type) throw new Error('pastas não podem ser importadas')
      const bytes = new Uint8Array(await file.arrayBuffer())
      result.paths.push(await window.opalite.files.importFile(dir, file.name, bytes))
    } catch (err) {
      result.errors.push(`${file.name}: ${(err as Error).message}`)
    }
  }
  return result
}
