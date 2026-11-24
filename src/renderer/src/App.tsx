import { useEffect } from 'react'
import { ErrorToast } from './components/ErrorToast'
import { MenuHost } from './components/ui/Menu'
import { Welcome } from './components/Welcome'
import { Workspace } from './components/Workspace'
import { documents } from './editor/document-manager'
import { setLinkHandlers } from './editor/links'
import { flushAll, setNoticeSink } from './lib/flushers'
import { setPreviewHandlers } from './editor/rich-preview'
import { blobUrl, findFile } from './lib/attachments'
import { useIndex } from './state/index-store'
import { useVault } from './state/vault-store'
import { useWorkspace } from './state/workspace-store'

// Avisos vindos de fora do React aparecem no mesmo toast do app.
setNoticeSink((message, kind) => useVault.setState(kind === 'error' ? { error: message } : { notice: message }))

// O editor chama estas funções ao clicar em [[links]] e #tags.
setLinkHandlers({
  // Notas pelo índice; anexos (PDF, imagens…) pela árvore, para o link não aparecer como quebrado.
  resolve: (target) => useIndex.getState().resolver.resolve(target, documents.currentPath) ?? findFile(useVault.getState().tree, target),
  openLink: (target, section, newTab) => void useVault.getState().openLink(target, section, { newTab }),
  openTag: (tag) => {
    if (!useVault.getState().sidebarOpen) useVault.getState().toggleSidebar()
    useWorkspace.getState().search(`tag:${tag}`)
  },
})

// Dados para as bases (tabelas de notas) desenhadas dentro do editor.
setPreviewHandlers({
  notes: () => useIndex.getState().notes,
  version: () => useIndex.getState().version,
  currentPath: () => documents.currentPath,
  openNote: (path) => void useVault.getState().openFile(path),
  resolveFile: (target) => findFile(useVault.getState().tree, target),
  imageUrl: (path) => blobUrl(path),
})

// Testes automatizados: acesso ao editor para posicionar cursor e seleção.
if ((window as { opaliteE2E?: boolean }).opaliteE2E) {
  ;(window as unknown as { __opaliteEditor: () => unknown }).__opaliteEditor = () => documents.editorView
  ;(window as unknown as { __opaliteConvert: unknown }).__opaliteConvert = async (path: string, id: string, option?: string) => {
    const { CONVERSIONS } = await import('./lib/convert/registry')
    const conv = CONVERSIONS.find((c) => c.id === id)!
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const t = performance.now()
    const paths = await conv.run({
      path,
      option,
      signal: { cancelled: false },
      bytes: () => window.opalite.files.readBinary(path),
      progress: () => {},
      save: (name, bytes, sub) => window.opalite.files.importFile(sub ? (dir ? `${dir}/${sub}` : sub) : dir, name, bytes),
    })
    return { paths, ms: Math.round(performance.now() - t) }
  }
}

export function App() {
  const booting = useVault((s) => s.booting)
  const hasVault = useVault((s) => s.vault !== null)

  useEffect(() => {
    void useVault.getState().init().then(() => useIndex.getState().refresh())

    // Mudanças no disco vindas do observador de arquivos (processo principal).
    const offEvents = window.opalite.vault.onEvents((events) => {
      void useVault.getState().handleEvents(events)
    })

    // O índice mudou: atualiza a lista de notas e redesenha os links do editor.
    const offIndex = window.opalite.index.onChanged(() => {
      void useIndex
        .getState()
        .refresh()
        .then(() => documents.refreshLinks())
    })

    // O main pede para salvar antes de fechar a janela.
    const offClose = window.opalite.app.onBeforeClose(() => {
      void flushAll().finally(() => window.opalite.app.closeReady())
    })

    // Ao trocar de janela, salva na hora (sem esperar o debounce).
    const onBlur = () => void flushAll()
    window.addEventListener('blur', onBlur)

    // Tela cheia: some o espaço reservado aos botões da janela.
    const offFullscreen = window.opalite.ui.onFullscreen((on) => document.documentElement.classList.toggle('is-fullscreen', on))

    // Carrega o gráfico e o canvas em segundo plano, assim abrem sem espera.
    const idle = (window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500)))(() => {
      void import('./components/GraphView')
      void import('./components/CanvasView')
    })

    // Botões "voltar"/"avançar" do mouse.
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) void useVault.getState().goBack()
      if (e.button === 4) void useVault.getState().goForward()
    }
    window.addEventListener('mouseup', onMouse)

    return () => {
      offEvents()
      offIndex()
      offClose()
      offFullscreen()
      if (typeof idle === 'number') window.cancelIdleCallback?.(idle)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [])

  if (booting) return null
  return (
    <>
      {hasVault ? <Workspace /> : <Welcome />}
      <ErrorToast />
      <MenuHost />
    </>
  )
}
