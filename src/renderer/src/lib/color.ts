/*
 * Leitura de cores digitadas: #rgb, #rrggbb, rgb(...), hsl(...) e nomes CSS
 * ("teal", "coral"...). O próprio canvas do navegador faz a interpretação.
 */

let ctx: CanvasRenderingContext2D | null = null

export function parseColor(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  if (/^#?[0-9a-f]{6}$/i.test(text)) return `#${text.replace('#', '').toLowerCase()}`
  if (/^#?[0-9a-f]{3}$/i.test(text)) return `#${text.replace('#', '').split('').map((c) => c + c).join('').toLowerCase()}`
  ctx ??= document.createElement('canvas').getContext('2d')
  if (!ctx) return null
  // Duas cores-sentinela: se o valor for inválido, o fillStyle não muda.
  ctx.fillStyle = '#010203'
  ctx.fillStyle = text
  const a = String(ctx.fillStyle)
  ctx.fillStyle = '#030201'
  ctx.fillStyle = text
  const b = String(ctx.fillStyle)
  if (a !== b) return null
  if (/^#[0-9a-f]{6}$/i.test(a)) return a.toLowerCase()
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(a)
  return m ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` : null
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`
