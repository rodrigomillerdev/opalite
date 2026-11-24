import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/*
 * Histórico de versões e dados do cofre, guardados na pasta oculta
 * `.opalite/` dentro do próprio cofre (vai junto se a pasta for copiada ou
 * sincronizada). Nada aqui toca nos arquivos da pessoa: só cópias.
 *
 *   .opalite/history/<hash do caminho>/index.json   -> caminho e versões
 *   .opalite/history/<hash do caminho>/<id>.<ext>   -> conteúdo de cada versão
 *   .opalite/state/<chave>.json                     -> favoritos etc.
 */

export interface VersionInfo {
  id: string
  /** Momento da cópia (ms desde 1970). */
  time: number
  size: number
  /** Por que a cópia foi feita (ex.: "antes de salvar", "antes de restaurar"). */
  reason: string
}

interface HistoryIndex {
  path: string
  versions: VersionInfo[]
}

const MAX_VERSIONS = 30
/** Notas são salvas a cada pausa na digitação: guarda no máximo uma cópia a cada 10 min. */
export const NOTE_SNAPSHOT_INTERVAL = 10 * 60 * 1000

const STATE_KEY = /^[a-z][a-z0-9-]{0,40}$/

export class VaultHistory {
  constructor(private readonly root: () => string) {}

  private base(): string {
    return path.join(this.root(), '.opalite')
  }

  private dirFor(rel: string): string {
    const hash = createHash('sha1').update(rel.toLowerCase()).digest('hex').slice(0, 20)
    return path.join(this.base(), 'history', hash)
  }

  private async readIndex(rel: string): Promise<HistoryIndex> {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(this.dirFor(rel), 'index.json'), 'utf8')) as HistoryIndex
      if (Array.isArray(raw.versions)) return { path: rel, versions: raw.versions }
    } catch {
      // sem histórico ainda
    }
    return { path: rel, versions: [] }
  }

  private async writeIndex(rel: string, index: HistoryIndex): Promise<void> {
    const dir = this.dirFor(rel)
    await fs.mkdir(dir, { recursive: true })
    const tmp = path.join(dir, `.index.${randomBytes(3).toString('hex')}.tmp`)
    await fs.writeFile(tmp, JSON.stringify(index, null, 2))
    await fs.rename(tmp, path.join(dir, 'index.json'))
  }

  async list(rel: string): Promise<VersionInfo[]> {
    return (await this.readIndex(rel)).versions.slice().sort((a, b) => b.time - a.time)
  }

  /** Quando foi a cópia mais recente (0 se nunca). */
  async lastTime(rel: string): Promise<number> {
    const versions = (await this.readIndex(rel)).versions
    return versions.reduce((m, v) => Math.max(m, v.time), 0)
  }

  /** Guarda uma cópia do conteúdo. Mantém as MAX_VERSIONS mais recentes. */
  async snapshot(rel: string, bytes: Uint8Array | string, reason: string): Promise<VersionInfo> {
    const index = await this.readIndex(rel)
    const ext = path.extname(rel).slice(1).toLowerCase() || 'bin'
    const version: VersionInfo = {
      id: `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`,
      time: Date.now(),
      size: typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.byteLength,
      reason,
    }
    const dir = this.dirFor(rel)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, `${version.id}.${ext}`), bytes)
    index.versions.push(version)
    index.versions.sort((a, b) => a.time - b.time)
    while (index.versions.length > MAX_VERSIONS) {
      const old = index.versions.shift()!
      await fs.rm(path.join(dir, `${old.id}.${ext}`), { force: true })
    }
    await this.writeIndex(rel, index)
    return version
  }

  async read(rel: string, id: string): Promise<Uint8Array> {
    if (!/^[a-z0-9]+$/.test(id)) throw new Error('Versão inválida.')
    const index = await this.readIndex(rel)
    if (!index.versions.some((v) => v.id === id)) throw new Error('Versão não encontrada.')
    const ext = path.extname(rel).slice(1).toLowerCase() || 'bin'
    return new Uint8Array(await fs.readFile(path.join(this.dirFor(rel), `${id}.${ext}`)))
  }

  /** Arquivo renomeado/movido: o histórico acompanha. */
  async move(from: string, to: string): Promise<void> {
    const src = this.dirFor(from)
    const dst = this.dirFor(to)
    if (src === dst) return
    try {
      await fs.access(src)
    } catch {
      return
    }
    // Extensão diferente: as cópias antigas continuam válidas, mas com outro nome de arquivo.
    const index = await this.readIndex(from)
    const fromExt = path.extname(from).slice(1).toLowerCase() || 'bin'
    const toExt = path.extname(to).slice(1).toLowerCase() || 'bin'
    await fs.rm(dst, { recursive: true, force: true })
    await fs.mkdir(path.dirname(dst), { recursive: true })
    await fs.rename(src, dst)
    if (fromExt !== toExt) {
      for (const v of index.versions) await fs.rename(path.join(dst, `${v.id}.${fromExt}`), path.join(dst, `${v.id}.${toExt}`)).catch(() => {})
    }
    await this.writeIndex(to, { path: to, versions: index.versions })
  }

  // ------------------------------------------------------------ estado

  async getState(key: string): Promise<unknown> {
    if (!STATE_KEY.test(key)) throw new Error('Chave inválida.')
    try {
      return JSON.parse(await fs.readFile(path.join(this.base(), 'state', `${key}.json`), 'utf8')) as unknown
    } catch {
      return null
    }
  }

  async setState(key: string, value: unknown): Promise<void> {
    if (!STATE_KEY.test(key)) throw new Error('Chave inválida.')
    const json = JSON.stringify(value ?? null, null, 2)
    if (json.length > 2_000_000) throw new Error('Dados grandes demais.')
    const dir = path.join(this.base(), 'state')
    await fs.mkdir(dir, { recursive: true })
    const tmp = path.join(dir, `.${key}.${randomBytes(3).toString('hex')}.tmp`)
    await fs.writeFile(tmp, json)
    await fs.rename(tmp, path.join(dir, `${key}.json`))
  }
}
