import { BrowserWindow, Menu, app, ipcMain, session, shell } from 'electron'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { IPC } from '../shared/ipc'
import { recordContextParams } from './context-menu'
import { applyVaultEvents, rebuildIndex } from './index/indexer'
import { VaultIndex } from './index/vault-index'
import { registerIpc, trustedSender } from './ipc'
import { SettingsStore } from './settings'
import { VaultService } from './vault/vault-service'
import { VaultWatcher } from './vault/watcher'

// Processo principal: cria a janela, é dono do disco e fala com a interface
// apenas pelos canais IPC registrados em ipc.ts.

let mainWindow: BrowserWindow | null = null
let allowClose = false

const vault = new VaultService({ trash: (abs) => shell.trashItem(abs) })
const index = new VaultIndex()

let indexTimer: NodeJS.Timeout | null = null
function notifyIndexChanged(): void {
  if (indexTimer) return
  indexTimer = setTimeout(() => {
    indexTimer = null
    mainWindow?.webContents.send(IPC.indexChanged)
  }, 250)
}

const watcher = new VaultWatcher((events) => {
  mainWindow?.webContents.send(IPC.vaultEvents, events)
  void applyVaultEvents(events, vault, index).then((changed) => {
    if (changed) notifyIndexChanged()
  })
})
const settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'))

// Identidade do app no Windows: agrupa as janelas na barra de tarefas com o
// ícone do Opalite (e não o do Electron) e permite fixar na barra.
export const APP_ID = 'Opalite.Notes'
if (process.platform === 'win32') app.setAppUserModelId(APP_ID)

// Identidade no Linux: liga a janela ao lançador opalite.desktop (ícone e
// agrupamento no dock/painel, no Wayland e no X11). A função existe no
// Electron, mas não está nas definições de tipo.
if (process.platform === 'linux') {
  ;(app as unknown as { setDesktopName?: (name: string) => void }).setDesktopName?.('opalite.desktop')
}

/** Ícone do app (assets/brand). Ausente em execuções de teste fora da pasta do projeto. */
function iconPath(): string | undefined {
  const file = path.join(app.getAppPath(), 'assets', 'brand', process.platform === 'win32' ? 'opalite.ico' : 'opalite-512.png')
  return existsSync(file) ? file : undefined
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  void app.whenReady().then(start)
}

async function start(): Promise<void> {
  // No Windows/Linux o app usa barra de título própria, sem menu nativo.
  // No macOS o menu do app é necessário para Cmd+C/Cmd+V funcionarem.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  session.defaultSession.setSpellCheckerLanguages(['pt-BR', 'en-US'])

  await settings.load()
  registerIpc({ vault, watcher, settings, index, notifyIndexChanged, getWindow: () => mainWindow })
  ipcMain.on(IPC.appCloseReady, (event) => {
    if (!trustedSender(event)) return
    allowClose = true
    mainWindow?.close()
  })

  // Reabre o cofre passado na linha de comando ou o último usado.
  const candidate = vaultFromArgs() ?? settings.lastVault
  if (candidate) {
    try {
      const info = await vault.open(candidate)
      watcher.start(info.root)
      await settings.rememberVault(info.root)
      void rebuildIndex(vault, index).then(notifyIndexChanged, (err) => console.warn('[opalite] index:', err))
    } catch {
      await settings.clearLastVault()
    }
  }

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Opalite',
    ...(iconPath() ? { icon: iconPath() } : {}),
    backgroundColor: '#0e0e12',
    // Sem barra do sistema: no macOS ficam os botões nativos (semáforo); no
    // Windows e no Linux a própria barra do app desenha minimizar, maximizar e
    // fechar, para acompanhar o tema (inclusive gradientes) e o zoom.
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 13 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      // As três opções abaixo isolam a interface do Node.js: mesmo que um
      // conteúdo malicioso rode na página, ele não acessa o disco diretamente.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      // Gancho de testes automatizados: só em desenvolvimento, nunca no app instalado.
      ...(!app.isPackaged && process.env['OPALITE_E2E'] === '1' ? { additionalArguments: ['--opalite-e2e'] } : {}),
    },
  })
  mainWindow = win

  // Ao fixar na barra de tarefas, o Windows usa estes dados para reabrir o app.
  // Sem eles, o atalho fixado abriria o Electron "puro" em vez do Opalite.
  if (process.platform === 'win32' && !app.isPackaged && iconPath()) {
    win.setAppDetails({
      appId: APP_ID,
      appIconPath: iconPath()!,
      appIconIndex: 0,
      relaunchCommand: `"${process.execPath}" "${app.getAppPath()}"`,
      relaunchDisplayName: 'Opalite',
    })
  }

  win.once('ready-to-show', () => win.show())
  // Zoom escolhido pela pessoa (Ctrl + / Ctrl - / Ctrl 0) volta a cada abertura.
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(settings.zoom))
  // Guarda palavra errada e sugestões do corretor para o menu do editor.
  win.webContents.on('context-menu', (_event, params) => recordContextParams(params))

  // Links externos abrem no navegador padrão; nunca dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  // F11 alterna tela cheia; F12 abre as ferramentas de desenvolvedor (só em desenvolvimento).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F11') {
      event.preventDefault()
      win.setFullScreen(!win.isFullScreen())
    } else if (input.key === 'F12' && !app.isPackaged) {
      win.webContents.toggleDevTools()
    }
  })
  // Avisa a interface para esconder o espaço dos botões de janela em tela cheia.
  win.on('enter-full-screen', () => win.webContents.send(IPC.windowFullscreen, true))
  win.on('leave-full-screen', () => win.webContents.send(IPC.windowFullscreen, false))
  // Troca o ícone de maximizar/restaurar na barra do app.
  win.on('maximize', () => win.webContents.send(IPC.windowMaximized, true))
  win.on('unmaximize', () => win.webContents.send(IPC.windowMaximized, false))

  // Antes de fechar, pede à interface que salve a nota aberta.
  // Se ela não responder em 2 s, fecha mesmo assim.
  win.on('close', (event) => {
    if (allowClose) return
    event.preventDefault()
    win.webContents.send(IPC.appBeforeClose)
    setTimeout(() => {
      allowClose = true
      if (!win.isDestroyed()) win.close()
    }, 2000)
  })
  win.on('closed', () => {
    mainWindow = null
    allowClose = false
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

app.on('window-all-closed', () => {
  void watcher.stop()
  if (process.platform !== 'darwin') app.quit()
})

/** `opalite "C:\caminho\do\cofre"` abre aquela pasta diretamente. */
function vaultFromArgs(): string | null {
  const args = process.argv.slice(app.isPackaged ? 1 : 2)
  for (const arg of args) {
    if (arg.startsWith('-')) continue
    try {
      if (existsSync(arg) && statSync(arg).isDirectory()) return path.resolve(arg)
    } catch {
      // argumento não é um caminho
    }
  }
  return null
}
