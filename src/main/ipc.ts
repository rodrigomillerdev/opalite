import { BrowserWindow, Menu, dialog, ipcMain, shell, type MenuItemConstructorOptions } from 'electron'
import path from 'node:path'
import { IPC } from '../shared/ipc'
import type {
  EntryKind,
  EntryMenuAction,
  IpcResult,
  PickMode,
  VaultInfo,
} from '../shared/types'
import { showContextMenu, spellingAtClick } from './context-menu'
import { docxToHtml, docxToPdf, printHtml } from './convert/docx-to-pdf'
import { rebuildIndex } from './index/indexer'
import type { VaultIndex } from './index/vault-index'
import type { SettingsStore } from './settings'
import { EMPTY_CANVAS, isAllowedAttachment, normalizeRel } from './vault/paths'
import { NOTE_SNAPSHOT_INTERVAL, VaultHistory } from './vault/history'
import type { VaultService } from './vault/vault-service'
import type { VaultWatcher } from './vault/watcher'

export interface IpcContext {
  vault: VaultService
  watcher: VaultWatcher
  settings: SettingsStore
  index: VaultIndex
  /** Avisa a interface que o índice mudou (com debounce). */
  notifyIndexChanged(): void
  getWindow(): BrowserWindow | null
}

function num(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Parâmetro inválido: ${field}.`)
  }
  return value
}

/**
 * Registra um handler que sempre devolve `IpcResult`. Assim a mensagem de erro
 * chega limpa à interface, sem o prefixo "Error invoking remote method...".
 */
/** true se a mensagem veio da página do app (arquivo local ou servidor de desenvolvimento). */
export function trustedSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  const dev = process.env['ELECTRON_RENDERER_URL']
  return url.startsWith('file://') || (Boolean(dev) && url.startsWith(dev!))
}

function handle<A extends unknown[], T>(channel: string, fn: (...args: A) => Promise<T> | T): void {
  ipcMain.handle(channel, async (event, ...args): Promise<IpcResult<T>> => {
    if (!trustedSender(event)) return { ok: false, error: 'Origem não autorizada.' }
    try {
      return { ok: true, data: await fn(...(args as A)) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

/** Validação de entrada: a interface é nossa, mas o main nunca confia cegamente. */
function str(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Parâmetro inválido: ${field}.`)
  return value
}

export function registerIpc(ctx: IpcContext): void {
  const { vault, watcher, settings, index } = ctx
  const history = new VaultHistory(() => {
    const info = vault.info()
    if (!info) throw new Error('Nenhum cofre aberto.')
    return info.root
  })
  /** Última cópia de cada nota nesta sessão (evita ler o índice do histórico a cada salvamento). */
  const lastNoteSnapshot = new Map<string, number>()

  async function openVault(dir: string): Promise<VaultInfo> {
    const info = await vault.open(dir)
    watcher.start(info.root)
    await settings.rememberVault(info.root)
    // O índice é construído em segundo plano; a interface é avisada ao terminar.
    index.clear()
    void rebuildIndex(vault, index).then(ctx.notifyIndexChanged, (err) =>
      console.warn('[opalite] index:', err),
    )
    return info
  }

  handle(IPC.vaultPick, async (mode: PickMode) => {
    const win = ctx.getWindow()
    const options = {
      title: mode === 'create' ? 'Crie ou escolha uma pasta vazia para o novo cofre' : 'Escolha a pasta do cofre',
      buttonLabel: mode === 'create' ? 'Criar cofre aqui' : 'Abrir cofre',
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const dir = result.filePaths[0]
    if (result.canceled || !dir) return null
    return openVault(dir)
  })

  // Só reabre pastas que a pessoa já escolheu antes pelo diálogo.
  handle(IPC.vaultOpenRecent, async (root: unknown) => {
    const dir = str(root, 'root')
    if (!settings.isRecent(dir)) throw new Error('Este cofre não está na lista de recentes.')
    try {
      return await openVault(dir)
    } catch (err) {
      await settings.forgetVault(dir)
      throw new Error(`Não foi possível abrir o cofre: ${(err as Error).message}`)
    }
  })

  handle(IPC.vaultClose, async () => {
    await watcher.stop()
    vault.close()
    index.clear()
    await settings.clearLastVault()
  })

  handle(IPC.vaultCurrent, () => vault.info())

  handle(IPC.vaultRecent, () =>
    settings.recentVaults.map((root) => ({ root, name: path.basename(root) })),
  )

  handle(IPC.vaultTree, () => vault.tree())

  handle(IPC.fileRead, (rel: unknown) => vault.read(str(rel, 'path')))
  // Gravações feitas pelo app atualizam o índice na hora, sem esperar o observador.
  handle(IPC.fileWrite, async (rel: unknown, content: unknown) => {
    const path = normalizeRel(str(rel, 'path'))
    const text = str(content, 'content')
    // Histórico das notas: uma cópia do conteúdo anterior a cada 10 min de edição.
    if (path.toLowerCase().endsWith('.md')) {
      try {
        const last = lastNoteSnapshot.get(path) ?? (await history.lastTime(path))
        if (Date.now() - last > NOTE_SNAPSHOT_INTERVAL) {
          const old = (await vault.read(path)).content
          if (old !== text && old.trim()) await history.snapshot(path, old, 'edição')
          lastNoteSnapshot.set(path, Date.now())
        } else lastNoteSnapshot.set(path, last)
      } catch {
        // nota nova ou ilegível: segue sem cópia
      }
    }
    const result = await vault.write(path, text)
    if (path.toLowerCase().endsWith('.canvas')) {
      index.setCanvas(path, text)
      ctx.notifyIndexChanged()
    } else if (index.set(path, text)) {
      ctx.notifyIndexChanged()
    }
    return result
  })

  handle(IPC.fileCreateNote, async (rel: unknown, content: unknown) => {
    const text = content === undefined ? '' : str(content, 'content')
    const final = await vault.createNote(str(rel, 'path'), text)
    index.set(final, text)
    ctx.notifyIndexChanged()
    return final
  })

  handle(IPC.fileCreateCanvas, async (rel: unknown) => {
    const final = await vault.createCanvas(str(rel, 'path'))
    index.setCanvas(final, EMPTY_CANVAS)
    ctx.notifyIndexChanged()
    return final
  })

  handle(IPC.fileCreateFolder, (rel: unknown) => vault.createFolder(str(rel, 'path')))

  // Renomear ou mover também reescreve os [[links]] que apontavam para o item.
  handle(IPC.fileRename, async (from: unknown, to: unknown) => {
    const source = normalizeRel(str(from, 'from'))
    const final = await vault.rename(source, str(to, 'to'))
    if (final === source) return final
    // 1ª passada descobre quais arquivos têm links para o item; eles são
    // relidos do disco (o índice pode estar alguns ms atrasado em relação a
    // uma edição externa) e só então as edições são calculadas de novo.
    const back = (p: string) => (p === final || p.startsWith(`${final}/`) ? source + p.slice(final.length) : p)
    for (const edit of index.computeRenameEdits(source, final)) {
      try {
        const fresh = (await vault.read(edit.path)).content
        if (edit.path.toLowerCase().endsWith('.canvas')) index.setCanvas(back(edit.path), fresh)
        else index.set(back(edit.path), fresh)
      } catch {
        // arquivo sumiu no meio do caminho: a reescrita dele será ignorada
      }
    }
    const edits = index.computeRenameEdits(source, final)
    index.rename(source, final)
    await history.move(source, final).catch(() => {})
    for (const edit of edits) {
      try {
        await vault.write(edit.path, edit.content)
        index.set(edit.path, edit.content)
      } catch (err) {
        console.warn('[opalite] não foi possível atualizar links em', edit.path, err)
      }
    }
    ctx.notifyIndexChanged()
    return final
  })

  handle(IPC.fileTrash, async (rel: unknown) => {
    const target = str(rel, 'path')
    const name = path.basename(target)
    const win = ctx.getWindow()
    const options = {
      type: 'question' as const,
      message: `Mover "${name}" para a lixeira?`,
      detail: 'Você pode restaurar o item pela lixeira do sistema.',
      buttons: ['Mover para a lixeira', 'Cancelar'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    }
    const { response } = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options)
    if (response !== 0) return false
    await vault.trash(target)
    index.remove(normalizeRel(target))
    ctx.notifyIndexChanged()
    return true
  })

  handle(IPC.fileReadBinary, (rel: unknown) => vault.readBinary(str(rel, 'path')))

  handle(IPC.fileImport, async (dir: unknown, name: unknown, bytes: unknown) => {
    if (!(bytes instanceof Uint8Array)) throw new Error('Conteúdo inválido.')
    const final = await vault.importFile(str(dir, 'dir'), str(name, 'name'), bytes)
    if (final.toLowerCase().endsWith('.md')) index.set(final, Buffer.from(bytes).toString('utf8'))
    else index.addFile(final)
    ctx.notifyIndexChanged()
    return final
  })

  // Só tipos da lista de permissão (nada de executáveis): ver isAllowedAttachment.
  handle(IPC.fileOpenExternal, async (rel: unknown) => {
    const target = str(rel, 'path')
    if (!isAllowedAttachment(target) || /\.(html?|xhtml|svg|xml)$/i.test(target)) {
      throw new Error('Por segurança, este tipo de arquivo não é aberto pelo Opalite. Use "Mostrar no explorador".')
    }
    const error = await shell.openPath(await vault.absolutePath(target))
    if (error) throw new Error(error)
  })

  handle(IPC.fileWriteBinary, async (rel: unknown, bytes: unknown) => {
    if (!(bytes instanceof Uint8Array)) throw new Error('Conteúdo inválido.')
    const target = normalizeRel(str(rel, 'path'))
    const { previous, mtimeMs } = await vault.writeBinary(target, bytes)
    // Editores salvam sozinhos a cada pausa: guarda no máximo uma cópia a cada 5 min.
    if (previous && previous.byteLength) {
      const last = lastNoteSnapshot.get(target) ?? (await history.lastTime(target))
      if (Date.now() - last > 5 * 60 * 1000) {
        await history.snapshot(target, previous, 'antes de salvar')
        lastNoteSnapshot.set(target, Date.now())
      } else lastNoteSnapshot.set(target, last)
    }
    index.addFile(target)
    return { mtimeMs }
  })

  handle(IPC.fileStats, (rels: unknown) => {
    if (!Array.isArray(rels)) throw new Error('Parâmetro inválido: paths.')
    return vault.stats(rels.filter((r): r is string => typeof r === 'string'))
  })

  handle(IPC.historyList, (rel: unknown) => history.list(normalizeRel(str(rel, 'path'))))
  handle(IPC.historyRead, (rel: unknown, id: unknown) => history.read(normalizeRel(str(rel, 'path')), str(id, 'id')))
  handle(IPC.historyRestore, async (rel: unknown, id: unknown) => {
    const target = normalizeRel(str(rel, 'path'))
    const bytes = await history.read(target, str(id, 'id'))
    if (target.toLowerCase().endsWith('.md') || target.toLowerCase().endsWith('.canvas')) {
      const current = await vault.read(target).catch(() => null)
      if (current) await history.snapshot(target, current.content, 'antes de restaurar')
      const text = Buffer.from(bytes).toString('utf8')
      await vault.write(target, text)
      if (target.toLowerCase().endsWith('.canvas')) index.setCanvas(target, text)
      else index.set(target, text)
    } else {
      const { previous } = await vault.writeBinary(target, bytes)
      if (previous) await history.snapshot(target, previous, 'antes de restaurar')
    }
    ctx.notifyIndexChanged()
  })

  handle(IPC.stateGet, (key: unknown) => history.getState(str(key, 'key')))
  handle(IPC.stateSet, (key: unknown, value: unknown) => history.setState(str(key, 'key'), value))

  // Zoom da interface (Ctrl + / Ctrl - / Ctrl 0), lembrado entre sessões.
  handle(IPC.windowZoom, (step: unknown) => {
    const win = ctx.getWindow()
    if (!win) return 1
    const levels = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
    const current = win.webContents.getZoomFactor()
    let i = levels.reduce((best, l, idx) => (Math.abs(l - current) < Math.abs(levels[best]! - current) ? idx : best), 4)
    if (step === 0) i = 4
    else if (step === 1) i = Math.min(levels.length - 1, i + 1)
    else if (step === -1) i = Math.max(0, i - 1)
    win.webContents.setZoomFactor(levels[i]!)
    settings.setZoom(levels[i]!)
    return levels[i]!
  })

  handle(IPC.convertDocxToPdf, async (rel: unknown) => {
    const source = normalizeRel(str(rel, 'path'))
    if (!source.toLowerCase().endsWith('.docx')) throw new Error('Escolha um arquivo .docx.')
    const pdf = await docxToPdf(await vault.readBinary(source))
    const dir = source.includes('/') ? source.slice(0, source.lastIndexOf('/')) : ''
    const name = source.slice(source.lastIndexOf('/') + 1).replace(/\.docx$/i, '.pdf')
    return vault.importFile(dir, name, pdf)
  })

  handle(IPC.convertDocxHtml, async (rel: unknown) => docxToHtml(await vault.readBinary(str(rel, 'path'))))

  handle(IPC.convertHtmlToPdf, (html: unknown, page: unknown) => {
    const size = page && typeof page === 'object' ? (page as { width?: unknown; height?: unknown }) : {}
    const width = typeof size.width === 'number' && size.width > 10000 && size.width < 2_000_000 ? size.width : undefined
    const height = typeof size.height === 'number' && size.height > 10000 && size.height < 2_000_000 ? size.height : undefined
    return printHtml(str(html, 'html'), { width, height })
  })

  handle(IPC.indexNotes, () => index.summaries())
  handle(IPC.indexTags, () => index.tags())
  handle(IPC.indexGraph, () => index.graph())
  handle(IPC.indexHeadings, (rel: unknown) => index.headings(normalizeRel(str(rel, 'path'))))
  handle(IPC.indexBacklinks, (rel: unknown, options: unknown) =>
    index.backlinks(normalizeRel(str(rel, 'path')), { unlinked: (options as { unlinked?: unknown } | undefined)?.unlinked !== false }),
  )
  handle(IPC.indexSearch, (query: unknown) => index.query(str(query, 'query')))
  handle(IPC.indexLinkMention, async (source: unknown, from: unknown, to: unknown, target: unknown) => {
    const edit = index.linkMention(
      normalizeRel(str(source, 'source')),
      num(from, 'from'),
      num(to, 'to'),
      normalizeRel(str(target, 'target')),
    )
    await vault.write(edit.path, edit.content)
    index.set(edit.path, edit.content)
    ctx.notifyIndexChanged()
  })

  handle(IPC.fileReveal, async (rel: unknown) => {
    shell.showItemInFolder(await vault.absolutePath(str(rel, 'path')))
  })

  // Menu de contexto nativo: aparência do sistema e acessível por teclado.
  handle(IPC.uiEntryMenu, (kind: EntryKind) => {
    return new Promise<EntryMenuAction | null>((resolve) => {
      let chosen: EntryMenuAction | null = null
      const item = (label: string, action: EntryMenuAction): MenuItemConstructorOptions => ({
        label,
        click: () => {
          chosen = action
        },
      })
      const revealLabel =
        process.platform === 'darwin'
          ? 'Mostrar no Finder'
          : process.platform === 'linux'
            ? 'Mostrar no gerenciador de arquivos'
            : 'Mostrar no Explorador'
      const template: MenuItemConstructorOptions[] =
        kind === 'file' || kind === 'file-convertible'
          ? [
              ...(kind === 'file-convertible' ? [item('Converter…', 'convert'), { type: 'separator' as const }] : []),
              item('Abrir no aplicativo padrão', 'open-external'),
              item('Renomear', 'rename'),
              item('Duplicar', 'duplicate'),
              item('Copiar link da nota', 'copy-link'),
              item(revealLabel, 'reveal'),
              { type: 'separator' },
              item('Mover para a lixeira', 'trash'),
            ]
          : kind === 'folder'
            ? [
                item('Nova nota', 'new-note'),
                item('Nova pasta', 'new-folder'),
                item('Buscar nesta pasta', 'search-in-folder'),
                { type: 'separator' },
                item('Renomear', 'rename'),
                item(revealLabel, 'reveal'),
                { type: 'separator' },
                item('Mover para a lixeira', 'trash'),
              ]
            : [item('Nova nota', 'new-note'), item('Nova pasta', 'new-folder')]
      const win = ctx.getWindow()
      Menu.buildFromTemplate(template).popup({
        ...(win ? { window: win } : {}),
        callback: () => resolve(chosen),
      })
    })
  })

  handle(IPC.windowToggleFullscreen, () => {
    const win = ctx.getWindow()
    if (win) win.setFullScreen(!win.isFullScreen())
  })

  handle(IPC.uiContextMenu, (items: unknown) => showContextMenu(ctx.getWindow(), items))
  handle(IPC.uiSpelling, () => spellingAtClick())
  handle(IPC.uiSpellReplace, (word: unknown) => ctx.getWindow()?.webContents.replaceMisspelling(str(word, 'word').slice(0, 100)))
  handle(IPC.uiSpellAdd, (word: unknown) => {
    ctx.getWindow()?.webContents.session.addWordToSpellCheckerDictionary(str(word, 'word').slice(0, 100))
  })
  handle(IPC.uiEdit, (action: unknown) => {
    const wc = ctx.getWindow()?.webContents
    if (!wc) return
    if (action === 'cut') wc.cut()
    else if (action === 'copy') wc.copy()
    else if (action === 'paste') wc.paste()
    else if (action === 'pasteAndMatchStyle') wc.pasteAndMatchStyle()
    else if (action === 'selectAll') wc.selectAll()
    else throw new Error('Ação inválida.')
  })

  // Botões de janela da barra de título (Windows/Linux; no macOS ficam os nativos).
  handle(IPC.windowMinimize, () => ctx.getWindow()?.minimize())
  handle(IPC.windowToggleMaximize, () => {
    const win = ctx.getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  handle(IPC.windowClose, () => ctx.getWindow()?.close())
  handle(IPC.windowIsMaximized, () => ctx.getWindow()?.isMaximized() ?? false)
}
