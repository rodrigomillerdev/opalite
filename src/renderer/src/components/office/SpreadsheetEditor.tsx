import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownAZ,
  ArrowUpAZ,
  Baseline,
  Bold,
  Clipboard,
  Copy,
  Eraser,
  Italic,
  PaintBucket,
  Plus,
  Redo2,
  Scissors,
  Sigma,
  Strikethrough,
  Trash2,
  Underline,
  Undo2,
  WrapText,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FormulaError, type Scalar, addr, colName, parseAddr } from '../../lib/office/formula'
import {
  Calc,
  type Cell,
  type CellStyle,
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  type NumFmt,
  type Workbook,
  formatValue,
  key,
  newSheet,
  parseInput,
  shiftFormula,
  usedRange,
} from '../../lib/office/workbook'
import { type MenuItem, openMenu } from '../ui/Menu'
import { ColorButton, Divider, OfficeShell, ToolButton } from './OfficeShell'
import styles from './SpreadsheetEditor.module.css'
import { useOfficeFile } from './useOfficeFile'

/*
 * Editor de planilhas (.xlsx e .csv). A grade é virtualizada: só as células
 * visíveis existem no DOM, então planilhas grandes rolam sem travar. As
 * fórmulas são recalculadas a cada mudança pelo motor próprio (lib/office).
 */

interface Sel {
  c1: number
  r1: number
  c2: number
  r2: number
}

interface Edit {
  value: string
  /** Onde a edição começou: na célula ou na barra de fórmulas. */
  from: 'cell' | 'bar'
}

type Snapshot = { sheet: number; cells: Array<[string, Cell | undefined]> }

const HEADER_W = 46
const HEADER_H = 24
const FORMATS: Array<[NumFmt, string]> = [
  ['general', 'Geral'],
  ['number', 'Número'],
  ['integer', 'Inteiro'],
  ['currency', 'Moeda (R$)'],
  ['percent', 'Porcentagem'],
  ['date', 'Data'],
]

const norm = (s: Sel): Sel => ({ c1: Math.min(s.c1, s.c2), r1: Math.min(s.r1, s.r2), c2: Math.max(s.c1, s.c2), r2: Math.max(s.r1, s.r2) })

/** Primeiro índice cujo início passa de `pos` (posições acumuladas). */
function indexAt(starts: number[], pos: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid]! <= pos) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Texto da célula para edição (fórmula com "=", número com vírgula). */
function rawOf(cell: Cell | undefined): string {
  if (!cell) return ''
  if (cell.f) return `=${cell.f}`
  if (cell.v === null) return ''
  if (typeof cell.v === 'number') {
    if (cell.s?.fmt === 'percent') return `${String(Number((cell.v * 100).toPrecision(12))).replace('.', ',')}%`
    if (cell.s?.fmt === 'date') return formatValue(cell.v, 'date')
    return String(Number(cell.v.toPrecision(15))).replace('.', ',')
  }
  if (typeof cell.v === 'boolean') return cell.v ? 'VERDADEIRO' : 'FALSO'
  return cell.v
}

export default function SpreadsheetEditor({ path }: { path: string }) {
  const isCsv = path.toLowerCase().endsWith('.csv')
  const file = useOfficeFile<Workbook>({
    path,
    load: async (bytes) => {
      const x = await import('../../lib/office/xlsx')
      if (isCsv) return x.readCsv(new TextDecoder().decode(bytes).replace(/^﻿/, ''))
      return x.readXlsx(bytes)
    },
    save: async (wb) => {
      const x = await import('../../lib/office/xlsx')
      if (isCsv) return new TextEncoder().encode(`﻿${x.writeCsv(wb.sheets[0]!, wb)}`)
      return x.writeXlsx(wb)
    },
  })
  const wb = file.model
  const [sheetIdx, setSheetIdx] = useState(0)
  const [sel, setSel] = useState<Sel>({ c1: 0, r1: 0, c2: 0, r2: 0 })
  const [cur, setCur] = useState({ c: 0, r: 0 })
  const [edit, setEdit] = useState<Edit | null>(null)
  const [version, setVersion] = useState(0)
  const [scroll, setScroll] = useState({ top: 0, left: 0, w: 800, h: 600 })
  const [renamingSheet, setRenamingSheet] = useState<number | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const editRef = useRef<HTMLInputElement>(null)
  const barRef = useRef<HTMLInputElement>(null)
  const undo = useRef<Snapshot[]>([])
  const redo = useRef<Snapshot[]>([])
  const clip = useRef<{ text: string; cells: Array<{ dc: number; dr: number; cell: Cell }>; cut: Sel | null } | null>(null)
  const dragging = useRef(false)

  const calc = useMemo(() => (wb ? new Calc(wb) : null), [wb])
  const sheet = wb?.sheets[sheetIdx] ?? wb?.sheets[0]

  // Tamanho da grade: o usado + folga para crescer.
  const dims = useMemo(() => {
    const used = sheet ? usedRange(sheet) : { cols: 0, rows: 0 }
    return { cols: Math.max(26, used.cols + 6, sel.c2 + 6), rows: Math.max(200, used.rows + 60, sel.r2 + 30) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, version, sel.c2, sel.r2])

  const geo = useMemo(() => {
    const colX = [0]
    for (let c = 0; c < dims.cols; c++) colX.push(colX[c]! + (sheet?.cols[c] ?? DEFAULT_COL_WIDTH))
    const rowY = [0]
    for (let r = 0; r < dims.rows; r++) rowY.push(rowY[r]! + (sheet?.rows[r] ?? DEFAULT_ROW_HEIGHT))
    return { colX, rowY }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims, sheet, version])

  useLayoutEffect(() => {
    const el = gridRef.current
    if (!el) return
    const update = () => setScroll({ top: el.scrollTop, left: el.scrollLeft, w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [wb])

  const commitChange = useCallback(() => {
    calc?.invalidate()
    setVersion((v) => v + 1)
    if (wb) file.change(wb)
  }, [calc, wb, file])

  /** Aplica uma alteração guardando o estado anterior para desfazer. */
  const mutate = useCallback(
    (keys: string[], fn: () => void) => {
      if (!sheet) return
      undo.current.push({ sheet: sheetIdx, cells: keys.map((k) => [k, sheet.cells.get(k) ? structuredClone(sheet.cells.get(k)) : undefined]) })
      if (undo.current.length > 200) undo.current.shift()
      redo.current = []
      fn()
      commitChange()
    },
    [sheet, sheetIdx, commitChange],
  )

  const keysOf = (s: Sel) => {
    const n = norm(s)
    const out: string[] = []
    for (let r = n.r1; r <= n.r2; r++) for (let c = n.c1; c <= n.c2; c++) out.push(key(c, r))
    return out
  }

  const restore = (from: React.MutableRefObject<Snapshot[]>, to: React.MutableRefObject<Snapshot[]>) => {
    const snap = from.current.pop()
    if (!snap || !wb) return
    const sh = wb.sheets[snap.sheet]
    if (!sh) return
    to.current.push({ sheet: snap.sheet, cells: snap.cells.map(([k]) => [k, sh.cells.get(k) ? structuredClone(sh.cells.get(k)) : undefined]) })
    for (const [k, cell] of snap.cells) {
      if (cell) sh.cells.set(k, cell)
      else sh.cells.delete(k)
    }
    setSheetIdx(snap.sheet)
    commitChange()
  }

  // ------------------------------------------------------------ edição

  const value = (c: number, r: number): Scalar => (calc ? calc.value(sheetIdx, c, r) : null)

  const startEdit = (initial?: string, from: 'cell' | 'bar' = 'cell') => {
    if (!sheet) return
    // O campo de edição nasce focado (autoFocus), então nenhuma tecla digitada
    // logo em seguida se perde entre a primeira letra e o foco.
    setEdit({ value: initial ?? rawOf(sheet.cells.get(key(cur.c, cur.r))), from })
  }

  const commitEdit = (move: 'down' | 'right' | 'up' | 'left' | 'none' = 'down') => {
    if (!edit || !sheet) return
    const k = key(cur.c, cur.r)
    const old = sheet.cells.get(k)
    const parsed = parseInput(edit.value)
    if (rawOf(old) !== edit.value) {
      mutate([k], () => {
        if (parsed.v === null && !parsed.f && !old?.s) sheet.cells.delete(k)
        else {
          const style: CellStyle | undefined = parsed.fmt && (!old?.s?.fmt || old.s.fmt === 'general') ? { ...old?.s, fmt: parsed.fmt } : old?.s
          const cell: Cell = { v: parsed.v }
          if (parsed.f) cell.f = parsed.f
          if (style && Object.keys(style).length) cell.s = style
          sheet.cells.set(k, cell)
        }
      })
    }
    setEdit(null)
    gridRef.current?.focus()
    moveBy(move === 'down' ? 0 : move === 'right' ? 1 : move === 'left' ? -1 : 0, move === 'down' ? 1 : move === 'up' ? -1 : 0, false)
  }

  const moveBy = (dc: number, dr: number, extend: boolean) => {
    if (!dc && !dr) return
    if (extend) {
      const c2 = Math.max(0, sel.c2 + dc)
      const r2 = Math.max(0, sel.r2 + dr)
      setSel({ ...sel, c2, r2 })
      ensureVisible(c2, r2)
      return
    }
    const c = Math.max(0, cur.c + dc)
    const r = Math.max(0, cur.r + dr)
    setCur({ c, r })
    setSel({ c1: c, r1: r, c2: c, r2: r })
    ensureVisible(c, r)
  }

  const ensureVisible = (c: number, r: number) => {
    const el = gridRef.current
    if (!el) return
    const x = geo.colX[c] ?? 0
    const y = geo.rowY[r] ?? 0
    const w = sheet?.cols[c] ?? DEFAULT_COL_WIDTH
    const h = sheet?.rows[r] ?? DEFAULT_ROW_HEIGHT
    if (x < el.scrollLeft) el.scrollLeft = x
    else if (x + w + HEADER_W > el.scrollLeft + el.clientWidth) el.scrollLeft = x + w + HEADER_W - el.clientWidth
    if (y < el.scrollTop) el.scrollTop = y
    else if (y + h + HEADER_H > el.scrollTop + el.clientHeight) el.scrollTop = y + h + HEADER_H - el.clientHeight
  }

  const clear = () => mutate(keysOf(sel), () => keysOf(sel).forEach((k) => {
    const c = sheet!.cells.get(k)
    if (c?.s) sheet!.cells.set(k, { v: null, s: c.s })
    else sheet!.cells.delete(k)
  }))

  const style = (patch: Partial<CellStyle> | ((s: CellStyle) => Partial<CellStyle>)) => {
    if (!sheet) return
    mutate(keysOf(sel), () => {
      for (const k of keysOf(sel)) {
        const cell = sheet.cells.get(k) ?? { v: null }
        const next = { ...cell.s, ...(typeof patch === 'function' ? patch(cell.s ?? {}) : patch) }
        for (const p of Object.keys(next) as Array<keyof CellStyle>) if (next[p] === undefined || next[p] === false) delete next[p]
        sheet.cells.set(k, { ...cell, s: next })
      }
    })
  }

  const curStyle = sheet?.cells.get(key(cur.c, cur.r))?.s ?? {}
  const toggle = (prop: 'b' | 'i' | 'u' | 's') => style({ [prop]: !curStyle[prop] })

  // ------------------------------------------------------------ copiar / colar

  const copy = async (cut = false) => {
    if (!sheet) return
    const n = norm(sel)
    const lines: string[] = []
    const cells: Array<{ dc: number; dr: number; cell: Cell }> = []
    for (let r = n.r1; r <= n.r2; r++) {
      const row: string[] = []
      for (let c = n.c1; c <= n.c2; c++) {
        const cell = sheet.cells.get(key(c, r))
        if (cell) cells.push({ dc: c - n.c1, dr: r - n.r1, cell: structuredClone(cell) })
        row.push(formatValue(value(c, r), cell?.s?.fmt))
      }
      lines.push(row.join('\t'))
    }
    const text = lines.join('\n')
    clip.current = { text, cells, cut: cut ? n : null }
    await navigator.clipboard.writeText(text).catch(() => {})
  }

  const paste = async () => {
    if (!sheet) return
    const text = await navigator.clipboard.readText().catch(() => '')
    const n = norm(sel)
    const internal = clip.current && clip.current.text === text ? clip.current : null
    if (internal) {
      const keys = internal.cells.map(({ dc, dr }) => key(n.c1 + dc, n.r1 + dr))
      const cutKeys = internal.cut ? keysOf(internal.cut) : []
      mutate([...new Set([...keys, ...cutKeys])], () => {
        if (internal.cut) for (const k of cutKeys) sheet.cells.delete(k)
        for (const { dc, dr, cell } of internal.cells) {
          const next = structuredClone(cell)
          // Recortar move a fórmula como está; copiar desloca as referências.
          if (next.f && !internal.cut && clipOrigin.current) next.f = shiftFormula(cell.f!, n.c1 - clipOrigin.current.c, n.r1 - clipOrigin.current.r)
          sheet.cells.set(key(n.c1 + dc, n.r1 + dr), next)
        }
      })
      if (internal.cut) clip.current = null
      return
    }
    if (!text) return
    const rows = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'))
    const keys: string[] = []
    rows.forEach((row, dr) => row.forEach((_, dc) => keys.push(key(n.c1 + dc, n.r1 + dr))))
    mutate(keys, () => {
      rows.forEach((row, dr) =>
        row.forEach((t, dc) => {
          const p = parseInput(t)
          const k = key(n.c1 + dc, n.r1 + dr)
          const old = sheet.cells.get(k)
          if (p.v === null && !p.f) {
            if (old?.s) sheet.cells.set(k, { v: null, s: old.s })
            else sheet.cells.delete(k)
          } else sheet.cells.set(k, { v: p.v, ...(p.f ? { f: p.f } : {}), ...(old?.s || p.fmt ? { s: { ...old?.s, ...(p.fmt ? { fmt: p.fmt } : {}) } } : {}) })
        }),
      )
    })
    setSel({ ...n, c2: n.c1 + Math.max(...rows.map((r) => r.length)) - 1, r2: n.r1 + rows.length - 1 })
  }
  const clipOrigin = useRef<{ c: number; r: number } | null>(null)

  // ------------------------------------------------------------ linhas e colunas

  /** Desloca células (inserir/excluir linha ou coluna) ajustando as fórmulas. */
  const shiftCells = (axis: 'row' | 'col', at: number, delta: number) => {
    if (!sheet) return
    const all = [...sheet.cells.keys()]
    mutate(all.concat(all.map((k) => {
      const [c, r] = k.split(',').map(Number) as [number, number]
      return axis === 'row' ? key(c, r + delta) : key(c + delta, r)
    })), () => {
      const entries = [...sheet.cells.entries()]
      sheet.cells.clear()
      for (const [k, cell] of entries) {
        const [c, r] = k.split(',').map(Number) as [number, number]
        const pos = axis === 'row' ? r : c
        if (delta < 0 && pos >= at && pos < at - delta) continue
        const moved = pos >= at ? pos + delta : pos
        if (cell.f) cell.f = adjustRefs(cell.f, axis, at, delta)
        sheet.cells.set(axis === 'row' ? key(c, moved) : key(moved, r), cell)
      }
    })
  }

  const sortSel = (desc: boolean) => {
    if (!sheet) return
    const n = norm(sel)
    const rows: Array<Array<Cell | undefined>> = []
    for (let r = n.r1; r <= n.r2; r++) {
      const row: Array<Cell | undefined> = []
      for (let c = n.c1; c <= n.c2; c++) row.push(sheet.cells.get(key(c, r)))
      rows.push(row)
    }
    // Ordena pela primeira coluna da seleção (valor calculado).
    const indexed = rows.map((row, i) => ({ row, v: value(n.c1, n.r1 + i) }))
    indexed.sort((a, b) => {
      const x = a.v
      const y = b.v
      if (x === null && y !== null) return 1
      if (y === null && x !== null) return -1
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR', { numeric: true })
      return desc ? -r : r
    })
    mutate(keysOf(n), () => {
      indexed.forEach(({ row }, i) =>
        row.forEach((cell, j) => {
          const k = key(n.c1 + j, n.r1 + i)
          if (cell) sheet.cells.set(k, cell)
          else sheet.cells.delete(k)
        }),
      )
    })
  }

  const autoSum = () => {
    if (!sheet) return
    // Soma os números logo acima da célula atual.
    let r = cur.r - 1
    while (r >= 0 && typeof value(cur.c, r) === 'number') r--
    const from = r + 1
    if (from >= cur.r) return startEdit('=SOMA()')
    const k = key(cur.c, cur.r)
    mutate([k], () => sheet.cells.set(k, { ...sheet.cells.get(k), v: null, f: `SUM(${addr(cur.c, from)}:${addr(cur.c, cur.r - 1)})` }))
  }

  // ------------------------------------------------------------ teclado e mouse

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (edit) return
    const mod = e.ctrlKey || e.metaKey
    const k = e.key
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault()
      const dc = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0
      const dr = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0
      moveBy(dc, dr, e.shiftKey)
    } else if (k === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) moveBy(0, -1, false)
      else startEdit()
    } else if (k === 'Tab') {
      e.preventDefault()
      moveBy(e.shiftKey ? -1 : 1, 0, false)
    } else if (k === 'F2') {
      e.preventDefault()
      startEdit()
    } else if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault()
      clear()
    } else if (mod && k.toLowerCase() === 'c') {
      e.preventDefault()
      clipOrigin.current = { c: norm(sel).c1, r: norm(sel).r1 }
      void copy()
    } else if (mod && k.toLowerCase() === 'x') {
      e.preventDefault()
      clipOrigin.current = { c: norm(sel).c1, r: norm(sel).r1 }
      void copy(true)
    } else if (mod && k.toLowerCase() === 'v') {
      e.preventDefault()
      void paste()
    } else if (mod && k.toLowerCase() === 'z') {
      e.preventDefault()
      restore(undo, redo)
    } else if (mod && k.toLowerCase() === 'y') {
      e.preventDefault()
      restore(redo, undo)
    } else if (mod && k.toLowerCase() === 'b') {
      e.preventDefault()
      toggle('b')
    } else if (mod && k.toLowerCase() === 'i') {
      e.preventDefault()
      toggle('i')
    } else if (mod && k.toLowerCase() === 'u') {
      e.preventDefault()
      toggle('u')
    } else if (mod && k.toLowerCase() === 'a') {
      e.preventDefault()
      setSel({ c1: 0, r1: 0, c2: dims.cols - 1, r2: dims.rows - 1 })
    } else if (!mod && !e.altKey && k.length === 1) {
      e.preventDefault()
      startEdit(k)
    }
  }

  const cellAt = (clientX: number, clientY: number) => {
    const el = gridRef.current!
    const rect = el.getBoundingClientRect()
    const x = clientX - rect.left + el.scrollLeft - HEADER_W
    const y = clientY - rect.top + el.scrollTop - HEADER_H
    return { c: indexAt(geo.colX, Math.max(0, x)), r: indexAt(geo.rowY, Math.max(0, y)) }
  }

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest(`.${styles.editor}`) || target.closest(`.${styles.resizer}`)) return
    const { c, r } = cellAt(e.clientX, e.clientY)
    // Editando fórmula: clicar numa célula insere a referência.
    if (edit && edit.value.startsWith('=') && !(c === cur.c && r === cur.r)) {
      e.preventDefault()
      const ref = addr(c, r)
      setEdit({ ...edit, value: edit.value + (/[=(;,:+\-*/^&<>]$/.test(edit.value) ? '' : ';') + ref })
      requestAnimationFrame(() => (edit.from === 'bar' ? barRef : editRef).current?.focus())
      return
    }
    if (edit) commitEdit('none')
    if (target.closest(`.${styles.colHead}`)) {
      setSel(e.shiftKey ? { ...sel, c2: c, r1: 0, r2: dims.rows - 1 } : { c1: c, r1: 0, c2: c, r2: dims.rows - 1 })
      setCur({ c, r: 0 })
      return
    }
    if (target.closest(`.${styles.rowHead}`)) {
      setSel(e.shiftKey ? { ...sel, r2: r, c1: 0, c2: dims.cols - 1 } : { c1: 0, r1: r, c2: dims.cols - 1, r2: r })
      setCur({ c: 0, r })
      return
    }
    if (e.shiftKey) setSel({ ...sel, c2: c, r2: r })
    else {
      setCur({ c, r })
      setSel({ c1: c, r1: r, c2: c, r2: r })
    }
    dragging.current = true
    gridRef.current?.focus()
  }

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current || !gridRef.current) return
      const { c, r } = cellAt(e.clientX, e.clientY)
      setSel((s) => (s.c2 === c && s.r2 === r ? s : { ...s, c2: c, r2: r }))
    }
    const up = () => (dragging.current = false)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  })

  const resizeCol = (c: number, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!sheet) return
    const sx = e.clientX
    const w0 = sheet.cols[c] ?? DEFAULT_COL_WIDTH
    const move = (ev: PointerEvent) => {
      sheet.cols[c] = Math.max(28, Math.round(w0 + ev.clientX - sx))
      setVersion((v) => v + 1)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (wb) file.change(wb)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault()
    const { c, r } = cellAt(e.clientX, e.clientY)
    const n = norm(sel)
    if (c < n.c1 || c > n.c2 || r < n.r1 || r > n.r2) {
      setCur({ c, r })
      setSel({ c1: c, r1: r, c2: c, r2: r })
    }
    const items: MenuItem[] = [
      { id: 'cut', label: 'Recortar', icon: Scissors, shortcut: 'Ctrl+X' },
      { id: 'copy', label: 'Copiar', icon: Copy, shortcut: 'Ctrl+C' },
      { id: 'paste', label: 'Colar', icon: Clipboard, shortcut: 'Ctrl+V' },
      { type: 'separator' },
      { id: 'row-above', label: 'Inserir linha acima' },
      { id: 'row-below', label: 'Inserir linha abaixo' },
      { id: 'col-left', label: 'Inserir coluna à esquerda' },
      { id: 'col-right', label: 'Inserir coluna à direita' },
      { type: 'separator' },
      { id: 'sort-asc', label: 'Classificar A → Z', icon: ArrowDownAZ },
      { id: 'sort-desc', label: 'Classificar Z → A', icon: ArrowUpAZ },
      { type: 'separator' },
      { id: 'clear', label: 'Limpar conteúdo', icon: Eraser, shortcut: 'Del' },
      { id: 'del-row', label: 'Excluir linha', icon: Trash2, danger: true },
      { id: 'del-col', label: 'Excluir coluna', icon: Trash2, danger: true },
    ]
    const id = await openMenu(items, { x: e.clientX, y: e.clientY })
    const s = norm(sel.c1 === c && sel.r1 === r ? sel : { c1: c, r1: r, c2: c, r2: r })
    if (id === 'cut' || id === 'copy') {
      clipOrigin.current = { c: s.c1, r: s.r1 }
      void copy(id === 'cut')
    } else if (id === 'paste') void paste()
    else if (id === 'row-above') shiftCells('row', s.r1, 1)
    else if (id === 'row-below') shiftCells('row', s.r2 + 1, 1)
    else if (id === 'col-left') shiftCells('col', s.c1, 1)
    else if (id === 'col-right') shiftCells('col', s.c2 + 1, 1)
    else if (id === 'del-row') shiftCells('row', s.r1, -(s.r2 - s.r1 + 1))
    else if (id === 'del-col') shiftCells('col', s.c1, -(s.c2 - s.c1 + 1))
    else if (id === 'sort-asc') sortSel(false)
    else if (id === 'sort-desc') sortSel(true)
    else if (id === 'clear') clear()
    gridRef.current?.focus()
  }

  // ------------------------------------------------------------ abas

  const addSheet = () => {
    if (!wb) return
    let n = wb.sheets.length + 1
    while (wb.sheets.some((s) => s.name === `Planilha${n}`)) n++
    wb.sheets.push(newSheet(`Planilha${n}`))
    setSheetIdx(wb.sheets.length - 1)
    commitChange()
  }

  const sheetMenu = async (i: number, e: React.MouseEvent) => {
    e.preventDefault()
    if (!wb) return
    const id = await openMenu(
      [
        { id: 'rename', label: 'Renomear' },
        { id: 'dup', label: 'Duplicar' },
        { type: 'separator' },
        { id: 'delete', label: 'Excluir aba', icon: Trash2, danger: true, disabled: wb.sheets.length <= 1 },
      ],
      { x: e.clientX, y: e.clientY },
    )
    if (id === 'rename') setRenamingSheet(i)
    else if (id === 'dup') {
      const src = wb.sheets[i]!
      wb.sheets.splice(i + 1, 0, { name: `${src.name} (cópia)`, cells: new Map([...src.cells].map(([k, c]) => [k, structuredClone(c)])), cols: { ...src.cols }, rows: { ...src.rows } })
      setSheetIdx(i + 1)
      commitChange()
    } else if (id === 'delete') {
      wb.sheets.splice(i, 1)
      setSheetIdx(Math.max(0, Math.min(sheetIdx, wb.sheets.length - 1)))
      undo.current = []
      redo.current = []
      commitChange()
    }
  }

  // ------------------------------------------------------------ render

  if (file.error) return <div className={styles.error}>Não foi possível abrir a planilha: {file.error}</div>

  const n = norm(sel)
  const c0 = sheet ? indexAt(geo.colX, scroll.left) : 0
  const c9 = sheet ? Math.min(dims.cols - 1, indexAt(geo.colX, scroll.left + scroll.w)) : 0
  const r0 = sheet ? indexAt(geo.rowY, scroll.top) : 0
  const r9 = sheet ? Math.min(dims.rows - 1, indexAt(geo.rowY, scroll.top + scroll.h)) : 0
  const totalW = geo.colX[dims.cols]! + HEADER_W
  const totalH = geo.rowY[dims.rows]! + HEADER_H

  // Soma/Média/Contagem da seleção (como na barra de status do Excel).
  let sum = 0
  let count = 0
  let nums = 0
  if (sheet && (n.c2 - n.c1 + 1) * (n.r2 - n.r1 + 1) <= 20000) {
    for (let r = n.r1; r <= Math.min(n.r2, dims.rows); r++)
      for (let c = n.c1; c <= Math.min(n.c2, dims.cols); c++) {
        const v = sheet.cells.has(key(c, r)) ? value(c, r) : null
        if (v !== null && v !== '') count++
        if (typeof v === 'number') {
          sum += v
          nums++
        }
      }
  }

  const rect = (s: Sel) => ({
    left: HEADER_W + geo.colX[s.c1]!,
    top: HEADER_H + geo.rowY[s.r1]!,
    width: geo.colX[Math.min(s.c2 + 1, dims.cols)]! - geo.colX[s.c1]!,
    height: geo.rowY[Math.min(s.r2 + 1, dims.rows)]! - geo.rowY[s.r1]!,
  })

  const curCell = sheet?.cells.get(key(cur.c, cur.r))
  const fmt = curStyle.fmt ?? 'general'

  return (
    <OfficeShell
      path={path}
      state={file.state}
      loading={!wb}
      toolbar={
        <>
          <ToolButton icon={Undo2} label="Desfazer (Ctrl+Z)" disabled={!undo.current.length} onClick={() => restore(undo, redo)} />
          <ToolButton icon={Redo2} label="Refazer (Ctrl+Y)" disabled={!redo.current.length} onClick={() => restore(redo, undo)} />
          <Divider />
          <select className={styles.select} value={fmt} onChange={(e) => style({ fmt: e.target.value as NumFmt })} aria-label="Formato do número">
            {FORMATS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <Divider />
          <ToolButton icon={Bold} label="Negrito (Ctrl+B)" on={Boolean(curStyle.b)} onClick={() => toggle('b')} />
          <ToolButton icon={Italic} label="Itálico (Ctrl+I)" on={Boolean(curStyle.i)} onClick={() => toggle('i')} />
          <ToolButton icon={Underline} label="Sublinhado (Ctrl+U)" on={Boolean(curStyle.u)} onClick={() => toggle('u')} />
          <ToolButton icon={Strikethrough} label="Tachado" on={Boolean(curStyle.s)} onClick={() => toggle('s')} />
          <ColorButton icon={Baseline} label="Cor do texto" initial="#c0392b" onPick={(c) => style({ color: c })} />
          <ColorButton icon={PaintBucket} label="Cor de preenchimento" initial="#fff2b3" onPick={(c) => style({ fill: c })} />
          <Divider />
          <ToolButton icon={AlignLeft} label="Alinhar à esquerda" on={curStyle.align === 'left'} onClick={() => style({ align: curStyle.align === 'left' ? undefined : 'left' })} />
          <ToolButton icon={AlignCenter} label="Centralizar" on={curStyle.align === 'center'} onClick={() => style({ align: curStyle.align === 'center' ? undefined : 'center' })} />
          <ToolButton icon={AlignRight} label="Alinhar à direita" on={curStyle.align === 'right'} onClick={() => style({ align: curStyle.align === 'right' ? undefined : 'right' })} />
          <ToolButton icon={WrapText} label="Quebrar texto" on={Boolean(curStyle.wrap)} onClick={() => style({ wrap: !curStyle.wrap })} />
          <Divider />
          <ToolButton icon={Sigma} label="Soma automática" onClick={autoSum} />
          <ToolButton icon={ArrowDownAZ} label="Classificar A → Z" onClick={() => sortSel(false)} />
          <ToolButton icon={ArrowUpAZ} label="Classificar Z → A" onClick={() => sortSel(true)} />
          <ToolButton icon={Eraser} label="Limpar formatação" onClick={() => style(() => ({ b: undefined, i: undefined, u: undefined, s: undefined, color: undefined, fill: undefined, align: undefined, wrap: undefined, fmt: undefined }))} />
        </>
      }
      status={
        <span className={styles.stats}>
          {nums > 1 && <span>Soma: {formatValue(sum, fmt === 'general' ? 'general' : fmt)}</span>}
          {nums > 1 && <span>Média: {formatValue(sum / nums, fmt === 'general' ? 'general' : fmt)}</span>}
          {count > 1 && <span>Contagem: {count}</span>}
          {isCsv && <span>CSV · só a primeira aba é gravada</span>}
        </span>
      }
    >
      <div className={styles.formulaBar}>
        <span className={styles.nameBox}>{n.c1 === n.c2 && n.r1 === n.r2 ? addr(cur.c, cur.r) : `${addr(n.c1, n.r1)}:${addr(n.c2, n.r2)}`}</span>
        <span className={styles.fx}>fx</span>
        <input
          ref={barRef}
          className={styles.barInput}
          value={edit ? edit.value : rawOf(curCell)}
          onFocus={() => !edit && startEdit(undefined, 'bar')}
          onChange={(e) => setEdit({ value: e.target.value, from: edit?.from ?? 'bar' })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitEdit('down')
            } else if (e.key === 'Escape') {
              setEdit(null)
              gridRef.current?.focus()
            } else if (e.key === 'Tab') {
              e.preventDefault()
              commitEdit('right')
            }
          }}
          spellCheck={false}
          aria-label="Conteúdo da célula"
        />
      </div>

      <div
        ref={gridRef}
        className={styles.grid}
        tabIndex={0}
        onScroll={(e) => setScroll((s) => ({ ...s, top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft }))}
        onKeyDown={onKeyDown}
        onMouseDown={onMouseDown}
        onDoubleClick={(e) => !(e.target as HTMLElement).closest(`.${styles.colHead},.${styles.rowHead}`) && startEdit()}
        onContextMenu={(e) => void onContextMenu(e)}
        role="grid"
        aria-label="Planilha"
      >
        <div className={styles.canvas} style={{ width: totalW, height: totalH }}>
          {/* Linhas de grade (acompanham as larguras/alturas reais) */}
          {Array.from({ length: c9 - c0 + 2 }, (_, j) => c0 + j).map((c) => (
            <div key={`gc${c}`} className={styles.vline} style={{ left: HEADER_W + geo.colX[c]! - 1, top: scroll.top, height: scroll.h }} />
          ))}
          {Array.from({ length: r9 - r0 + 2 }, (_, i) => r0 + i).map((r) => (
            <div key={`gr${r}`} className={styles.hline} style={{ top: HEADER_H + geo.rowY[r]! - 1, left: scroll.left, width: scroll.w }} />
          ))}

          {/* Células visíveis */}
          {sheet &&
            Array.from({ length: r9 - r0 + 1 }, (_, i) => r0 + i).flatMap((r) =>
              Array.from({ length: c9 - c0 + 1 }, (_, j) => c0 + j).map((c) => {
                const cell = sheet.cells.get(key(c, r))
                if (!cell) return null
                const v = value(c, r)
                const s = cell.s
                const isNum = typeof v === 'number'
                return (
                  <div
                    key={`${c},${r}`}
                    className={styles.cell}
                    data-err={v instanceof FormulaError || undefined}
                    style={{
                      left: HEADER_W + geo.colX[c]!,
                      top: HEADER_H + geo.rowY[r]!,
                      width: geo.colX[c + 1]! - geo.colX[c]!,
                      height: geo.rowY[r + 1]! - geo.rowY[r]!,
                      textAlign: s?.align ?? (isNum ? 'right' : typeof v === 'boolean' || v instanceof FormulaError ? 'center' : 'left'),
                      fontWeight: s?.b ? 700 : undefined,
                      fontStyle: s?.i ? 'italic' : undefined,
                      textDecoration: [s?.u && 'underline', s?.s && 'line-through'].filter(Boolean).join(' ') || undefined,
                      color: s?.color,
                      background: s?.fill,
                      whiteSpace: s?.wrap ? 'normal' : undefined,
                      fontSize: s?.size ? `${s.size * 1.2}px` : undefined,
                    }}
                    title={v instanceof FormulaError ? errorHint(v.code) : undefined}
                  >
                    {formatValue(v, s?.fmt)}
                  </div>
                )
              }),
            )}

          {/* Seleção */}
          <div className={styles.selection} style={rect(n)} />
          <div className={styles.active} style={rect({ c1: cur.c, r1: cur.r, c2: cur.c, r2: cur.r })} />

          {/* Cabeçalhos (fixos ao rolar) */}
          <div className={styles.colHeads} style={{ top: scroll.top, width: totalW }}>
            {Array.from({ length: c9 - c0 + 1 }, (_, j) => c0 + j).map((c) => (
              <div
                key={c}
                className={styles.colHead}
                data-on={(c >= n.c1 && c <= n.c2) || undefined}
                style={{ left: HEADER_W + geo.colX[c]!, width: geo.colX[c + 1]! - geo.colX[c]! }}
              >
                {colName(c)}
                <span className={styles.resizer} onPointerDown={(e) => resizeCol(c, e)} onDoubleClick={() => sheet && (delete sheet.cols[c], commitChange())} />
              </div>
            ))}
          </div>
          <div className={styles.rowHeads} style={{ left: scroll.left, height: totalH }}>
            {Array.from({ length: r9 - r0 + 1 }, (_, i) => r0 + i).map((r) => (
              <div key={r} className={styles.rowHead} data-on={(r >= n.r1 && r <= n.r2) || undefined} style={{ top: HEADER_H + geo.rowY[r]!, height: geo.rowY[r + 1]! - geo.rowY[r]! }}>
                {r + 1}
              </div>
            ))}
          </div>
          <div className={styles.corner} style={{ left: scroll.left, top: scroll.top }} onMouseDown={() => setSel({ c1: 0, r1: 0, c2: dims.cols - 1, r2: dims.rows - 1 })} />

          {edit && edit.from === 'cell' && (
            <input
              ref={editRef}
              autoFocus
              onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
              className={styles.editor}
              style={{ ...rect({ c1: cur.c, r1: cur.r, c2: cur.c, r2: cur.r }), minWidth: geo.colX[cur.c + 1]! - geo.colX[cur.c]! }}
              value={edit.value}
              onChange={(e) => setEdit({ value: e.target.value, from: 'cell' })}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitEdit(e.shiftKey ? 'up' : 'down')
                } else if (e.key === 'Tab') {
                  e.preventDefault()
                  commitEdit(e.shiftKey ? 'left' : 'right')
                } else if (e.key === 'Escape') {
                  setEdit(null)
                  gridRef.current?.focus()
                }
              }}
              spellCheck={false}
              aria-label={`Editar ${addr(cur.c, cur.r)}`}
            />
          )}
        </div>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Abas">
        {wb?.sheets.map((s, i) =>
          renamingSheet === i ? (
            <input
              key={i}
              autoFocus
              className={styles.tabInput}
              defaultValue={s.name}
              onBlur={(e) => {
                const name = e.target.value.trim().slice(0, 31)
                if (name && !wb.sheets.some((o, j) => j !== i && o.name === name)) {
                  s.name = name
                  commitChange()
                }
                setRenamingSheet(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setRenamingSheet(null)
              }}
            />
          ) : (
            <button
              key={i}
              role="tab"
              aria-selected={i === sheetIdx}
              className={styles.tab}
              data-on={i === sheetIdx || undefined}
              onClick={() => {
                setSheetIdx(i)
                setSel({ c1: 0, r1: 0, c2: 0, r2: 0 })
                setCur({ c: 0, r: 0 })
              }}
              onDoubleClick={() => setRenamingSheet(i)}
              onContextMenu={(e) => void sheetMenu(i, e)}
            >
              {s.name}
            </button>
          ),
        )}
        {!isCsv && (
          <button className={styles.addTab} onClick={addSheet} title="Nova aba" aria-label="Nova aba">
            <Plus size={14} />
          </button>
        )}
      </div>
    </OfficeShell>
  )
}

function errorHint(code: string): string {
  switch (code) {
    case '#DIV/0!':
      return 'Divisão por zero.'
    case '#NAME?':
      return 'Função ou nome desconhecido.'
    case '#REF!':
      return 'Referência inválida.'
    case '#VALUE!':
      return 'Tipo de valor errado na fórmula.'
    case '#N/A':
      return 'Valor não encontrado.'
    case '#CICLO!':
      return 'Referência circular: a fórmula depende dela mesma.'
    default:
      return 'Erro na fórmula.'
  }
}

/** Ajusta referências de uma fórmula após inserir/excluir linhas ou colunas. */
function adjustRefs(formula: string, axis: 'row' | 'col', at: number, delta: number): string {
  return formula.replace(/(\$?)([A-Z]{1,3})(\$?)(\d{1,7})(?![\w(])/g, (m, ac: string, col: string, ar: string, row: string, offset: number, all: string) => {
    if (/[\w.]/.test(all[offset - 1] ?? '')) return m
    const p = parseAddr(`${col}${row}`)
    if (!p) return m
    let { col: c, row: r } = p
    if (axis === 'row' && r >= at) r += delta
    if (axis === 'col' && c >= at) c += delta
    if (r < 0 || c < 0 || (delta < 0 && ((axis === 'row' && p.row >= at && p.row < at - delta) || (axis === 'col' && p.col >= at && p.col < at - delta)))) return '#REF!'
    return `${ac}${colName(c)}${ar}${r + 1}`
  })
}
