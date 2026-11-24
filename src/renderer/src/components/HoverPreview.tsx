import { ArrowUpRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { documents } from '../editor/document-manager'
import { blobUrl, findFile, kindOf } from '../lib/attachments'
import { renderMiniMarkdown } from '../lib/mini-markdown'
import { useIndex } from '../state/index-store'
import { useVault } from '../state/vault-store'
import styles from './HoverPreview.module.css'

/*
 * Prévia ao passar o mouse sobre um [[link]] (no editor, no canvas e na
 * própria prévia): depois de uma pausa curta, mostra o começo da nota ou a
 * imagem, sem sair de onde se está. Clicar no título abre.
 */

type Preview = { path: string; title: string; x: number; y: number; html?: string; image?: string; missing?: boolean; section?: string | null }

const DELAY = 380
const MAX_CHARS = 2400

function stripFrontmatter(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '')
}

/** Recorta a partir de um título "# Seção", quando o link aponta para ela. */
function fromSection(text: string, section: string | null | undefined): string {
  if (!section) return text
  const lines = text.split('\n')
  const at = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.replace(/^#+\s*/, '').trim().toLowerCase() === section.toLowerCase())
  return at >= 0 ? lines.slice(at).join('\n') : text
}

export function HoverPreview() {
  const [preview, setPreview] = useState<Preview | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const current = useRef<Element | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const clear = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    }
    const scheduleHide = () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => {
        current.current = null
        setPreview(null)
      }, 220)
    }

    const onOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (cardRef.current?.contains(target)) {
        if (hideTimer.current) clearTimeout(hideTimer.current)
        return
      }
      const el = target.closest<HTMLElement>('[data-link-target], a[data-link]')
      if (!el) {
        clear()
        if (current.current) scheduleHide()
        return
      }
      if (el === current.current) {
        if (hideTimer.current) clearTimeout(hideTimer.current)
        return
      }
      clear()
      current.current = el
      const raw = el.dataset['linkTarget'] ?? el.dataset['link'] ?? ''
      const [linkTarget, hashSection] = raw.split('#')
      const section = el.dataset['linkSection'] || hashSection || null
      if (!linkTarget) return
      timer.current = setTimeout(() => void show(el, linkTarget.trim(), section), DELAY)
    }

    const show = async (el: HTMLElement, linkTarget: string, section: string | null) => {
      if (current.current !== el || !el.isConnected) return
      const rect = el.getBoundingClientRect()
      const pos = { x: rect.left, y: rect.bottom + 6 }
      const resolved = useIndex.getState().resolver.resolve(linkTarget, documents.currentPath) ?? findFile(useVault.getState().tree, linkTarget)
      if (!resolved) {
        setPreview({ path: '', title: linkTarget, missing: true, ...pos })
        return
      }
      const title = resolved.slice(resolved.lastIndexOf('/') + 1).replace(/\.md$/i, '')
      try {
        if (resolved.toLowerCase().endsWith('.md')) {
          const { content } = await window.opalite.files.read(resolved)
          if (current.current !== el) return
          const body = fromSection(stripFrontmatter(content), section).slice(0, MAX_CHARS)
          setPreview({ path: resolved, title, html: renderMiniMarkdown(body), section, ...pos })
        } else if (kindOf(resolved) === 'image') {
          const url = await blobUrl(resolved)
          if (current.current !== el) return
          setPreview({ path: resolved, title, image: url, ...pos })
        } else {
          setPreview({ path: resolved, title, html: '<p class="hint">Clique no título para abrir este arquivo.</p>', ...pos })
        }
      } catch {
        // arquivo sumiu entre a resolução e a leitura
      }
    }

    const onDown = (e: MouseEvent) => {
      if (cardRef.current?.contains(e.target as Node)) return
      clear()
      current.current = null
      setPreview(null)
    }

    document.addEventListener('mouseover', onOver)
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onDown as unknown as EventListener, true)
    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onDown as unknown as EventListener, true)
      clear()
    }
  }, [])

  // Mantém o cartão dentro da janela.
  const style: React.CSSProperties | undefined = preview
    ? {
        left: Math.max(12, Math.min(preview.x, window.innerWidth - 452)),
        top: preview.y + 340 > window.innerHeight ? Math.max(12, preview.y - 360) : preview.y,
      }
    : undefined

  if (!preview) return null
  return (
    <div ref={cardRef} className={styles.card} style={style} role="tooltip" onMouseLeave={() => setPreview(null)}>
      <header className={styles.header}>
        {preview.missing ? (
          <span className={styles.title}>{preview.title}</span>
        ) : (
          <button
            className={styles.title}
            onClick={(e) => {
              void useVault.getState().openFile(preview.path, { newTab: e.ctrlKey || e.metaKey })
              setPreview(null)
            }}
            title="Abrir"
          >
            {preview.title}
            {preview.section ? <span className={styles.section}> › {preview.section}</span> : null}
            <ArrowUpRight size={13} />
          </button>
        )}
      </header>
      {preview.missing ? (
        <p className={styles.missing}>Esta nota ainda não existe. Clique no link para criá-la.</p>
      ) : preview.image ? (
        <img className={styles.image} src={preview.image} alt={preview.title} />
      ) : (
        <div className={styles.body} dangerouslySetInnerHTML={{ __html: preview.html ?? '' }} />
      )}
    </div>
  )
}
