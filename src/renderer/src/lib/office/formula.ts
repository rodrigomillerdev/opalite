/*
 * Motor de fórmulas da planilha. Aceita nomes de função em português e em
 * inglês (SOMA/SUM, SE/IF, PROCV/VLOOKUP...) e ";" ou "," como separador.
 * Dentro do arquivo .xlsx a fórmula é sempre gravada em inglês com ",",
 * que é o formato que o Excel e o LibreOffice esperam.
 */

export class FormulaError {
  constructor(readonly code: '#DIV/0!' | '#VALUE!' | '#REF!' | '#NAME?' | '#N/A' | '#NUM!' | '#CICLO!') {}
  toString(): string {
    return this.code
  }
}

export type Scalar = string | number | boolean | null | FormulaError
type Value = Scalar | Scalar[][]

export interface EvalContext {
  /** Valor já calculado de uma célula (col/row a partir de 0). */
  value(col: number, row: number, sheet?: string): Scalar
}

// ------------------------------------------------------------ endereços

export function colName(col: number): string {
  let s = ''
  let n = col + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

export function colIndex(name: string): number {
  let n = 0
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export const addr = (col: number, row: number) => `${colName(col)}${row + 1}`

export function parseAddr(a: string): { col: number; row: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(a)
  if (!m) return null
  return { col: colIndex(m[1]!), row: Number(m[2]) - 1 }
}

// ------------------------------------------------------------ nomes pt-BR

const PT: Record<string, string> = {
  SOMA: 'SUM',
  MÉDIA: 'AVERAGE',
  MEDIA: 'AVERAGE',
  MÍNIMO: 'MIN',
  MINIMO: 'MIN',
  MÁXIMO: 'MAX',
  MAXIMO: 'MAX',
  'CONT.NÚM': 'COUNT',
  'CONT.NUM': 'COUNT',
  'CONT.VALORES': 'COUNTA',
  SE: 'IF',
  E: 'AND',
  OU: 'OR',
  NÃO: 'NOT',
  NAO: 'NOT',
  ARRED: 'ROUND',
  RAIZ: 'SQRT',
  POTÊNCIA: 'POWER',
  POTENCIA: 'POWER',
  CONCATENAR: 'CONCATENATE',
  'NÚM.CARACT': 'LEN',
  'NUM.CARACT': 'LEN',
  MAIÚSCULA: 'UPPER',
  MAIUSCULA: 'UPPER',
  MINÚSCULA: 'LOWER',
  MINUSCULA: 'LOWER',
  HOJE: 'TODAY',
  AGORA: 'NOW',
  MED: 'MEDIAN',
  SEERRO: 'IFERROR',
  MULT: 'PRODUCT',
  SOMASE: 'SUMIF',
  'CONT.SE': 'COUNTIF',
  PROCV: 'VLOOKUP',
  ESQUERDA: 'LEFT',
  DIREITA: 'RIGHT',
  'EXT.TEXTO': 'MID',
  ARRUMAR: 'TRIM',
  ABS: 'ABS',
  INT: 'INT',
  MOD: 'MOD',
  PI: 'PI',
}

/** Nome canônico (inglês) de uma função digitada em pt-BR ou inglês. */
export const canonicalFn = (name: string) => PT[name.toUpperCase()] ?? name.toUpperCase()

// ------------------------------------------------------------ tokens

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'ref'; v: string; sheet?: string }
  | { t: 'fn'; v: string }
  | { t: 'op'; v: string }
  | { t: '('; v: '(' }
  | { t: ')'; v: ')' }
  | { t: 'sep'; v: string }
  | { t: ':'; v: ':' }

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  // Com ";" separando argumentos (estilo pt-BR), a vírgula é decimal: SOMA(1,5;2).
  const commaDecimal = src.replace(/"[^"]*"/g, '').includes(';')
  const NUM = commaDecimal ? /^(\d+(?:[.,]\d+)?|[.,]\d+)(?:[eE][+-]?\d+)?/ : /^(\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (c === ' ' || c === '\t' || c === '\n') {
      i++
      continue
    }
    if (c === '"') {
      let s = ''
      i++
      while (i < src.length) {
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            s += '"'
            i += 2
            continue
          }
          break
        }
        s += src[i++]
      }
      i++
      out.push({ t: 'str', v: s })
      continue
    }
    const num = NUM.exec(src.slice(i))
    if (num && !/[A-Za-z_]/.test(src[i + num[0].length] ?? '')) {
      out.push({ t: 'num', v: Number(num[0].replace(',', '.')) })
      i += num[0].length
      continue
    }
    // Referência com aba: Aba!A1 ou 'Minha aba'!A1
    const sheetRef = /^(?:'((?:[^']|'')+)'|([A-Za-zÀ-ÿ_][\wÀ-ÿ.]*))!(\$?[A-Za-z]{1,3}\$?\d+)/.exec(src.slice(i))
    if (sheetRef) {
      out.push({ t: 'ref', v: sheetRef[3]!, sheet: (sheetRef[1] ?? sheetRef[2]!).replace(/''/g, "'") })
      i += sheetRef[0].length
      continue
    }
    const word = /^[A-Za-zÀ-ÿ_$][\wÀ-ÿ.$]*/.exec(src.slice(i))
    if (word) {
      const w = word[0]
      i += w.length
      if (src[i] === '(') out.push({ t: 'fn', v: canonicalFn(w) })
      else if (/^\$?[A-Za-z]{1,3}\$?\d+$/.test(w)) out.push({ t: 'ref', v: w })
      else if (/^(TRUE|VERDADEIRO)$/i.test(w)) out.push({ t: 'bool', v: true })
      else if (/^(FALSE|FALSO)$/i.test(w)) out.push({ t: 'bool', v: false })
      else throw new FormulaError('#NAME?')
      continue
    }
    const two = src.slice(i, i + 2)
    if (two === '<=' || two === '>=' || two === '<>') {
      out.push({ t: 'op', v: two })
      i += 2
      continue
    }
    if ('+-*/^&=<>%'.includes(c)) out.push({ t: 'op', v: c })
    else if (c === '(') out.push({ t: '(', v: '(' })
    else if (c === ')') out.push({ t: ')', v: ')' })
    else if (c === ';' || c === ',') out.push({ t: 'sep', v: c })
    else if (c === ':') out.push({ t: ':', v: ':' })
    else throw new FormulaError('#NAME?')
    i++
  }
  return out
}

// ------------------------------------------------------------ árvore

type Node =
  | { k: 'lit'; v: Scalar }
  | { k: 'ref'; col: number; row: number; sheet?: string }
  | { k: 'range'; c1: number; r1: number; c2: number; r2: number; sheet?: string }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] }

function parse(tokens: Tok[]): Node {
  let p = 0
  const peek = () => tokens[p]
  const take = () => tokens[p++]

  const primary = (): Node => {
    const tok = take()
    if (!tok) throw new FormulaError('#VALUE!')
    if (tok.t === 'num') return { k: 'lit', v: tok.v }
    if (tok.t === 'str') return { k: 'lit', v: tok.v }
    if (tok.t === 'bool') return { k: 'lit', v: tok.v }
    if (tok.t === 'ref') {
      const a = parseAddr(tok.v)
      if (!a) throw new FormulaError('#REF!')
      if (peek()?.t === ':') {
        take()
        const end = take()
        const b = end?.t === 'ref' ? parseAddr(end.v) : null
        if (!b) throw new FormulaError('#REF!')
        return { k: 'range', c1: Math.min(a.col, b.col), r1: Math.min(a.row, b.row), c2: Math.max(a.col, b.col), r2: Math.max(a.row, b.row), sheet: tok.sheet }
      }
      return { k: 'ref', col: a.col, row: a.row, sheet: tok.sheet }
    }
    if (tok.t === 'fn') {
      take() // "("
      const args: Node[] = []
      if (peek()?.t !== ')') {
        for (;;) {
          args.push(comparison())
          if (peek()?.t === 'sep') take()
          else break
        }
      }
      if (take()?.t !== ')') throw new FormulaError('#VALUE!')
      return { k: 'call', fn: tok.v, args }
    }
    if (tok.t === '(') {
      const inner = comparison()
      if (take()?.t !== ')') throw new FormulaError('#VALUE!')
      return inner
    }
    if (tok.t === 'op' && (tok.v === '-' || tok.v === '+')) return { k: 'un', op: tok.v, a: power() }
    throw new FormulaError('#VALUE!')
  }

  const postfix = (): Node => {
    let n = primary()
    while (peek()?.t === 'op' && peek()!.v === '%') {
      take()
      n = { k: 'bin', op: '/', a: n, b: { k: 'lit', v: 100 } }
    }
    return n
  }
  const power = (): Node => {
    let n = postfix()
    while (peek()?.t === 'op' && peek()!.v === '^') {
      take()
      n = { k: 'bin', op: '^', a: n, b: postfix() }
    }
    return n
  }
  const mul = (): Node => {
    let n = power()
    while (peek()?.t === 'op' && (peek()!.v === '*' || peek()!.v === '/')) {
      const op = String(take()!.v)
      n = { k: 'bin', op, a: n, b: power() }
    }
    return n
  }
  const add = (): Node => {
    let n = mul()
    while (peek()?.t === 'op' && (peek()!.v === '+' || peek()!.v === '-')) {
      const op = String(take()!.v)
      n = { k: 'bin', op, a: n, b: mul() }
    }
    return n
  }
  const concat = (): Node => {
    let n = add()
    while (peek()?.t === 'op' && peek()!.v === '&') {
      take()
      n = { k: 'bin', op: '&', a: n, b: add() }
    }
    return n
  }
  function comparison(): Node {
    let n = concat()
    while (peek()?.t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(String(peek()!.v))) {
      const op = String(take()!.v)
      n = { k: 'bin', op, a: n, b: concat() }
    }
    return n
  }

  const tree = comparison()
  if (p < tokens.length) throw new FormulaError('#VALUE!')
  return tree
}

// ------------------------------------------------------------ avaliação

const isErr = (v: unknown): v is FormulaError => v instanceof FormulaError

function toNumber(v: Scalar): number | FormulaError {
  if (isErr(v)) return v
  if (v === null || v === '') return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : new FormulaError('#VALUE!')
}

const toText = (v: Scalar): string => (v === null ? '' : typeof v === 'boolean' ? (v ? 'VERDADEIRO' : 'FALSO') : String(v))

function toBool(v: Scalar): boolean | FormulaError {
  if (isErr(v)) return v
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (v === null || v === '') return false
  if (/^(true|verdadeiro)$/i.test(v)) return true
  if (/^(false|falso)$/i.test(v)) return false
  return new FormulaError('#VALUE!')
}

/** Valores de um argumento achatados (intervalos viram listas). */
function flat(v: Value): Scalar[] {
  return Array.isArray(v) ? v.flat() : [v]
}

function numbersOf(args: Value[], strict = false): number[] | FormulaError {
  const out: number[] = []
  for (const a of args) {
    const fromRange = Array.isArray(a)
    for (const v of flat(a)) {
      if (isErr(v)) return v
      if (typeof v === 'number') out.push(v)
      else if (!fromRange && v !== null) {
        const n = toNumber(v)
        if (isErr(n)) {
          if (strict) return n
        } else out.push(n)
      }
    }
  }
  return out
}

/** Critério de SOMASE/CONT.SE: ">5", "<>x", "=texto", "abc*". */
function criterion(c: Scalar): (v: Scalar) => boolean {
  const s = toText(c)
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(s)!
  const op = m[1] ?? '='
  const rhs = m[2]!
  const num = Number(rhs.replace(',', '.'))
  const numeric = rhs !== '' && Number.isFinite(num)
  const wildcard = /[*?]/.test(rhs) && !numeric ? new RegExp(`^${rhs.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i') : null
  return (v) => {
    if (numeric && (typeof v === 'number' || (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))))) {
      const x = Number(v)
      return op === '=' ? x === num : op === '<>' ? x !== num : op === '<' ? x < num : op === '>' ? x > num : op === '<=' ? x <= num : x >= num
    }
    const t = toText(v).toLowerCase()
    const r = rhs.toLowerCase()
    if (op === '=') return wildcard ? wildcard.test(toText(v)) : t === r
    if (op === '<>') return wildcard ? !wildcard.test(toText(v)) : t !== r
    return false
  }
}

function round(n: number, digits: number): number {
  const f = 10 ** digits
  return Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f
}

/** Data do Excel (dias desde 30/12/1899). */
export function excelDate(d: Date): number {
  return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000
}

type Fn = (args: Value[], raw: Node[], ev: (n: Node) => Value) => Value

const FNS: Record<string, Fn> = {
  SUM: (a) => {
    const n = numbersOf(a)
    return isErr(n) ? n : n.reduce((s, x) => s + x, 0)
  },
  AVERAGE: (a) => {
    const n = numbersOf(a)
    if (isErr(n)) return n
    return n.length ? n.reduce((s, x) => s + x, 0) / n.length : new FormulaError('#DIV/0!')
  },
  MIN: (a) => {
    const n = numbersOf(a)
    return isErr(n) ? n : n.length ? Math.min(...n) : 0
  },
  MAX: (a) => {
    const n = numbersOf(a)
    return isErr(n) ? n : n.length ? Math.max(...n) : 0
  },
  MEDIAN: (a) => {
    const n = numbersOf(a)
    if (isErr(n)) return n
    if (!n.length) return new FormulaError('#NUM!')
    const s = [...n].sort((x, y) => x - y)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
  },
  PRODUCT: (a) => {
    const n = numbersOf(a)
    return isErr(n) ? n : n.reduce((s, x) => s * x, 1)
  },
  COUNT: (a) => a.reduce<number>((s, v) => s + flat(v).filter((x) => typeof x === 'number').length, 0),
  COUNTA: (a) => a.reduce<number>((s, v) => s + flat(v).filter((x) => x !== null && x !== '').length, 0),
  IF: (_a, raw, ev) => {
    const cond = toBool(ev(raw[0]!) as Scalar)
    if (isErr(cond)) return cond
    if (cond) return raw[1] ? ev(raw[1]) : true
    return raw[2] ? ev(raw[2]) : false
  },
  IFERROR: (_a, raw, ev) => {
    const v = ev(raw[0]!)
    return isErr(v) ? (raw[1] ? ev(raw[1]) : '') : v
  },
  AND: (a) => {
    for (const v of a.flatMap(flat)) {
      const b = toBool(v)
      if (isErr(b)) return b
      if (!b) return false
    }
    return true
  },
  OR: (a) => {
    for (const v of a.flatMap(flat)) {
      const b = toBool(v)
      if (isErr(b)) return b
      if (b) return true
    }
    return false
  },
  NOT: (a) => {
    const b = toBool(a[0] as Scalar)
    return isErr(b) ? b : !b
  },
  ROUND: (a) => {
    const n = toNumber(a[0] as Scalar)
    const d = toNumber((a[1] ?? 0) as Scalar)
    return isErr(n) ? n : isErr(d) ? d : round(n, d)
  },
  INT: (a) => {
    const n = toNumber(a[0] as Scalar)
    return isErr(n) ? n : Math.floor(n)
  },
  MOD: (a) => {
    const n = toNumber(a[0] as Scalar)
    const d = toNumber(a[1] as Scalar)
    if (isErr(n)) return n
    if (isErr(d)) return d
    if (d === 0) return new FormulaError('#DIV/0!')
    return n - d * Math.floor(n / d)
  },
  ABS: (a) => {
    const n = toNumber(a[0] as Scalar)
    return isErr(n) ? n : Math.abs(n)
  },
  SQRT: (a) => {
    const n = toNumber(a[0] as Scalar)
    return isErr(n) ? n : n < 0 ? new FormulaError('#NUM!') : Math.sqrt(n)
  },
  POWER: (a) => {
    const n = toNumber(a[0] as Scalar)
    const e = toNumber(a[1] as Scalar)
    return isErr(n) ? n : isErr(e) ? e : n ** e
  },
  PI: () => Math.PI,
  CONCATENATE: (a) => a.flatMap(flat).map(toText).join(''),
  CONCAT: (a) => a.flatMap(flat).map(toText).join(''),
  LEN: (a) => toText(a[0] as Scalar).length,
  UPPER: (a) => toText(a[0] as Scalar).toUpperCase(),
  LOWER: (a) => toText(a[0] as Scalar).toLowerCase(),
  TRIM: (a) => toText(a[0] as Scalar).trim().replace(/\s+/g, ' '),
  LEFT: (a) => toText(a[0] as Scalar).slice(0, Number(toNumber((a[1] ?? 1) as Scalar)) || 0),
  RIGHT: (a) => {
    const s = toText(a[0] as Scalar)
    const n = Number(toNumber((a[1] ?? 1) as Scalar)) || 0
    return n ? s.slice(-n) : ''
  },
  MID: (a) => {
    const s = toText(a[0] as Scalar)
    const start = Number(toNumber(a[1] as Scalar)) || 1
    const len = Number(toNumber(a[2] as Scalar)) || 0
    return s.substr(start - 1, len)
  },
  TODAY: () => excelDate(new Date()),
  NOW: () => {
    const d = new Date()
    return excelDate(d) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400
  },
  SUMIF: (a) => {
    const range = flat(a[0]!)
    const test = criterion(a[1] as Scalar)
    const sum = a[2] ? flat(a[2]) : range
    let total = 0
    range.forEach((v, i) => {
      if (test(v)) {
        const n = sum[i]
        if (typeof n === 'number') total += n
      }
    })
    return total
  },
  COUNTIF: (a) => {
    const test = criterion(a[1] as Scalar)
    return flat(a[0]!).filter((v) => test(v)).length
  },
  VLOOKUP: (a) => {
    const key = a[0] as Scalar
    const table = a[1]
    const index = Number(toNumber(a[2] as Scalar))
    const approx = a[3] === undefined ? true : toBool(a[3] as Scalar) === true
    if (!Array.isArray(table)) return new FormulaError('#REF!')
    if (!(index >= 1) || index > (table[0]?.length ?? 0)) return new FormulaError('#REF!')
    const eq = (v: Scalar) => (typeof key === 'string' && typeof v === 'string' ? key.toLowerCase() === v.toLowerCase() : v === key)
    if (!approx) {
      const row = table.find((r) => eq(r[0] ?? null))
      return row ? (row[index - 1] ?? null) : new FormulaError('#N/A')
    }
    let best: Scalar[] | null = null
    for (const r of table) {
      const v = r[0]
      if (typeof v === 'number' && typeof key === 'number' ? v <= key : toText(v ?? null).localeCompare(toText(key)) <= 0) best = r
      else break
    }
    return best ? (best[index - 1] ?? null) : new FormulaError('#N/A')
  },
}

export const FUNCTION_NAMES = Object.keys(FNS)

function compare(a: Scalar, b: Scalar): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (a === null && typeof b === 'number') return -b
  if (b === null && typeof a === 'number') return a
  return toText(a).toLowerCase().localeCompare(toText(b).toLowerCase())
}

function evalNode(node: Node, ctx: EvalContext): Value {
  switch (node.k) {
    case 'lit':
      return node.v
    case 'ref':
      return ctx.value(node.col, node.row, node.sheet)
    case 'range': {
      if ((node.r2 - node.r1 + 1) * (node.c2 - node.c1 + 1) > 200000) return new FormulaError('#REF!')
      const rows: Scalar[][] = []
      for (let r = node.r1; r <= node.r2; r++) {
        const row: Scalar[] = []
        for (let c = node.c1; c <= node.c2; c++) row.push(ctx.value(c, r, node.sheet))
        rows.push(row)
      }
      return rows
    }
    case 'un': {
      const v = evalNode(node.a, ctx)
      const n = toNumber(Array.isArray(v) ? (v[0]?.[0] ?? null) : v)
      return isErr(n) ? n : node.op === '-' ? -n : n
    }
    case 'bin': {
      const av = evalNode(node.a, ctx)
      const bv = evalNode(node.b, ctx)
      const a = Array.isArray(av) ? (av[0]?.[0] ?? null) : av
      const b = Array.isArray(bv) ? (bv[0]?.[0] ?? null) : bv
      if (isErr(a)) return a
      if (isErr(b)) return b
      if (node.op === '&') return toText(a) + toText(b)
      if (['=', '<>', '<', '>', '<=', '>='].includes(node.op)) {
        const c = compare(a, b)
        return node.op === '=' ? c === 0 : node.op === '<>' ? c !== 0 : node.op === '<' ? c < 0 : node.op === '>' ? c > 0 : node.op === '<=' ? c <= 0 : c >= 0
      }
      const x = toNumber(a)
      const y = toNumber(b)
      if (isErr(x)) return x
      if (isErr(y)) return y
      if (node.op === '+') return x + y
      if (node.op === '-') return x - y
      if (node.op === '*') return x * y
      if (node.op === '/') return y === 0 ? new FormulaError('#DIV/0!') : x / y
      if (node.op === '^') return x ** y
      return new FormulaError('#VALUE!')
    }
    case 'call': {
      const fn = FNS[node.fn]
      if (!fn) return new FormulaError('#NAME?')
      const ev = (n: Node) => evalNode(n, ctx)
      // IF/IFERROR avaliam só o ramo necessário.
      const lazy = node.fn === 'IF' || node.fn === 'IFERROR'
      const args = lazy ? [] : node.args.map(ev)
      if (!lazy && node.fn !== 'IFERROR') {
        // Erro num argumento simples propaga (intervalos são tratados pela função).
        for (const a of args) if (isErr(a)) return a
      }
      return fn(args, node.args, ev)
    }
  }
}

const cache = new Map<string, Node | FormulaError>()

/** Avalia uma fórmula (sem o "=" inicial). */
export function evaluate(formula: string, ctx: EvalContext): Scalar {
  let tree = cache.get(formula)
  if (!tree) {
    try {
      tree = parse(tokenize(formula))
    } catch (err) {
      tree = err instanceof FormulaError ? err : new FormulaError('#VALUE!')
    }
    if (cache.size > 5000) cache.clear()
    cache.set(formula, tree)
  }
  if (tree instanceof FormulaError) return tree
  const v = evalNode(tree, ctx)
  const out = Array.isArray(v) ? (v[0]?.[0] ?? null) : v
  if (typeof out === 'number' && !Number.isFinite(out)) return new FormulaError('#NUM!')
  return out
}

/**
 * Forma de gravação no .xlsx: funções em inglês e "," como separador.
 * ("=SOMA(A1;A2)" -> "SUM(A1,A2)").
 */
export function toFileFormula(formula: string): string {
  let out = ''
  let i = 0
  while (i < formula.length) {
    const c = formula[i]!
    if (c === '"') {
      const end = formula.indexOf('"', i + 1)
      const stop = end === -1 ? formula.length : end + 1
      out += formula.slice(i, stop)
      i = stop
      continue
    }
    const word = /^[A-Za-zÀ-ÿ_][\wÀ-ÿ.]*(?=\()/.exec(formula.slice(i))
    if (word) {
      out += canonicalFn(word[0])
      i += word[0].length
      continue
    }
    out += c === ';' ? ',' : c
    i++
  }
  return out
}

/** Referências usadas por uma fórmula (para recálculo seletivo). */
export function referencesOf(formula: string): Array<{ c1: number; r1: number; c2: number; r2: number; sheet?: string }> {
  try {
    const out: Array<{ c1: number; r1: number; c2: number; r2: number; sheet?: string }> = []
    const walkNode = (n: Node) => {
      if (n.k === 'ref') out.push({ c1: n.col, r1: n.row, c2: n.col, r2: n.row, sheet: n.sheet })
      else if (n.k === 'range') out.push({ c1: n.c1, r1: n.r1, c2: n.c2, r2: n.r2, sheet: n.sheet })
      else if (n.k === 'un') walkNode(n.a)
      else if (n.k === 'bin') {
        walkNode(n.a)
        walkNode(n.b)
      } else if (n.k === 'call') n.args.forEach(walkNode)
    }
    walkNode(parse(tokenize(formula)))
    return out
  } catch {
    return []
  }
}
