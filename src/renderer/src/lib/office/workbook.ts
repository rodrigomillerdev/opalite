import { type EvalContext, FormulaError, type Scalar, evaluate } from './formula'

/*
 * Modelo da planilha (independente do formato do arquivo) e o cálculo das
 * fórmulas. Endereços internos são numéricos, a partir de 0: chave "col,row".
 */

export type NumFmt = 'general' | 'number' | 'integer' | 'currency' | 'percent' | 'date'

export interface CellStyle {
  b?: boolean
  i?: boolean
  u?: boolean
  s?: boolean
  /** Cor do texto (#rrggbb). */
  color?: string
  /** Cor de fundo (#rrggbb). */
  fill?: string
  align?: 'left' | 'center' | 'right'
  fmt?: NumFmt
  size?: number
  wrap?: boolean
}

export interface Cell {
  /** Valor digitado (ou resultado em cache quando há fórmula). */
  v: string | number | boolean | null
  /** Fórmula sem o "=" (em inglês, como no arquivo). */
  f?: string
  s?: CellStyle
}

export interface Sheet {
  name: string
  cells: Map<string, Cell>
  /** Largura das colunas em px (só as alteradas). */
  cols: Record<number, number>
  /** Altura das linhas em px (só as alteradas). */
  rows: Record<number, number>
}

export interface Workbook {
  sheets: Sheet[]
}

export const key = (col: number, row: number) => `${col},${row}`
export const unkey = (k: string) => {
  const [c, r] = k.split(',')
  return { col: Number(c), row: Number(r) }
}

export const DEFAULT_COL_WIDTH = 100
export const DEFAULT_ROW_HEIGHT = 24

export function newSheet(name: string): Sheet {
  return { name, cells: new Map(), cols: {}, rows: {} }
}

export function newWorkbook(): Workbook {
  return { sheets: [newSheet('Planilha1')] }
}

/** Tamanho usado (última coluna/linha com conteúdo). */
export function usedRange(sheet: Sheet): { cols: number; rows: number } {
  let cols = 0
  let rows = 0
  for (const k of sheet.cells.keys()) {
    const { col, row } = unkey(k)
    if (col + 1 > cols) cols = col + 1
    if (row + 1 > rows) rows = row + 1
  }
  return { cols, rows }
}

/** Converte o que a pessoa digitou no valor da célula ("12,5" -> 12.5, "=..." -> fórmula). */
export function parseInput(text: string): Pick<Cell, 'v' | 'f'> & { fmt?: NumFmt } {
  const t = text.trim()
  if (t === '') return { v: null }
  if (t.startsWith('=') && t.length > 1) return { v: null, f: t.slice(1) }
  if (/^(verdadeiro|true)$/i.test(t)) return { v: true }
  if (/^(falso|false)$/i.test(t)) return { v: false }
  // Moeda "R$ 1.234,56"
  const money = /^-?R\$\s*([\d.]+(?:,\d+)?)$/.exec(t.replace(/^(-?)R\$\s*-/, '-R$'))
  if (money) {
    const n = Number(money[1]!.replace(/\./g, '').replace(',', '.'))
    if (Number.isFinite(n)) return { v: t.startsWith('-') ? -n : n, fmt: 'currency' }
  }
  // Porcentagem "15%" / "12,5%"
  const pct = /^(-?[\d.]*,?\d+)\s*%$/.exec(t)
  if (pct) {
    const n = Number(pct[1]!.replace(/\./g, '').replace(',', '.'))
    if (Number.isFinite(n)) return { v: n / 100, fmt: 'percent' }
  }
  // Data "31/12/2026"
  const date = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t)
  if (date) {
    const d = Date.UTC(Number(date[3]), Number(date[2]) - 1, Number(date[1]))
    return { v: (d - Date.UTC(1899, 11, 30)) / 86400000, fmt: 'date' }
  }
  // Número pt-BR ("1.234,5") ou com ponto decimal ("1234.5").
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) || /^-?\d+,\d+$/.test(t)) return { v: Number(t.replace(/\./g, '').replace(',', '.')) }
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return { v: Number(t) }
  return { v: t }
}

const brNumber = (n: number, digits: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** Texto exibido na célula. */
export function formatValue(v: Scalar, fmt: NumFmt = 'general'): string {
  if (v === null || v === undefined) return ''
  if (v instanceof FormulaError) return v.code
  if (typeof v === 'boolean') return v ? 'VERDADEIRO' : 'FALSO'
  if (typeof v === 'string') return v
  switch (fmt) {
    case 'number':
      return brNumber(v, 2)
    case 'integer':
      return brNumber(Math.round(v), 0)
    case 'currency':
      return `${v < 0 ? '-' : ''}R$ ${brNumber(Math.abs(v), 2)}`
    case 'percent':
      return `${brNumber(v * 100, Number.isInteger(v * 100) ? 0 : 2)}%`
    case 'date': {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000)
      return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
    }
    default: {
      if (Number.isInteger(v)) return String(v)
      // Até 10 casas, sem zeros sobrando; vírgula decimal.
      return String(Number(v.toPrecision(12))).replace('.', ',')
    }
  }
}

/**
 * Cálculo de todas as fórmulas do arquivo. Recalcula tudo a cada mudança
 * (planilhas pessoais têm centenas ou poucos milhares de fórmulas; o custo
 * fica em poucos milissegundos). Ciclos viram #CICLO!.
 */
export class Calc {
  private values = new Map<string, Scalar>()
  private visiting = new Set<string>()

  constructor(private wb: Workbook) {}

  setWorkbook(wb: Workbook): void {
    this.wb = wb
    this.values.clear()
  }

  invalidate(): void {
    this.values.clear()
  }

  private sheetIndex(name?: string, from = 0): number {
    if (!name) return from
    const i = this.wb.sheets.findIndex((s) => s.name.toLowerCase() === name.toLowerCase())
    return i
  }

  value(sheetIdx: number, col: number, row: number): Scalar {
    const sheet = this.wb.sheets[sheetIdx]
    if (!sheet) return new FormulaError('#REF!')
    const k = `${sheetIdx}:${col},${row}`
    const cached = this.values.get(k)
    if (cached !== undefined) return cached
    const cell = sheet.cells.get(key(col, row))
    if (!cell) return null
    if (!cell.f) return cell.v
    if (this.visiting.has(k)) return new FormulaError('#CICLO!')
    this.visiting.add(k)
    const ctx: EvalContext = {
      value: (c, r, sh) => {
        const idx = this.sheetIndex(sh, sheetIdx)
        return idx < 0 ? new FormulaError('#REF!') : this.value(idx, c, r)
      },
    }
    let result: Scalar
    try {
      result = evaluate(cell.f, ctx)
    } catch {
      result = new FormulaError('#VALUE!')
    }
    this.visiting.delete(k)
    this.values.set(k, result)
    return result
  }
}

/** Copia uma fórmula deslocando as referências relativas (A1 -> B2 ao colar 1 coluna e 1 linha adiante). */
export function shiftFormula(formula: string, dc: number, dr: number): string {
  let out = ''
  let i = 0
  while (i < formula.length) {
    if (formula[i] === '"') {
      const end = formula.indexOf('"', i + 1)
      const stop = end === -1 ? formula.length : end + 1
      out += formula.slice(i, stop)
      i = stop
      continue
    }
    const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\w(])/.exec(formula.slice(i))
    const prev = formula[i - 1] ?? ''
    if (m && !/[\w.]/.test(prev)) {
      const [, absC, col, absR, row] = m
      let c = 0
      for (const ch of col!.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64)
      c -= 1
      let r = Number(row) - 1
      if (!absC) c += dc
      if (!absR) r += dr
      if (c < 0 || r < 0) out += '#REF!'
      else {
        let name = ''
        let n = c + 1
        while (n > 0) {
          const mm = (n - 1) % 26
          name = String.fromCharCode(65 + mm) + name
          n = Math.floor((n - 1) / 26)
        }
        out += `${absC}${name}${absR}${r + 1}`
      }
      i += m[0].length
      continue
    }
    out += formula[i]
    i++
  }
  return out
}
