import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { FileContent, TreeNode, VaultInfo } from '../../shared/types'
import {
  VaultPathError,
  basenameRel,
  dirnameRel,
  isInside,
  CANVAS_EXT,
  extOf,
  fileKind,
  isAllowedAttachment,
  EMPTY_CANVAS,
  NOTE_EXT,
  editableExt,
  joinRel,
  normalizeRel,
  resolveInVault,
  sanitizeFileName,
  uniqueRel,
} from './paths'
import { readTree } from './tree'

const MAX_BINARY = 300 * 1024 * 1024

export interface VaultServiceDeps {
  /** Move um caminho absoluto para a lixeira. No app real é `shell.trashItem`. */
  trash(absPath: string): Promise<void>
}

/**
 * Todas as operações de disco do cofre. Não depende do Electron (a lixeira é
 * injetada), então pode ser testado com Vitest numa pasta temporária.
 */
export class VaultService {
  private root: string | null = null

  constructor(private readonly deps: VaultServiceDeps) {}

  async open(dir: string): Promise<VaultInfo> {
    // realpath resolve links simbólicos e normaliza maiúsculas/minúsculas,
    // então a raiz guardada é o caminho "verdadeiro" da pasta.
    const real = await fs.realpath(dir)
    const stat = await fs.stat(real)
    if (!stat.isDirectory()) throw new Error('O caminho escolhido não é uma pasta.')
    this.root = real
    return this.info()!
  }

  close(): void {
    this.root = null
  }

  info(): VaultInfo | null {
    return this.root ? { root: this.root, name: path.basename(this.root) } : null
  }

  async tree(): Promise<TreeNode[]> {
    return readTree(this.requireRoot())
  }

  async read(rel: string): Promise<FileContent> {
    const norm = this.requireEditable(rel)
    const abs = await this.resolve(norm)
    const [content, stat] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)])
    return { path: norm, content, mtimeMs: stat.mtimeMs }
  }

  async write(rel: string, content: string): Promise<{ mtimeMs: number }> {
    if (typeof content !== 'string') throw new Error('Conteúdo inválido.')
    const abs = await this.resolve(this.requireEditable(rel))
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await atomicWrite(abs, content)
    const stat = await fs.stat(abs)
    return { mtimeMs: stat.mtimeMs }
  }

  /** Cria uma nota. Se o nome já existir, usa "Nome 1.md" etc. Retorna o caminho final. */
  async createNote(rel: string, content = ''): Promise<string> {
    return this.createFile(rel, content, NOTE_EXT)
  }

  /** Lê qualquer arquivo do cofre como bytes (PDF, imagens...), com limite de tamanho. */
  async readBinary(rel: string): Promise<Uint8Array> {
    const norm = normalizeRel(rel)
    if (!fileKind(basenameRel(norm))) throw new VaultPathError('Tipo de arquivo não suportado.')
    const abs = await this.resolve(norm)
    const stat = await fs.stat(abs)
    if (stat.size > MAX_BINARY) throw new Error('Arquivo grande demais (limite de 300 MB).')
    return new Uint8Array(await fs.readFile(abs))
  }

  /**
   * Grava um arquivo novo a partir de bytes (importação por arrastar e soltar,
   * resultado de conversões). Nunca sobrescreve: usa "nome 1.pdf" se preciso.
   */
  async importFile(dir: string, name: string, bytes: Uint8Array): Promise<string> {
    if (!(bytes instanceof Uint8Array)) throw new Error('Conteúdo inválido.')
    if (bytes.byteLength > MAX_BINARY) throw new Error('Arquivo grande demais (limite de 300 MB).')
    const ext = extOf(name)
    const stem = sanitizeFileName(ext ? name.slice(0, -(ext.length + 1)) : name)
    // Preserva a caixa original da extensão ("FOTO.PNG" continua .PNG).
    const clean = ext ? `${stem}.${name.slice(name.length - ext.length)}` : stem
    if (!isAllowedAttachment(clean)) throw new Error(`Tipo de arquivo não permitido: .${ext || '?'}`)
    const target = normalizeRel(joinRel(dir ? this.sanitizeRel(dir, { ext: null }) : '', clean))
    const final = await uniqueRel(target, (c) => this.exists(c))
    const abs = await this.resolve(final)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, bytes, { flag: 'wx' })
    return final
  }

  /**
   * Sobrescreve um arquivo existente com novos bytes (editores de documento,
   * planilha e apresentação). Escrita atômica; devolve o conteúdo anterior
   * para quem chamou guardar no histórico.
   */
  async writeBinary(rel: string, bytes: Uint8Array): Promise<{ previous: Uint8Array | null; mtimeMs: number }> {
    if (!(bytes instanceof Uint8Array)) throw new Error('Conteúdo inválido.')
    if (bytes.byteLength > MAX_BINARY) throw new Error('Arquivo grande demais (limite de 300 MB).')
    const norm = normalizeRel(rel)
    if (!isAllowedAttachment(basenameRel(norm)) || norm.toLowerCase().endsWith('.md') || norm.toLowerCase().endsWith('.canvas')) {
      throw new VaultPathError('Tipo de arquivo não permitido.')
    }
    const abs = await this.resolve(norm)
    let previous: Uint8Array | null = null
    try {
      previous = new Uint8Array(await fs.readFile(abs))
    } catch {
      // arquivo novo
    }
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await atomicWrite(abs, bytes)
    return { previous, mtimeMs: (await fs.stat(abs)).mtimeMs }
  }

  /** Tamanho e data de modificação de vários itens (gerenciador de arquivos). */
  async stats(rels: string[]): Promise<Record<string, { size: number; mtimeMs: number }>> {
    const out: Record<string, { size: number; mtimeMs: number }> = {}
    await Promise.all(
      rels.slice(0, 5000).map(async (rel) => {
        try {
          const norm = normalizeRel(rel)
          const st = await fs.stat(await this.resolve(norm))
          out[rel] = { size: st.isFile() ? st.size : 0, mtimeMs: st.mtimeMs }
        } catch {
          // item sumiu
        }
      }),
    )
    return out
  }

  /** Cria um canvas (JSON Canvas, extensão .canvas). */
  async createCanvas(rel: string, content = EMPTY_CANVAS): Promise<string> {
    return this.createFile(rel, content, CANVAS_EXT)
  }

  private async createFile(rel: string, content: string, ext: string): Promise<string> {
    const target = this.sanitizeRel(rel, { ext })
    const final = await uniqueRel(target, (c) => this.exists(c))
    const abs = await this.resolve(final)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    // flag "wx": falha se o arquivo surgir entre a checagem e a escrita.
    await fs.writeFile(abs, content, { encoding: 'utf8', flag: 'wx' })
    return final
  }

  async createFolder(rel: string): Promise<string> {
    const target = this.sanitizeRel(rel, { ext: null })
    const final = await uniqueRel(target, (c) => this.exists(c))
    await fs.mkdir(await this.resolve(final), { recursive: true })
    return final
  }

  /** Renomeia ou move. Nunca sobrescreve um item existente. */
  async rename(fromRel: string, toRel: string): Promise<string> {
    const from = normalizeRel(fromRel)
    const fromAbs = await this.resolve(from)
    const stat = await fs.stat(fromAbs)
    // Arquivos mantêm a extensão original se a pessoa não digitar uma.
    const fileExt = stat.isFile() && extOf(from) ? `.${extOf(from)}` : null
    const to = this.sanitizeRel(toRel, { ext: fileExt })
    if (to === from) return from
    const toAbs = await this.resolve(to)

    // No Windows "nota.md" e "Nota.md" são o mesmo arquivo: renomear só a
    // caixa das letras é permitido, mesmo que o destino "exista".
    const caseOnly = from.toLowerCase() === to.toLowerCase()
    if (!caseOnly && (await this.exists(to))) {
      throw new Error(`Já existe um item chamado "${basenameRel(to)}".`)
    }
    if (stat.isDirectory() && isInside(fromAbs, toAbs)) {
      throw new Error('Não é possível mover uma pasta para dentro dela mesma.')
    }
    await fs.mkdir(path.dirname(toAbs), { recursive: true })
    await fs.rename(fromAbs, toAbs)
    return to
  }

  async trash(rel: string): Promise<void> {
    const abs = await this.resolve(normalizeRel(rel))
    await this.deps.trash(abs)
  }

  /** Caminho absoluto validado, para quem precisa (ex.: "mostrar no Explorer"). */
  async absolutePath(rel: string): Promise<string> {
    return this.resolve(normalizeRel(rel), { allowRoot: true })
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await fs.access(resolveInVault(this.requireRoot(), rel))
      return true
    } catch {
      return false
    }
  }

  // ---------------------------------------------------------------- internos

  private requireRoot(): string {
    if (!this.root) throw new Error('Nenhum cofre aberto.')
    return this.root
  }

  /** Só notas (.md) e canvas (.canvas) podem ser lidos e gravados pelo app. */
  private requireEditable(rel: string): string {
    const norm = normalizeRel(rel)
    if (!editableExt(norm)) throw new VaultPathError('Só arquivos .md e .canvas podem ser abertos.')
    return norm
  }

  /**
   * Para nomes digitados pela pessoa: limpa cada segmento (em vez de rejeitar
   * "Reunião: pauta?") e, para notas, garante a extensão .md. ".." continua
   * proibido, e o resultado ainda passa por normalizeRel.
   */
  private sanitizeRel(rel: string, options: { ext: string | null }): string {
    if (typeof rel !== 'string') throw new VaultPathError('Caminho inválido.')
    const segments = rel
      .replace(/\\/g, '/')
      .split('/')
      .filter((seg) => seg !== '' && seg !== '.')
    if (segments.includes('..')) throw new VaultPathError('O caminho sai do cofre.')
    const last = segments.pop()
    if (last === undefined) throw new VaultPathError('Informe um nome.')
    const ext = options.ext
    const stem = ext && last.toLowerCase().endsWith(ext) ? last.slice(0, -ext.length) : last
    const name = ext ? `${sanitizeFileName(stem)}${ext}` : sanitizeFileName(last)
    return normalizeRel(joinRel(segments.map(sanitizeFileName).join('/'), name))
  }

  /**
   * Resolve e confere links simbólicos: o ancestral existente mais próximo,
   * depois de resolvido pelo SO, ainda precisa estar dentro do cofre.
   */
  private async resolve(rel: string, options: { allowRoot?: boolean } = {}): Promise<string> {
    const root = this.requireRoot()
    const abs = resolveInVault(root, rel, options)
    let probe = abs
    for (;;) {
      try {
        const real = await fs.realpath(probe)
        if (!isInside(root, real)) throw new VaultPathError('O caminho sai do cofre.')
        return abs
      } catch (err) {
        if (err instanceof VaultPathError) throw err
        const parent = path.dirname(probe)
        if (parent === probe) return abs
        probe = parent
      }
    }
  }
}

/**
 * Escrita atômica: grava num arquivo temporário oculto e depois renomeia por
 * cima do original. Se o app cair no meio, a nota antiga continua intacta;
 * nunca fica um arquivo pela metade.
 */
async function atomicWrite(abs: string, content: string | Uint8Array): Promise<void> {
  const tmp = path.join(
    path.dirname(abs),
    `.${path.basename(abs)}.${randomBytes(4).toString('hex')}.tmp`,
  )
  await fs.writeFile(tmp, content, typeof content === 'string' ? 'utf8' : undefined)
  try {
    await renameWithRetry(tmp, abs)
  } catch (err) {
    await fs.rm(tmp, { force: true })
    throw err
  }
}

/** Antivírus e OneDrive às vezes seguram o arquivo por milissegundos no Windows. */
async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await fs.rename(from, to)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      const retryable = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
      if (!retryable || i >= attempts - 1) throw err
      await new Promise((r) => setTimeout(r, 40 * (i + 1)))
    }
  }
}
