import { attachmentsFolder } from '../lib/settings'
import { FileDown, FolderInput, LayoutDashboard, PenLine } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { documents } from '../editor/document-manager'
import { embedFor, importFiles } from '../lib/attachments'
import { parentOf } from '../lib/paths'
import { useVault } from '../state/vault-store'
import styles from './DropLayer.module.css'

/*
 * Arrastar e soltar arquivos do computador para a janela. O destino depende
 * de onde o arquivo é solto:
 * - numa pasta da árvore: copia para aquela pasta;
 * - na nota aberta: copia para "Anexos" e incorpora no ponto onde foi solto;
 * - num canvas: copia para "Anexos" e cria cartões no canvas;
 * - em qualquer outro lugar: copia para "Anexos" e abre o primeiro arquivo.
 * Áreas com tratamento próprio (ex.: o conversor) usam o atributo data-own-drop.
 */

type Target =
  | { type: 'folder'; path: string }
  | { type: 'editor' }
  | { type: 'canvas' }
  | { type: 'vault' }

function hasFiles(e: DragEvent): boolean {
  return Boolean(e.dataTransfer?.types.includes('Files'))
}

function targetAt(x: number, y: number): Target | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  if (!el) return { type: 'vault' }
  if (el.closest('[data-own-drop]')) return null
  // Gerenciador de arquivos: a pasta sob o cursor (cartão) ou a pasta aberta.
  const box = el.closest<HTMLElement>('[data-drop-folder]')
  if (box) return { type: 'folder', path: box.dataset['dropFolder'] ?? '' }
  const row = el.closest<HTMLElement>('[role=treeitem][data-path]')
  if (row) {
    const path = row.dataset['path']!
    return { type: 'folder', path: row.dataset['kind'] === 'folder' ? path : parentOf(path) }
  }
  if (el.closest('[aria-label="Arquivos do cofre"], [data-tree-root]')) return { type: 'folder', path: '' }
  if (el.closest('.cm-editor') && useVault.getState().activePath) return { type: 'editor' }
  if (el.closest('[aria-label=Canvas]')) return { type: 'canvas' }
  return { type: 'vault' }
}

function describe(t: Target): { icon: typeof FileDown; title: string; detail: string } {
  switch (t.type) {
    case 'folder':
      return { icon: FolderInput, title: t.path ? `Soltar em ${t.path}` : 'Soltar na raiz do cofre', detail: 'Os arquivos serão copiados para esta pasta.' }
    case 'editor':
      return { icon: PenLine, title: 'Inserir na nota', detail: `Copiados para "${attachmentsFolder()}" e incorporados aqui.` }
    case 'canvas':
      return { icon: LayoutDashboard, title: 'Adicionar ao canvas', detail: `Copiados para "${attachmentsFolder()}" e colocados como cartões.` }
    default:
      return { icon: FileDown, title: 'Importar para o cofre', detail: `Os arquivos vão para a pasta "${attachmentsFolder()}".` }
  }
}

export function DropLayer() {
  const [target, setTarget] = useState<Target | null>(null)
  const highlighted = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const highlight = (t: Target | null) => {
      highlighted.current?.removeAttribute('data-drop-target')
      highlighted.current = null
      if (t?.type === 'folder' && t.path) {
        const row = document.querySelector<HTMLElement>(`[role=treeitem][data-path="${CSS.escape(t.path)}"]`)
        row?.setAttribute('data-drop-target', 'true')
        highlighted.current = row
      }
    }

    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      const t = targetAt(e.clientX, e.clientY)
      if (!t) {
        setTarget(null)
        highlight(null)
        return
      }
      // Sem preventDefault o navegador abriria o arquivo na janela.
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer!.dropEffect = 'copy'
      setTarget((prev) => (JSON.stringify(prev) === JSON.stringify(t) ? prev : t))
      highlight(t)
    }
    const onLeave = (e: DragEvent) => {
      // Saiu da janela (relatedTarget nulo).
      if (!e.relatedTarget) {
        setTarget(null)
        highlight(null)
      }
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      const t = targetAt(e.clientX, e.clientY)
      setTarget(null)
      highlight(null)
      if (!t) return
      e.preventDefault()
      e.stopPropagation()
      void handleDrop(t, [...e.dataTransfer!.files], e.clientX, e.clientY)
    }

    window.addEventListener('dragover', onOver, true)
    window.addEventListener('dragleave', onLeave, true)
    window.addEventListener('drop', onDrop, true)
    return () => {
      window.removeEventListener('dragover', onOver, true)
      window.removeEventListener('dragleave', onLeave, true)
      window.removeEventListener('drop', onDrop, true)
    }
  }, [])

  if (!target) return null
  const { icon: Icon, title, detail } = describe(target)
  return (
    <div className={styles.overlay} data-target={target.type} aria-live="polite">
      <div className={styles.card}>
        <Icon size={22} strokeWidth={1.6} />
        <div>
          <strong>{title}</strong>
          <span>{detail}</span>
        </div>
      </div>
    </div>
  )
}

async function handleDrop(target: Target, files: File[], x: number, y: number): Promise<void> {
  if (files.length === 0) return
  const store = useVault.getState()
  const dir = target.type === 'folder' ? target.path : attachmentsFolder()
  // Posição no editor calculada antes de importar (a nota pode rolar depois).
  const view = target.type === 'editor' ? documents.editorView : null
  const pos = view?.posAtCoords({ x, y }) ?? view?.state.selection.main.head ?? null

  const { paths, errors } = await importFiles(files, dir)
  await store.refreshTree()
  if (errors.length) store.dismissError()
  if (errors.length) useVault.setState({ error: `Não foi possível importar: ${errors.join('; ')}` })
  if (paths.length === 0) return

  if (target.type === 'editor' && view && pos !== null) {
    const line = view.state.doc.lineAt(pos)
    const prefix = line.text.trim() ? '\n' : ''
    const text = prefix + paths.map(embedFor).join('\n')
    const at = line.text.trim() ? line.to : pos
    view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: 'input.drop', scrollIntoView: true })
    view.focus()
  } else if (target.type === 'canvas') {
    window.dispatchEvent(new CustomEvent('opalite:canvas-drop', { detail: { paths, x, y } }))
  } else if (target.type === 'vault') {
    await store.openFile(paths[0]!, { newTab: true })
  } else if (target.type === 'folder' && target.path) {
    useVault.setState((s) => ({ expanded: { ...s.expanded, [target.path]: true } }))
  }
  if (!errors.length) store.notify(paths.length === 1 ? `"${paths[0]!.slice(paths[0]!.lastIndexOf('/') + 1)}" importado` : `${paths.length} arquivos importados`)
}
