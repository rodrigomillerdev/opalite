import { promises as fs } from 'node:fs'
import path from 'node:path'

interface SettingsData {
  recentVaults: string[]
  lastVault: string | null
  /** Zoom da interface (1 = 100%). */
  zoom: number
}

const DEFAULTS: SettingsData = { recentVaults: [], lastVault: null, zoom: 1 }
const MAX_RECENT = 8

/**
 * Preferências do app (não do cofre), salvas em JSON na pasta de dados do
 * usuário (%APPDATA%/Opalite no Windows). Configurações de cada cofre irão,
 * em fases futuras, para a pasta oculta `.opalite/` dentro do próprio cofre.
 */
export class SettingsStore {
  private data: SettingsData = { ...DEFAULTS }

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<SettingsData>
      this.data = {
        recentVaults: Array.isArray(raw.recentVaults)
          ? raw.recentVaults.filter((v): v is string => typeof v === 'string')
          : [],
        lastVault: typeof raw.lastVault === 'string' ? raw.lastVault : null,
        zoom: typeof raw.zoom === 'number' && raw.zoom >= 0.5 && raw.zoom <= 3 ? raw.zoom : 1,
      }
    } catch {
      this.data = { ...DEFAULTS } // primeiro uso ou arquivo corrompido
    }
  }

  get recentVaults(): readonly string[] {
    return this.data.recentVaults
  }

  get lastVault(): string | null {
    return this.data.lastVault
  }

  get zoom(): number {
    return this.data.zoom
  }

  setZoom(zoom: number): void {
    this.data.zoom = zoom
    void this.save().catch(() => {})
  }

  isRecent(root: string): boolean {
    return this.data.recentVaults.some((v) => samePath(v, root))
  }

  async rememberVault(root: string): Promise<void> {
    this.data.recentVaults = [
      root,
      ...this.data.recentVaults.filter((v) => !samePath(v, root)),
    ].slice(0, MAX_RECENT)
    this.data.lastVault = root
    await this.save()
  }

  async forgetVault(root: string): Promise<void> {
    this.data.recentVaults = this.data.recentVaults.filter((v) => !samePath(v, root))
    if (this.data.lastVault && samePath(this.data.lastVault, root)) this.data.lastVault = null
    await this.save()
  }

  async clearLastVault(): Promise<void> {
    this.data.lastVault = null
    await this.save()
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    await fs.rename(tmp, this.file)
  }
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' || process.platform === 'darwin'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b
}
