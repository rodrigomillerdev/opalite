import path from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import type { VaultEvent, VaultEventType } from '../../shared/types'
import { isHiddenRel, toPosix } from './paths'

const RELEVANT = new Set<string>(['add', 'change', 'unlink', 'addDir', 'unlinkDir'])

/**
 * Observa a pasta do cofre e avisa sobre mudanças feitas fora do app
 * (outro editor, sincronização do OneDrive, Git...). Os eventos são agrupados
 * em lotes curtos para não inundar a interface quando muitos arquivos mudam.
 */
export class VaultWatcher {
  private watcher: FSWatcher | null = null
  private queue: VaultEvent[] = []
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly onBatch: (events: VaultEvent[]) => void,
    private readonly batchMs = 60,
  ) {}

  start(root: string): void {
    void this.stop()
    const watcher = watch(root, {
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (abs) => {
        const rel = toPosix(path.relative(root, abs))
        return rel !== '' && isHiddenRel(rel)
      },
      // Espera o arquivo parar de crescer antes de avisar (gravações grandes).
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
    })
    watcher.on('all', (type, abs) => {
      if (!RELEVANT.has(type)) return
      const rel = toPosix(path.relative(root, abs))
      if (rel) this.push({ type: type as VaultEventType, path: rel })
    })
    watcher.on('error', (err) => console.warn('[opalite] watcher:', err))
    this.watcher = watcher
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.queue = []
    const current = this.watcher
    this.watcher = null
    await current?.close()
  }

  private push(event: VaultEvent): void {
    this.queue.push(event)
    if (this.timer) return
    this.timer = setTimeout(() => {
      const batch = this.queue
      this.queue = []
      this.timer = null
      this.onBatch(batch)
    }, this.batchMs)
  }
}
