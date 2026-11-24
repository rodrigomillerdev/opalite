import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc'
import type { IpcResult, OpaliteApi, VaultEvent } from '../shared/types'

// O preload roda antes da página, com acesso limitado ao Electron. Ele expõe
// em `window.opalite` uma API pequena e tipada: a interface nunca recebe o
// `ipcRenderer` inteiro, só estas funções.

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!result.ok) throw new Error(result.error)
  return result.data
}

function subscribe<T extends unknown[]>(channel: string, listener: (...args: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, ...args: unknown[]) => listener(...(args as T))
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api: OpaliteApi = {
  vault: {
    pick: (mode) => invoke(IPC.vaultPick, mode),
    openRecent: (root) => invoke(IPC.vaultOpenRecent, root),
    close: () => invoke(IPC.vaultClose),
    current: () => invoke(IPC.vaultCurrent),
    recent: () => invoke(IPC.vaultRecent),
    tree: () => invoke(IPC.vaultTree),
    onEvents: (listener) => subscribe<[VaultEvent[]]>(IPC.vaultEvents, listener),
  },
  files: {
    read: (path) => invoke(IPC.fileRead, path),
    write: (path, content) => invoke(IPC.fileWrite, path, content),
    createNote: (path, content) => invoke(IPC.fileCreateNote, path, content),
    createFolder: (path) => invoke(IPC.fileCreateFolder, path),
    createCanvas: (path) => invoke(IPC.fileCreateCanvas, path),
    rename: (from, to) => invoke(IPC.fileRename, from, to),
    trash: (path) => invoke(IPC.fileTrash, path),
    reveal: (path) => invoke(IPC.fileReveal, path),
    readBinary: (path) => invoke(IPC.fileReadBinary, path),
    importFile: (dir, name, bytes) => invoke(IPC.fileImport, dir, name, bytes),
    openExternal: (path) => invoke(IPC.fileOpenExternal, path),
    writeBinary: (path, bytes) => invoke(IPC.fileWriteBinary, path, bytes),
    stats: (paths) => invoke(IPC.fileStats, paths),
  },
  history: {
    list: (path) => invoke(IPC.historyList, path),
    read: (path, id) => invoke(IPC.historyRead, path, id),
    restore: (path, id) => invoke(IPC.historyRestore, path, id),
  },
  state: {
    get: (key) => invoke(IPC.stateGet, key),
    set: (key, value) => invoke(IPC.stateSet, key, value),
  },
  convert: {
    docxToPdf: (path) => invoke(IPC.convertDocxToPdf, path),
    docxToHtml: (path) => invoke(IPC.convertDocxHtml, path),
    htmlToPdf: (html, page) => invoke(IPC.convertHtmlToPdf, html, page),
  },
  index: {
    notes: () => invoke(IPC.indexNotes),
    tags: () => invoke(IPC.indexTags),
    graph: () => invoke(IPC.indexGraph),
    headings: (path) => invoke(IPC.indexHeadings, path),
    backlinks: (path, options) => invoke(IPC.indexBacklinks, path, options),
    search: (query) => invoke(IPC.indexSearch, query),
    linkMention: (source, from, to, target) => invoke(IPC.indexLinkMention, source, from, to, target),
    onChanged: (listener) => subscribe<[]>(IPC.indexChanged, listener),
  },
  ui: {
    contextMenu: (items) => invoke(IPC.uiContextMenu, items),
    entryMenu: (kind) => invoke(IPC.uiEntryMenu, kind),
    toggleFullscreen: () => invoke(IPC.windowToggleFullscreen),
    minimize: () => invoke(IPC.windowMinimize),
    toggleMaximize: () => invoke(IPC.windowToggleMaximize),
    close: () => invoke(IPC.windowClose),
    isMaximized: () => invoke(IPC.windowIsMaximized),
    onMaximized: (listener) => subscribe<[boolean]>(IPC.windowMaximized, listener),
    zoom: (step) => invoke(IPC.windowZoom, step),
    spelling: () => invoke(IPC.uiSpelling),
    replaceMisspelling: (word) => invoke(IPC.uiSpellReplace, word),
    addToDictionary: (word) => invoke(IPC.uiSpellAdd, word),
    edit: (action) => invoke(IPC.uiEdit, action),
    onFullscreen: (listener) => subscribe<[boolean]>(IPC.windowFullscreen, listener),
  },
  app: {
    onBeforeClose: (listener) => subscribe<[]>(IPC.appBeforeClose, listener),
    closeReady: () => ipcRenderer.send(IPC.appCloseReady),
  },
}

contextBridge.exposeInMainWorld('opalite', api)

// Só nos testes automatizados (OPALITE_E2E=1): permite ao teste posicionar o cursor.
if (process.argv.includes('--opalite-e2e')) contextBridge.exposeInMainWorld('opaliteE2E', true)
