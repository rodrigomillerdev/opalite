import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Plus,
  Redo2,
  RemoveFormatting,
  Scissors,
  Clipboard,
  Copy,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  Trash2,
  TriangleAlert,
  Underline,
  Undo2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { sanitizeRichHtml } from '../../lib/sanitize'
import { type MenuItem, openMenu } from '../ui/Menu'
import styles from './DocumentEditor.module.css'
import { OfficeShell, ColorButton, Divider, ToolButton } from './OfficeShell'
import { useOfficeFile } from './useOfficeFile'

/*
 * Editor de documentos de texto (.docx). A página é um elemento editável com
 * aparência de folha A4; a formatação usa os comandos de edição do próprio
 * navegador (desfazer/refazer nativos). Ao salvar, o HTML vira .docx.
 */

const FONTS = ['Calibri', 'Arial', 'Georgia', 'Times New Roman', 'Verdana', 'Garamond', 'Courier New']
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72]
const STYLES: Array<[string, string]> = [
  ['P', 'Texto normal'],
  ['H1', 'Título 1'],
  ['H2', 'Título 2'],
  ['H3', 'Título 3'],
  ['BLOCKQUOTE', 'Citação'],
  ['PRE', 'Código'],
]

interface Loaded {
  html: string
  /** true quando veio da conversão (documento criado em outro programa). */
  compat: boolean
}

const exec = (cmd: string, value?: string) => document.execCommand(cmd, false, value)

export default function DocumentEditor({ path }: { path: string }) {
  const pageRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [compatOpen, setCompatOpen] = useState(true)
  const [counts, setCounts] = useState({ words: 0, chars: 0, pages: 1 })
  const [active, setActive] = useState<Record<string, boolean | string>>({})
  const [linkAsk, setLinkAsk] = useState<{ value: string; range: Range | null } | null>(null)
  const [tablePick, setTablePick] = useState<{ x: number; y: number } | null>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)

  const file = useOfficeFile<Loaded>({
    path,
    load: async (bytes) => {
      const { embeddedSource } = await import('../../lib/office/docx-html')
      const own = embeddedSource(bytes)
      if (own !== null) return { html: sanitizeRichHtml(own), compat: false }
      const { html } = await window.opalite.convert.docxToHtml(path)
      return { html: sanitizeRichHtml(html), compat: true }
    },
    save: async (m) => {
      const { htmlToDocx } = await import('../../lib/office/docx-html')
      return htmlToDocx(m.html, { title: path.slice(path.lastIndexOf('/') + 1).replace(/\.docx$/i, '') })
    },
  })

  // Conteúdo entra uma vez ao carregar (depois o DOM é a fonte da verdade).
  useLayoutEffect(() => {
    const page = pageRef.current
    if (!page || !file.model) return
    page.innerHTML = file.model.html || '<p><br></p>'
    exec('styleWithCSS', 'true')
    exec('defaultParagraphSeparator', 'p')
    updateCounts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.model])

  const updateCounts = useCallback(() => {
    const page = pageRef.current
    if (!page) return
    const text = page.innerText
    const words = text.trim() ? text.trim().split(/\s+/).length : 0
    // A4 com margens: ~ 970 px úteis de altura por página no zoom 100%.
    setCounts({ words, chars: text.replace(/\n/g, '').length, pages: Math.max(1, Math.ceil(page.scrollHeight / 1123)) })
  }, [])

  const changed = useCallback(() => {
    const page = pageRef.current
    if (!page || !file.current.current) return
    file.change({ html: page.innerHTML, compat: file.current.current.compat })
    updateCounts()
  }, [file, updateCounts])

  // Estado dos botões (negrito ativo, alinhamento...) acompanha a seleção.
  useEffect(() => {
    const onSel = () => {
      const page = pageRef.current
      const sel = window.getSelection()
      if (!page || !sel?.anchorNode || !page.contains(sel.anchorNode)) return
      const block = (sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement)?.closest('p,h1,h2,h3,h4,blockquote,pre,li,td,div')
      setActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strike: document.queryCommandState('strikeThrough'),
        sub: document.queryCommandState('subscript'),
        sup: document.queryCommandState('superscript'),
        ul: document.queryCommandState('insertUnorderedList'),
        ol: document.queryCommandState('insertOrderedList'),
        left: document.queryCommandState('justifyLeft'),
        center: document.queryCommandState('justifyCenter'),
        right: document.queryCommandState('justifyRight'),
        justify: document.queryCommandState('justifyFull'),
        block: block && block !== page ? block.tagName : 'P',
        font: (document.queryCommandValue('fontName') || 'Calibri').replace(/["']/g, '').split(',')[0]!,
        size: String(Math.round(parseFloat(getComputedStyle(block ?? page).fontSize) * 0.75)),
      })
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [])

  const run = (cmd: string, value?: string) => {
    pageRef.current?.focus()
    exec(cmd, value)
    changed()
  }

  /** Tamanho da fonte em pt (execCommand só conhece 1–7; trocamos o resultado). */
  const setSize = (pt: number) => {
    pageRef.current?.focus()
    exec('fontSize', '7')
    for (const el of pageRef.current!.querySelectorAll<HTMLElement>('span[style*="xxx-large"], font[size="7"]')) {
      if (el.tagName === 'FONT') {
        const span = document.createElement('span')
        span.style.fontSize = `${pt}pt`
        span.append(...el.childNodes)
        el.replaceWith(span)
      } else el.style.fontSize = `${pt}pt`
    }
    changed()
  }

  const insertHtml = (html: string) => {
    pageRef.current?.focus()
    exec('insertHTML', html)
    changed()
  }

  const insertImage = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp'
    input.onchange = () => {
      const f = input.files?.[0]
      if (!f) return
      const reader = new FileReader()
      reader.onload = () => {
        const probe = new Image()
        probe.onload = () => {
          const w = Math.min(probe.naturalWidth, 604)
          const h = Math.round((probe.naturalHeight * w) / probe.naturalWidth)
          insertHtml(`<img src="${reader.result as string}" width="${w}" height="${h}" alt="">`)
        }
        probe.src = reader.result as string
      }
      reader.readAsDataURL(f)
    }
    input.click()
  }

  const insertTable = (rows: number, cols: number) => {
    const cells = Array.from({ length: cols }, () => '<td><br></td>').join('')
    insertHtml(`<table><tbody>${Array.from({ length: rows }, () => `<tr>${cells}</tr>`).join('')}</tbody></table><p><br></p>`)
    setTablePick(null)
  }

  const askLink = () => {
    const sel = window.getSelection()
    const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null
    const existing = (sel?.anchorNode?.parentElement?.closest('a') as HTMLAnchorElement | null)?.getAttribute('href') ?? 'https://'
    setLinkAsk({ value: existing, range })
  }

  const applyLink = () => {
    if (!linkAsk) return
    const url = linkAsk.value.trim()
    const sel = window.getSelection()
    pageRef.current?.focus()
    if (linkAsk.range && sel) {
      sel.removeAllRanges()
      sel.addRange(linkAsk.range)
    }
    if (!url || url === 'https://') exec('unlink')
    else if (/^(https?:|mailto:)/i.test(url)) {
      if (sel?.isCollapsed) exec('insertHTML', `<a href="${url.replace(/"/g, '%22')}">${url.replace(/</g, '&lt;')}</a>`)
      else exec('createLink', url)
    }
    setLinkAsk(null)
    changed()
  }

  // ------------------------------------------------------------ tabelas e menu

  const tableOp = (cell: HTMLTableCellElement, op: string) => {
    const row = cell.parentElement as HTMLTableRowElement
    const table = cell.closest('table')!
    const ci = cell.cellIndex
    if (op === 'row-above' || op === 'row-below') {
      const clone = row.cloneNode(true) as HTMLTableRowElement
      for (const c of clone.cells) c.innerHTML = '<br>'
      row.parentElement!.insertBefore(clone, op === 'row-above' ? row : row.nextSibling)
    } else if (op === 'col-left' || op === 'col-right') {
      for (const r of table.rows) {
        const ref = r.cells[ci]
        const td = document.createElement(ref?.tagName === 'TH' ? 'th' : 'td')
        td.innerHTML = '<br>'
        r.insertBefore(td, op === 'col-left' ? (ref ?? null) : (ref?.nextSibling ?? null))
      }
    } else if (op === 'del-row') {
      if (table.rows.length <= 1) table.remove()
      else row.remove()
    } else if (op === 'del-col') {
      if ((table.rows[0]?.cells.length ?? 0) <= 1) table.remove()
      else for (const r of table.rows) r.cells[ci]?.remove()
    } else if (op === 'del-table') table.remove()
    changed()
  }

  const onContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault()
    const cell = (e.target as HTMLElement).closest('td,th') as HTMLTableCellElement | null
    const hasSel = !window.getSelection()?.isCollapsed
    const items: MenuItem[] = [
      { id: 'cut', label: 'Recortar', icon: Scissors, shortcut: 'Ctrl+X', disabled: !hasSel },
      { id: 'copy', label: 'Copiar', icon: Copy, shortcut: 'Ctrl+C', disabled: !hasSel },
      { id: 'paste', label: 'Colar', icon: Clipboard, shortcut: 'Ctrl+V' },
      { type: 'separator' },
      { id: 'bold', label: 'Negrito', icon: Bold, shortcut: 'Ctrl+B' },
      { id: 'italic', label: 'Itálico', icon: Italic, shortcut: 'Ctrl+I' },
      { id: 'link', label: 'Inserir link…', icon: Link2, shortcut: 'Ctrl+K' },
      { id: 'clear', label: 'Limpar formatação', icon: RemoveFormatting },
      ...(cell
        ? ([
            { type: 'separator' },
            {
              label: 'Tabela',
              icon: Table,
              submenu: [
                { id: 'row-above', label: 'Inserir linha acima' },
                { id: 'row-below', label: 'Inserir linha abaixo' },
                { id: 'col-left', label: 'Inserir coluna à esquerda' },
                { id: 'col-right', label: 'Inserir coluna à direita' },
                { type: 'separator' },
                { id: 'del-row', label: 'Excluir linha', danger: true },
                { id: 'del-col', label: 'Excluir coluna', danger: true },
                { id: 'del-table', label: 'Excluir tabela', icon: Trash2, danger: true },
              ],
            },
          ] as MenuItem[])
        : []),
    ]
    const id = await openMenu(items, { x: e.clientX, y: e.clientY })
    if (!id) return
    pageRef.current?.focus()
    if (id === 'cut' || id === 'copy') exec(id)
    else if (id === 'paste') {
      const text = await navigator.clipboard.readText().catch(() => '')
      if (text) exec('insertText', text)
    } else if (id === 'bold' || id === 'italic') exec(id)
    else if (id === 'link') askLink()
    else if (id === 'clear') exec('removeFormat')
    else if (cell) tableOp(cell, id)
    changed()
  }

  const onPaste = (e: React.ClipboardEvent) => {
    const dt = e.clipboardData
    const img = [...dt.files].find((f) => f.type.startsWith('image/'))
    if (img) {
      e.preventDefault()
      const reader = new FileReader()
      reader.onload = () => insertHtml(`<img src="${reader.result as string}" alt="">`)
      reader.readAsDataURL(img)
      return
    }
    const html = dt.getData('text/html')
    if (html) {
      e.preventDefault()
      insertHtml(sanitizeRichHtml(html))
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      askLink()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const inList = window.getSelection()?.anchorNode?.parentElement?.closest('li')
      if (inList) run(e.shiftKey ? 'outdent' : 'indent')
      else if (!e.shiftKey) run('insertText', '    ')
    }
  }

  const onClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement
    setImage(t.tagName === 'IMG' ? (t as HTMLImageElement) : null)
  }

  if (file.error) return <div className={styles.error}>Não foi possível abrir o documento: {file.error}</div>

  return (
    <OfficeShell
      path={path}
      state={file.state}
      loading={!file.model}
      toolbar={
        <>
          <ToolButton icon={Undo2} label="Desfazer (Ctrl+Z)" onClick={() => run('undo')} />
          <ToolButton icon={Redo2} label="Refazer (Ctrl+Y)" onClick={() => run('redo')} />
          <Divider />
          <select
            className={styles.select}
            value={String(active['block'] ?? 'P')}
            onChange={(e) => run('formatBlock', e.target.value)}
            aria-label="Estilo do parágrafo"
          >
            {STYLES.map(([tag, label]) => (
              <option key={tag} value={tag}>
                {label}
              </option>
            ))}
          </select>
          <select className={styles.select} value={String(active['font'] ?? 'Calibri')} onChange={(e) => run('fontName', e.target.value)} aria-label="Fonte" style={{ width: 128 }}>
            {[...new Set([String(active['font'] ?? 'Calibri'), ...FONTS])].map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f}
              </option>
            ))}
          </select>
          <select className={styles.select} value={String(active['size'] ?? '11')} onChange={(e) => setSize(Number(e.target.value))} aria-label="Tamanho da fonte" style={{ width: 62 }}>
            {[...new Set([String(active['size'] ?? '11'), ...SIZES.map(String)])].sort((a, b) => Number(a) - Number(b)).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Divider />
          <ToolButton icon={Bold} label="Negrito (Ctrl+B)" on={Boolean(active['bold'])} onClick={() => run('bold')} />
          <ToolButton icon={Italic} label="Itálico (Ctrl+I)" on={Boolean(active['italic'])} onClick={() => run('italic')} />
          <ToolButton icon={Underline} label="Sublinhado (Ctrl+U)" on={Boolean(active['underline'])} onClick={() => run('underline')} />
          <ToolButton icon={Strikethrough} label="Tachado" on={Boolean(active['strike'])} onClick={() => run('strikeThrough')} />
          <ToolButton icon={Subscript} label="Subscrito" on={Boolean(active['sub'])} onClick={() => run('subscript')} />
          <ToolButton icon={Superscript} label="Sobrescrito" on={Boolean(active['sup'])} onClick={() => run('superscript')} />
          <ColorButton icon={Baseline} label="Cor do texto" initial="#c0392b" onPick={(c) => run('foreColor', c)} />
          <ColorButton icon={Highlighter} label="Realce" initial="#fff176" onPick={(c) => run('hiliteColor', c)} />
          <Divider />
          <ToolButton icon={AlignLeft} label="Alinhar à esquerda" on={Boolean(active['left'])} onClick={() => run('justifyLeft')} />
          <ToolButton icon={AlignCenter} label="Centralizar" on={Boolean(active['center'])} onClick={() => run('justifyCenter')} />
          <ToolButton icon={AlignRight} label="Alinhar à direita" on={Boolean(active['right'])} onClick={() => run('justifyRight')} />
          <ToolButton icon={AlignJustify} label="Justificar" on={Boolean(active['justify'])} onClick={() => run('justifyFull')} />
          <Divider />
          <ToolButton icon={List} label="Lista com marcadores" on={Boolean(active['ul'])} onClick={() => run('insertUnorderedList')} />
          <ToolButton icon={ListOrdered} label="Lista numerada" on={Boolean(active['ol'])} onClick={() => run('insertOrderedList')} />
          <ToolButton icon={IndentDecrease} label="Diminuir recuo" onClick={() => run('outdent')} />
          <ToolButton icon={IndentIncrease} label="Aumentar recuo" onClick={() => run('indent')} />
          <Divider />
          <ToolButton icon={Link2} label="Link (Ctrl+K)" onClick={askLink} />
          <ToolButton icon={ImagePlus} label="Imagem" onClick={insertImage} />
          <ToolButton
            icon={Table}
            label="Tabela"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setTablePick({ x: r.left, y: r.bottom + 6 })
            }}
          />
          <ToolButton icon={Minus} label="Linha horizontal" onClick={() => run('insertHorizontalRule')} />
          <ToolButton icon={RemoveFormatting} label="Limpar formatação" onClick={() => run('removeFormat')} />
        </>
      }
      status={
        <>
          <span>
            {counts.pages} {counts.pages === 1 ? 'página' : 'páginas'}
          </span>
          <span>{counts.words.toLocaleString('pt-BR')} palavras</span>
          <span>{counts.chars.toLocaleString('pt-BR')} caracteres</span>
          <span className={styles.zoom}>
            <button onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))} aria-label="Diminuir zoom">
              <Minus size={12} />
            </button>
            <button onClick={() => setZoom(1)} title="Voltar a 100%">
              {Math.round(zoom * 100)}%
            </button>
            <button onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 10) / 10))} aria-label="Aumentar zoom">
              <Plus size={12} />
            </button>
          </span>
        </>
      }
    >
      {file.model?.compat && compatOpen && (
        <div className={styles.compat} role="status">
          <TriangleAlert size={15} />
          <span>
            Documento criado em outro programa. Texto, títulos, listas, tabelas e imagens são mantidos; cabeçalhos, rodapés e estilos avançados podem se perder ao salvar. A versão original fica no histórico.
          </span>
          <button onClick={() => setCompatOpen(false)} aria-label="Fechar aviso">
            <X size={14} />
          </button>
        </div>
      )}
      <div className={styles.desk} onMouseDown={(e) => e.target === e.currentTarget && setImage(null)}>
        <div className={styles.paperWrap} style={{ zoom }}>
          <div
            ref={pageRef}
            className={styles.paper}
            contentEditable
            suppressContentEditableWarning
            spellCheck
            lang="pt-BR"
            role="textbox"
            aria-multiline="true"
            aria-label="Documento"
            onInput={changed}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
            onClick={onClick}
            onContextMenu={(e) => void onContextMenu(e)}
          />
          {image && pageRef.current?.contains(image) && <ImageHandles img={image} zoom={zoom} onDone={changed} />}
        </div>
      </div>

      {tablePick && <TablePicker at={tablePick} onPick={insertTable} onClose={() => setTablePick(null)} />}
      {linkAsk && (
        <div className={styles.popover} role="dialog" aria-label="Inserir link">
          <Link2 size={15} />
          <input
            autoFocus
            value={linkAsk.value}
            onChange={(e) => setLinkAsk({ ...linkAsk, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyLink()
              if (e.key === 'Escape') setLinkAsk(null)
            }}
            placeholder="https://"
            spellCheck={false}
          />
          <button onClick={applyLink}>Aplicar</button>
          <button onClick={() => setLinkAsk(null)} aria-label="Cancelar">
            <X size={14} />
          </button>
        </div>
      )}
    </OfficeShell>
  )
}

/** Escolha do tamanho da tabela passando o mouse numa grade 8×8. */
function TablePicker({ at, onPick, onClose }: { at: { x: number; y: number }; onPick(r: number, c: number): void; onClose(): void }) {
  const [hover, setHover] = useState({ r: 2, c: 3 })
  useEffect(() => {
    const close = (e: MouseEvent) => !(e.target as HTMLElement).closest(`.${styles.tablePicker}`) && onClose()
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [onClose])
  return (
    <div className={styles.tablePicker} style={{ left: at.x, top: at.y }} role="dialog" aria-label="Tamanho da tabela">
      <div className={styles.tableGrid}>
        {Array.from({ length: 64 }, (_, i) => {
          const r = Math.floor(i / 8) + 1
          const c = (i % 8) + 1
          return <button key={i} data-on={(r <= hover.r && c <= hover.c) || undefined} onMouseEnter={() => setHover({ r, c })} onClick={() => onPick(r, c)} aria-label={`${r} × ${c}`} />
        })}
      </div>
      <span>
        {hover.r} × {hover.c}
      </span>
    </div>
  )
}

/** Alça para redimensionar a imagem selecionada (mantém a proporção). */
function ImageHandles({ img, zoom, onDone }: { img: HTMLImageElement; zoom: number; onDone(): void }) {
  const [box, setBox] = useState(() => ({ x: img.offsetLeft, y: img.offsetTop, w: img.offsetWidth, h: img.offsetHeight }))
  useEffect(() => {
    const update = () => setBox({ x: img.offsetLeft, y: img.offsetTop, w: img.offsetWidth, h: img.offsetHeight })
    const ro = new ResizeObserver(update)
    ro.observe(img)
    return () => ro.disconnect()
  }, [img])
  const start = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const sx = e.clientX
    const w0 = img.offsetWidth
    const ratio = img.offsetHeight / Math.max(1, img.offsetWidth)
    const move = (ev: PointerEvent) => {
      const w = Math.max(24, Math.min(720, Math.round(w0 + (ev.clientX - sx) / zoom)))
      img.setAttribute('width', String(w))
      img.setAttribute('height', String(Math.round(w * ratio)))
      img.style.width = ''
      img.style.height = ''
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      onDone()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div className={styles.imgBox} style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
      <span className={styles.imgSize}>
        {box.w} × {box.h}
      </span>
      <span className={styles.imgHandle} onPointerDown={start} title="Arraste para redimensionar" />
    </div>
  )
}
