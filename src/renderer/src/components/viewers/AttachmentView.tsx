import { ExternalLink, File, FileOutput, FolderOpen, Maximize, Minus, Plus } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { blobUrl, extOf, fileName, kindOf } from '../../lib/attachments'
import { sanitizeHtml } from '../../lib/sanitize'
import { useVault } from '../../state/vault-store'
import { useWorkspace } from '../../state/workspace-store'
import styles from './AttachmentView.module.css'

const PdfViewer = lazy(() => import('./PdfViewer'))
const DocumentEditor = lazy(() => import('../office/DocumentEditor'))
const SpreadsheetEditor = lazy(() => import('../office/SpreadsheetEditor'))
const PresentationEditor = lazy(() => import('../office/PresentationEditor'))

/** Escolhe o visualizador pelo tipo do arquivo. */
export default function AttachmentView({ path }: { path: string }) {
  const kind = kindOf(path)
  if (kind === 'pdf') {
    return (
      <Suspense fallback={null}>
        <PdfViewer path={path} />
      </Suspense>
    )
  }
  // Documentos de escritório abrem nos editores próprios do Opalite.
  const ext = extOf(path)
  const Editor = ext === 'docx' ? DocumentEditor : ext === 'xlsx' || ext === 'csv' ? SpreadsheetEditor : ext === 'pptx' ? PresentationEditor : null
  if (Editor) {
    return (
      <Suspense fallback={null}>
        <Editor path={path} />
      </Suspense>
    )
  }
  if (kind === 'docx') return <DocxViewer path={path} />
  if (kind === 'image') return <ImageViewer path={path} />
  return <FileInfo path={path} />
}

function Toolbar({ children, path }: { children?: React.ReactNode; path: string }) {
  return (
    <div className={styles.toolbar}>
      <span className={styles.name}>{fileName(path)}</span>
      <div className={styles.actions}>
        {children}
        <button onClick={() => void useVault.getState().reveal(path)} title="Mostrar no explorador de arquivos" aria-label="Mostrar no explorador de arquivos">
          <FolderOpen size={14} strokeWidth={1.75} />
        </button>
        <button onClick={() => void window.opalite.files.openExternal(path)} title="Abrir no aplicativo padrão" aria-label="Abrir no aplicativo padrão">
          <ExternalLink size={14} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------ DOCX

function DocxViewer({ path }: { path: string }) {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    let alive = true
    setHtml(null)
    window.opalite.convert
      .docxToHtml(path)
      .then((r) => alive && setHtml(sanitizeHtml(r.html) || '<p><em>Documento vazio.</em></p>'))
      .catch((err: Error) => alive && setError(err.message))
    return () => {
      alive = false
    }
  }, [path])

  return (
    <div className={styles.viewer}>
      <Toolbar path={path}>
        <ZoomButtons zoom={zoom} setZoom={setZoom} />
        <span className={styles.sep} />
        <button className={styles.wide} onClick={() => useWorkspace.getState().openConverter(path)} title="Converter este documento para PDF">
          <FileOutput size={14} strokeWidth={1.75} /> <span className={styles.wideLabel}>Converter para PDF</span>
        </button>
      </Toolbar>
      <div className={styles.desk}>
        {error && <p className={styles.message}>Não foi possível ler o documento: {error}</p>}
        {!error && html === null && <p className={styles.message}>Abrindo documento…</p>}
        {html !== null && (
          <article
            className={styles.paper}
            style={{ zoom }}
            // HTML gerado pelo mammoth no processo principal (sem scripts nem links "javascript:").
            dangerouslySetInnerHTML={{ __html: html }}
            onClick={(e) => {
              const a = (e.target as HTMLElement).closest('a')
              if (!a) return
              e.preventDefault()
              const href = a.getAttribute('href') ?? ''
              if (/^https?:\/\//i.test(href)) window.open(href, '_blank')
            }}
          />
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------ imagens

function ImageViewer({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [zoom, setZoom] = useState<number | null>(null) // null = ajustar à tela
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const deskRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let alive = true
    void blobUrl(path).then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
  }, [path])

  return (
    <div className={styles.viewer}>
      <Toolbar path={path}>
        {size && (
          <span className={styles.meta}>
            {size.w} × {size.h} · {extOf(path).toUpperCase()}
          </span>
        )}
        <ZoomButtons zoom={zoom ?? 1} setZoom={(z) => setZoom(typeof z === 'function' ? z(zoom ?? 1) : z)} />
        <button onClick={() => setZoom(null)} title="Ajustar à tela" aria-label="Ajustar à tela">
          <Maximize size={14} strokeWidth={1.75} />
        </button>
      </Toolbar>
      <div
        ref={deskRef}
        className={styles.imageDesk}
        data-fit={zoom === null || undefined}
        onWheel={(e) => {
          if (!e.ctrlKey) return
          setZoom((z) => Math.min(8, Math.max(0.1, (z ?? 1) * Math.exp(-e.deltaY * 0.002))))
        }}
      >
        {url && (
          <img
            src={url}
            alt={fileName(path)}
            className={styles.image}
            style={zoom !== null && size ? { width: size.w * zoom, height: size.h * zoom } : undefined}
            onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            draggable={false}
          />
        )}
      </div>
    </div>
  )
}

function ZoomButtons({ zoom, setZoom }: { zoom: number; setZoom: React.Dispatch<React.SetStateAction<number>> }) {
  return (
    <>
      <button onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.1).toFixed(2)))} aria-label="Diminuir zoom">
        <Minus size={15} strokeWidth={1.75} />
      </button>
      <button className={styles.zoomLabel} onClick={() => setZoom(1)} title="Tamanho real">
        {Math.round(zoom * 100)}%
      </button>
      <button onClick={() => setZoom((z) => Math.min(4, +(z + 0.1).toFixed(2)))} aria-label="Aumentar zoom">
        <Plus size={15} strokeWidth={1.75} />
      </button>
    </>
  )
}

// ------------------------------------------------------------ outros

function FileInfo({ path }: { path: string }) {
  const ext = extOf(path).toUpperCase() || 'ARQUIVO'
  return (
    <div className={styles.viewer}>
      <Toolbar path={path} />
      <div className={styles.info}>
        <div className={styles.fileBadge}>
          <File size={40} strokeWidth={1.25} />
          <span>{ext}</span>
        </div>
        <h2>{fileName(path)}</h2>
        <p>O Opalite ainda não exibe este tipo de arquivo, mas ele fica guardado no cofre e pode ser citado nas notas.</p>
        <div className={styles.infoActions}>
          <button className={styles.primary} onClick={() => void window.opalite.files.openExternal(path)}>
            <ExternalLink size={15} strokeWidth={1.75} /> Abrir no aplicativo padrão
          </button>
          <button onClick={() => void useVault.getState().reveal(path)}>
            <FolderOpen size={15} strokeWidth={1.75} /> Mostrar no explorador
          </button>
        </div>
      </div>
    </div>
  )
}
