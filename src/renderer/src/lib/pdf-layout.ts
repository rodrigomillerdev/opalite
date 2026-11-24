/*
 * Reconstrução de estrutura a partir do texto posicionado de um PDF
 * (funções puras, testáveis sem pdf.js).
 *
 * Um PDF não guarda "parágrafos" nem "títulos", só pedaços de texto com
 * posição e fonte. As heurísticas abaixo agrupam esses pedaços em linhas,
 * linhas em parágrafos, e reconhecem títulos (fonte maior), listas e negrito.
 */

export interface TextPiece {
  str: string
  x: number
  /** Coordenada y do PDF (cresce para cima). */
  y: number
  width: number
  size: number
  bold: boolean
}

export interface Block {
  type: 'heading1' | 'heading2' | 'heading3' | 'paragraph' | 'bullet' | 'numbered'
  runs: Array<{ text: string; bold: boolean }>
}

interface Line {
  y: number
  x: number
  size: number
  pieces: TextPiece[]
}

function median(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** Agrupa pedaços na mesma altura (tolerância proporcional à fonte) em linhas. */
export function groupLines(pieces: TextPiece[]): Line[] {
  const sorted = pieces.filter((p) => p.str.length > 0).sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: Line[] = []
  for (const p of sorted) {
    const line = lines.find((l) => Math.abs(l.y - p.y) <= Math.max(2, Math.min(l.size, p.size) * 0.45))
    if (line) {
      line.pieces.push(p)
      line.size = Math.max(line.size, p.size)
      line.x = Math.min(line.x, p.x)
    } else {
      lines.push({ y: p.y, x: p.x, size: p.size, pieces: [p] })
    }
  }
  for (const l of lines) l.pieces.sort((a, b) => a.x - b.x)
  return lines.sort((a, b) => b.y - a.y)
}

/** Junta os pedaços de uma linha, inserindo espaço quando há distância entre eles. */
function lineRuns(line: Line): Array<{ text: string; bold: boolean }> {
  const runs: Array<{ text: string; bold: boolean }> = []
  let prevEnd: number | null = null
  for (const p of line.pieces) {
    const gap = prevEnd === null ? 0 : p.x - prevEnd
    const last = runs[runs.length - 1]
    // Espaço entre pedaços distantes, sem duplicar espaços que já existem.
    const needsSpace = prevEnd !== null && gap > p.size * 0.18 && !/^\s/.test(p.str) && !/\s$/.test(last?.text ?? '')
    const text = (needsSpace ? ' ' : '') + p.str
    if (last && last.bold === p.bold) last.text += text
    else runs.push({ text, bold: p.bold })
    prevEnd = p.x + p.width
  }
  return runs
}

const BULLET = /^\s*([•◦▪●○■\-–*])\s+/
const NUMBERED = /^\s*(\d{1,3}[.)]|[a-z][.)])\s+/i

/** Transforma as linhas de uma página em blocos de texto estruturados. */
export function linesToBlocks(lines: Line[], bodySize?: number): Block[] {
  const body = bodySize ?? median(lines.map((l) => l.size))
  const blocks: Block[] = []
  let current: { block: Block; lastY: number; size: number; x: number } | null = null

  for (const line of lines) {
    const runs = lineRuns(line)
    const text = runs.map((r) => r.text).join('').trim()
    if (!text) continue
    const allBold = runs.every((r) => r.bold || !r.text.trim())
    const ratio = line.size / (body || line.size)
    let type: Block['type'] = 'paragraph'
    if (ratio >= 1.55) type = 'heading1'
    else if (ratio >= 1.25) type = 'heading2'
    else if (ratio >= 1.08 && allBold && text.length < 90) type = 'heading3'
    else if (BULLET.test(text)) type = 'bullet'
    else if (NUMBERED.test(text)) type = 'numbered'

    if (type === 'bullet' || type === 'numbered') {
      // Remove o marcador: o Word desenha o seu.
      const marker = (type === 'bullet' ? BULLET : NUMBERED).exec(runs[0]!.text)
      if (marker) runs[0] = { ...runs[0]!, text: runs[0]!.text.slice(marker[0].length) }
    }

    const gap = current ? current.lastY - line.y : 0
    const continues =
      current &&
      type === 'paragraph' &&
      current.block.type === 'paragraph' &&
      gap <= line.size * 1.75 &&
      Math.abs(current.size - line.size) < 1 &&
      // Recuo na primeira linha costuma indicar parágrafo novo.
      line.x - current.x < line.size * 1.5

    const continuesItem =
      current && type === 'paragraph' && (current.block.type === 'bullet' || current.block.type === 'numbered') && gap <= line.size * 1.5 && line.x > current.x

    if ((continues || continuesItem) && current) {
      const last = current.block.runs[current.block.runs.length - 1]!
      // Junta palavras hifenizadas no fim da linha ("compu-" + "tador").
      if (/[A-Za-zÀ-ÿ]-$/.test(last.text)) last.text = last.text.slice(0, -1)
      else runs[0] = { ...runs[0]!, text: ` ${runs[0]!.text.trimStart()}` }
      for (const r of runs) {
        const tail = current.block.runs[current.block.runs.length - 1]!
        if (tail.bold === r.bold) tail.text += r.text
        else current.block.runs.push({ ...r })
      }
      current.lastY = line.y
      continue
    }

    const block: Block = { type, runs: runs.map((r, i) => (i === 0 ? { ...r, text: r.text.trimStart() } : r)) }
    blocks.push(block)
    current = { block, lastY: line.y, size: line.size, x: line.x }
  }
  return blocks
}

/** Tamanho de corpo do documento inteiro (fonte mais comum), para comparar títulos entre páginas. */
export function bodySizeOf(pages: TextPiece[][]): number {
  const counts = new Map<number, number>()
  for (const p of pages.flat()) {
    const k = Math.round(p.size * 2) / 2
    counts.set(k, (counts.get(k) ?? 0) + p.str.length)
  }
  let best = 0
  let bestCount = -1
  for (const [size, c] of counts) if (c > bestCount) [best, bestCount] = [size, c]
  return best
}
