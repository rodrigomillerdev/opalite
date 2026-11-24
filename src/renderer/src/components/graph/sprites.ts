/*
 * Esferas do gráfico, pré-renderizadas. Desenhar gradientes e sombras para
 * cada nó em cada quadro custa caro; em vez disso, cada combinação de cor e
 * intensidade de brilho vira uma pequena imagem (sprite) que é só carimbada
 * com drawImage. Assim o gráfico fica bonito e continua leve com milhares de nós.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

let probe: CanvasRenderingContext2D | null = null

/** Converte qualquer cor CSS que o canvas entenda em RGB. */
export function toRgb(color: string, fallback: Rgb = { r: 160, g: 160, b: 176 }): Rgb {
  probe ??= document.createElement('canvas').getContext('2d')
  if (!probe || !color) return fallback
  probe.fillStyle = '#000'
  probe.fillStyle = color
  const v = String(probe.fillStyle)
  if (v.startsWith('#') && v.length === 7) {
    const n = parseInt(v.slice(1), 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(v)
  return m ? { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) } : fallback
}

export const rgba = (c: Rgb, a: number) => `rgba(${c.r | 0}, ${c.g | 0}, ${c.b | 0}, ${a})`

export const mix = (a: Rgb, b: Rgb, t: number): Rgb => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t })

const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const BLACK: Rgb = { r: 0, g: 0, b: 0 }

/** Tamanho do sprite em px; a esfera ocupa a metade central (o resto é halo). */
const SIZE = 96
const cache = new Map<string, HTMLCanvasElement>()

/**
 * Formas dos nós (todas esferas, como num grafo clássico):
 *   sphere — notas e tags
 *   frame  — canvas: a esfera com um anel interno discreto
 *   ring   — links para notas que ainda não existem (só o contorno)
 */
export type SpriteShape = 'sphere' | 'frame' | 'ring'

/** Contorno circular de um nó de raio r centrado em (x, y), opcionalmente afastado em `grow`. */
export function nodePath(x: number, y: number, r: number, grow = 0): Path2D {
  const path = new Path2D()
  path.arc(x, y, r + grow, 0, Math.PI * 2)
  return path
}

/**
 * Sprite de um nó, num estilo sóbrio: halo curto e suave, corpo com luz
 * discreta vindo do alto à esquerda, uma aresta clara bem fina (como vidro
 * visto de lado) e um reflexo pequeno. Sem sombra projetada. Raio = SIZE/4.
 */
export function nodeSprite(color: Rgb, glow: number, shape: SpriteShape): HTMLCanvasElement {
  const key = `${color.r | 0},${color.g | 0},${color.b | 0}|${glow.toFixed(2)}|${shape}`
  const hit = cache.get(key)
  if (hit) return hit
  if (cache.size > 200) cache.clear()

  const c = document.createElement('canvas')
  c.width = c.height = SIZE
  const ctx = c.getContext('2d')!
  const m = SIZE / 2
  const r = SIZE / 4

  // Halo: curto e baixo, só para o nó "respirar" sobre o fundo.
  if (glow > 0) {
    const halo = ctx.createRadialGradient(m, m, r * 0.9, m, m, r * 1.9)
    halo.addColorStop(0, rgba(color, 0.3 * glow))
    halo.addColorStop(0.5, rgba(color, 0.08 * glow))
    halo.addColorStop(1, rgba(color, 0))
    ctx.fillStyle = halo
    ctx.fillRect(0, 0, SIZE, SIZE)
  }

  const path = nodePath(m, m, r)

  if (shape === 'ring') {
    ctx.lineWidth = r * 0.2
    ctx.strokeStyle = rgba(color, 0.8)
    ctx.stroke(nodePath(m, m, r * 0.9))
    return remember(key, c)
  }

  // Corpo: gradiente contido (sem estourar para o branco).
  const body = ctx.createRadialGradient(m - r * 0.35, m - r * 0.4, r * 0.05, m, m, r)
  body.addColorStop(0, rgba(mix(color, WHITE, 0.3), 1))
  body.addColorStop(0.6, rgba(color, 1))
  body.addColorStop(1, rgba(mix(color, BLACK, 0.22), 1))
  ctx.fillStyle = body
  ctx.fill(path)

  ctx.save()
  ctx.clip(path)
  // Aresta fina: clara em cima, some embaixo.
  const edge = ctx.createLinearGradient(0, m - r, 0, m + r)
  edge.addColorStop(0, 'rgba(255,255,255,0.45)')
  edge.addColorStop(0.55, 'rgba(255,255,255,0.08)')
  edge.addColorStop(1, 'rgba(255,255,255,0.02)')
  ctx.lineWidth = r * 0.12
  ctx.strokeStyle = edge
  ctx.stroke(path)
  if (shape === 'frame') {
    ctx.lineWidth = r * 0.1
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'
    ctx.stroke(nodePath(m, m, r * 0.5))
  }
  ctx.restore()

  // Reflexo pequeno
  const spec = ctx.createRadialGradient(m - r * 0.36, m - r * 0.42, 0, m - r * 0.36, m - r * 0.42, r * 0.3)
  spec.addColorStop(0, 'rgba(255,255,255,0.5)')
  spec.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = spec
  ctx.fill(path)

  return remember(key, c)
}

function remember(key: string, c: HTMLCanvasElement): HTMLCanvasElement {
  cache.set(key, c)
  return c
}

/** Desenha o sprite centrado em (x, y) para um nó de raio r. */
export function stamp(ctx: CanvasRenderingContext2D, sprite: HTMLCanvasElement, x: number, y: number, r: number): void {
  const s = r * 4
  ctx.drawImage(sprite, x - s / 2, y - s / 2, s, s)
}

/** Pontos de fundo para dar profundidade (paralaxe ao arrastar a vista). */
export interface Star {
  x: number
  y: number
  z: number
  a: number
}

export function makeStars(count: number): Star[] {
  const stars: Star[] = []
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  for (let i = 0; i < count; i++) stars.push({ x: rand(), y: rand(), z: 0.08 + rand() * 0.3, a: 0.15 + rand() * 0.45 })
  return stars
}
