import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import { Maximize, Minus, Plus, RotateCcw, Settings2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphData, GraphNode } from '../../../shared/types'
import { DEFAULT_GRAPH_SETTINGS, type GraphSettings, filterGraph, groupOf } from '../lib/graph-data'
import { useIndex } from '../state/index-store'
import { useVault } from '../state/vault-store'
import { useWorkspace } from '../state/workspace-store'
import styles from './GraphView.module.css'
import { type Rgb, type SpriteShape, makeStars, mix, nodePath, nodeSprite, rgba, stamp, toRgb } from './graph/sprites'

/*
 * Visualização em gráfico. Cada nota é uma "microesfera"; as conexões entre
 * elas formam o jogo de cores do cofre. A posição dos nós vem de uma
 * simulação de forças (d3-force): links puxam, nós se repelem, e uma força
 * leve mantém tudo perto do centro.
 *
 * O desenho é feito num <canvas> 2D com esferas pré-renderizadas (sprites):
 * halo, luz e reflexo custam um drawImage por nó. Um laço de animação só
 * roda enquanto há algo mudando — simulação ativa, foco entrando ou saindo,
 * zoom suave ou o fluxo nas conexões em destaque — e para sozinho depois.
 */

interface SimNode extends SimulationNodeDatum {
  id: string
  data: GraphNode
  degree: number
  radius: number
  /** Animação: quanto o nó está "aceso" (0 = apagado pelo foco em outro). */
  lit: number
  /** Animação: realce de foco/vizinhança (0 = normal, 1 = destacado). */
  hi: number
}

type SimLink = SimulationLinkDatum<SimNode>

interface Palette {
  groups: Rgb[]
  neutral: Rgb
  dim: Rgb
  edge: Rgb
  accent: Rgb
  text: string
  bg: string
  iridescent: string[]
}

function readPalette(s: GraphSettings): Palette {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  return {
    groups: [v('--opal-1'), v('--opal-2'), v('--opal-3'), v('--opal-4'), v('--syn-type'), v('--syn-number'), v('--syn-keyword'), v('--danger')].map((c) => toRgb(c)),
    neutral: toRgb(s.nodeColor || v('--graph-node') || v('--text-2')),
    dim: toRgb(v('--text-3')),
    edge: toRgb(s.linkColor || v('--graph-link') || v('--border-strong')),
    accent: toRgb(s.highlightColor || v('--graph-highlight') || v('--accent')),
    text: v('--text-1'),
    bg: v('--bg-2'),
    iridescent: [v('--opal-1'), v('--opal-2'), v('--opal-3'), v('--opal-4')],
  }
}

const SETTINGS_KEY = (local: boolean) => `opalite:graph-settings${local ? ':local' : ''}`

function loadSettings(local: boolean): GraphSettings {
  try {
    return { ...DEFAULT_GRAPH_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY(local)) ?? '{}') as Partial<GraphSettings>) }
  } catch {
    return DEFAULT_GRAPH_SETTINGS
  }
}

const reducedMotion = () =>
  document.documentElement.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches

const STARS = makeStars(140)

/** Notas e tags são esferas; canvas, esfera com anel interno; links soltos, só o contorno. */
function shapeOf(n: SimNode): SpriteShape {
  if (n.data.kind === 'canvas') return 'frame'
  if (n.data.kind === 'unresolved') return 'ring'
  return 'sphere'
}

export default function GraphView({ local = false }: { local?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const version = useIndex((s) => s.version)
  const activePath = useVault((s) => s.activePath)
  const [data, setData] = useState<GraphData | null>(null)
  const [settings, setSettings] = useState<GraphSettings>(() => loadSettings(local))
  const [panelOpen, setPanelOpen] = useState(false)
  const [stats, setStats] = useState({ nodes: 0, edges: 0 })

  const center = local ? activePath : null

  // Estado mutável da simulação fica em refs: mudar não deve re-renderizar o React.
  const sim = useRef<Simulation<SimNode, SimLink> | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const linksRef = useRef<SimLink[]>([])
  const neighbors = useRef(new Map<string, Set<string>>())
  /** Vista atual e vista-alvo: o zoom anda suavemente de uma para a outra. */
  const view = useRef({ x: 0, y: 0, k: 1 })
  const target = useRef({ x: 0, y: 0, k: 1 })
  const autoFitted = useRef(false)
  const fitRef = useRef<() => void>(() => {})
  const hover = useRef<SimNode | null>(null)
  const pulse = useRef<{ node: SimNode; start: number } | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const palette = useRef<Palette>(readPalette(settings))
  const frame = useRef(0)
  const lastFrame = useRef(0)
  const stepper = useRef(0)
  const restartStepper = useRef<() => void>(() => {})

  // Busca os dados do índice (e de novo quando o cofre muda).
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      window.opalite.index
        .graph()
        .then((d) => !cancelled && setData(d))
        .catch(() => !cancelled && setData({ nodes: [], edges: [] }))
    }, data ? 900 : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY(local), JSON.stringify(settings))
    } catch {
      // sem armazenamento
    }
  }, [settings, local])

  const filtered = useMemo(
    () => (data ? filterGraph(data, settings, center) : null),
    // Forças e aparência não mudam quais nós existem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, settings.search, settings.showTags, settings.showUnresolved, settings.showOrphans, settings.showCanvas, settings.depth, center],
  )

  const activePathRef = useRef(activePath)
  activePathRef.current = activePath

  // ------------------------------------------------------------ desenho

  /** Desenha um quadro. Devolve true se ainda há animação em andamento. */
  const draw = useCallback((now: number): boolean => {
    const canvas = canvasRef.current
    if (!canvas) return false
    const ctx = canvas.getContext('2d')
    if (!ctx) return false
    const dt = Math.min(64, lastFrame.current ? now - lastFrame.current : 16)
    lastFrame.current = now
    const still = reducedMotion()
    const ease = still ? 1 : 1 - Math.exp(-dt / 70)
    let busy = false

    // Zoom e enquadramento suaves
    const v = view.current
    const t = target.current
    const dk = t.k - v.k
    const dx = t.x - v.x
    const dy = t.y - v.y
    if (Math.abs(dk) > 0.0005 || Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
      const zf = still ? 1 : 1 - Math.exp(-dt / 90)
      v.k += dk * zf
      v.x += dx * zf
      v.y += dy * zf
      busy = true
    } else {
      v.k = t.k
      v.x = t.x
      v.y = t.y
    }

    const dpr = window.devicePixelRatio || 1
    const { x, y, k } = v
    const p = palette.current
    const s = settingsRef.current
    const w = canvas.width / dpr
    const h = canvas.height / dpr
    const inv = 1 / Math.max(k, 0.6)

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    // Fundo com profundidade: pontos que andam menos que o primeiro plano.
    if (s.stars && !local) {
      ctx.fillStyle = rgba(p.neutral, 1)
      for (const st of STARS) {
        const sx = (((st.x * w + x * st.z) % w) + w) % w
        const sy = (((st.y * h + y * st.z) % h) + h) % h
        ctx.globalAlpha = st.a * 0.35
        ctx.fillRect(sx, sy, 1.2, 1.2)
      }
      ctx.globalAlpha = 1
    }

    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (x + w / 2), dpr * (y + h / 2))

    const focus = hover.current
    const near = focus ? neighbors.current.get(focus.id) : null

    // Animação de foco: cada nó caminha para o seu alvo de "aceso" e "realce".
    for (const n of nodesRef.current) {
      const litT = !focus || n === focus || near?.has(n.id) ? 1 : 0.14
      const hiT = focus && (n === focus || near?.has(n.id)) ? (n === focus ? 1 : 0.6) : 0
      n.lit += (litT - n.lit) * ease
      n.hi += (hiT - n.hi) * ease
      if (Math.abs(litT - n.lit) > 0.004 || Math.abs(hiT - n.hi) > 0.004) busy = true
    }

    // Grupos -> cores, em ordem alfabética para ficarem estáveis.
    const groups = [...new Set(nodesRef.current.map((n) => groupOf(n.data, s.colorBy)).filter(Boolean))].sort()
    const colorOf = (n: SimNode): Rgb => {
      if (n.data.kind === 'unresolved') return p.dim
      if (n.data.kind === 'tag') return p.groups[1]!
      const g = groupOf(n.data, s.colorBy)
      return g ? p.groups[groups.indexOf(g) % p.groups.length]! : p.neutral
    }

    // Área visível em coordenadas do gráfico (para não desenhar o que está fora).
    const left = (-w / 2 - x) / k - 60
    const right = (w / 2 - x) / k + 60
    const top = (-h / 2 - y) / k - 60
    const bottom = (h / 2 - y) / k + 60
    const visible = (n: SimNode) => n.x! > left && n.x! < right && n.y! > top && n.y! < bottom

    // Conexões: primeiro as comuns, por cima as do foco (com brilho e fluxo).
    ctx.lineCap = 'round'
    ctx.lineWidth = s.linkWidth * inv
    const baseAlpha = focus ? 0.12 : 0.55
    ctx.strokeStyle = rgba(p.edge, baseAlpha)
    ctx.beginPath()
    const lit: SimLink[] = []
    for (const link of linksRef.current) {
      const a = link.source as SimNode
      const b = link.target as SimNode
      if (focus && (a === focus || b === focus)) {
        lit.push(link)
        continue
      }
      if (!visible(a) && !visible(b)) continue
      ctx.moveTo(a.x!, a.y!)
      ctx.lineTo(b.x!, b.y!)
    }
    ctx.stroke()

    if (lit.length) {
      const fade = focus ? Math.min(1, focus.hi) : 0
      // Halo da conexão
      ctx.strokeStyle = rgba(p.accent, 0.18 * fade)
      ctx.lineWidth = s.linkWidth * 5 * inv
      ctx.beginPath()
      for (const l of lit) {
        ctx.moveTo((l.source as SimNode).x!, (l.source as SimNode).y!)
        ctx.lineTo((l.target as SimNode).x!, (l.target as SimNode).y!)
      }
      ctx.stroke()
      ctx.strokeStyle = rgba(p.accent, 0.85 * fade)
      ctx.lineWidth = s.linkWidth * 1.5 * inv
      ctx.stroke()
      // Fluxo: traços claros correndo do nó em foco para os vizinhos.
      if (s.motion && !still) {
        ctx.save()
        ctx.setLineDash([3 * inv, 11 * inv])
        ctx.lineDashOffset = (-now / 40) * inv
        ctx.strokeStyle = rgba(mix(p.accent, { r: 255, g: 255, b: 255 }, 0.6), 0.9 * fade)
        ctx.lineWidth = s.linkWidth * 1.6 * inv
        ctx.beginPath()
        for (const l of lit) {
          const a = l.source as SimNode
          const b = l.target as SimNode
          const [from, to] = a === focus ? [a, b] : [b, a]
          ctx.moveTo(from.x!, from.y!)
          ctx.lineTo(to.x!, to.y!)
        }
        ctx.stroke()
        ctx.restore()
        busy = true
      }
    }

    // Nós
    const glow = s.glow
    for (const n of nodesRef.current) {
      if (!visible(n)) continue
      const color = colorOf(n)
      const r = n.radius * (1 + 0.28 * n.hi)
      ctx.globalAlpha = n.lit
      const shape = shapeOf(n)
      // Em destaque, o halo cresce (sprite com mais brilho).
      const g = Math.min(1, glow + 0.35 * n.hi)
      stamp(ctx, nodeSprite(n.hi > 0.05 ? mix(color, p.accent, 0.15 * n.hi) : color, Math.round(g * 10) / 10, shape), n.x!, n.y!, r)

      // Nota atual ou em foco: borda iridescente em volta da esfera,
      // com um brilho difuso por baixo. No foco, as cores giram devagar.
      if (n.id === activePathRef.current || n === focus) {
        const angle = n === focus && s.motion && !still ? now / 1400 : Math.PI / 4
        const dx = Math.cos(angle) * r
        const dy = Math.sin(angle) * r
        const ring = ctx.createLinearGradient(n.x! - dx, n.y! - dy, n.x! + dx, n.y! + dy)
        p.iridescent.forEach((c, i) => ring.addColorStop(i / (p.iridescent.length - 1), c))
        const outline = nodePath(n.x!, n.y!, r, 3.5 * inv)
        ctx.strokeStyle = ring
        ctx.globalAlpha = n.lit * 0.3
        ctx.lineWidth = 5 * inv
        ctx.stroke(outline)
        ctx.globalAlpha = n.lit
        ctx.lineWidth = 1.8 * inv
        ctx.stroke(outline)
        if (n === focus && s.motion && !still) busy = true
      }
    }
    ctx.globalAlpha = 1

    // Pulso ao clicar: um anel que se expande e some.
    if (pulse.current) {
      const { node, start } = pulse.current
      const age = (now - start) / 520
      if (age >= 1 || still) pulse.current = null
      else {
        ctx.strokeStyle = rgba(p.accent, 0.7 * (1 - age))
        ctx.lineWidth = 2 * inv
        ctx.stroke(nodePath(node.x!, node.y!, node.radius, 4 + age * 26 * inv))
        busy = true
      }
    }

    // Nomes: aparecem com zoom suficiente, ou no nó em foco e vizinhos.
    const fontSize = 12 * (1 / Math.max(k, 0.55))
    ctx.font = `500 ${fontSize}px ${getComputedStyle(document.body).fontFamily}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 3 * inv
    ctx.strokeStyle = p.bg
    const zoomAlpha = Math.max(0, Math.min(1, (k - s.labelZoom) / 0.35 + 0.5))
    for (const n of nodesRef.current) {
      if (!visible(n)) continue
      const alpha = Math.max(n.hi > 0.05 ? n.hi + 0.3 : 0, zoomAlpha * n.lit)
      if (alpha < 0.03) continue
      ctx.globalAlpha = Math.min(1, alpha)
      const ringed = n.id === activePathRef.current || n === focus
      const ty = n.y! + n.radius * (1 + 0.28 * n.hi) + (ringed ? 9 : 5) * inv
      ctx.strokeText(n.data.label, n.x!, ty)
      ctx.fillStyle = n === focus ? rgba(p.accent, 1) : p.text
      ctx.fillText(n.data.label, n.x!, ty)
    }
    ctx.globalAlpha = 1
    return busy
  }, [local])

  /** Laço de animação: roda enquanto houver algo mudando e para sozinho. */
  const tick = useCallback(
    (now: number) => {
      frame.current = 0
      const busy = draw(now)
      if (busy) frame.current = requestAnimationFrame(tick)
      else lastFrame.current = 0
    },
    [draw],
  )

  const requestDraw = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(tick)
  }, [tick])

  // ------------------------------------------------------------ simulação

  useEffect(() => {
    if (!filtered) return
    const previous = new Map(nodesRef.current.map((n) => [n.id, n]))
    const degree = new Map<string, number>()
    for (const e of filtered.edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
    }
    const s = settingsRef.current
    const nodes: SimNode[] = filtered.nodes.map((d) => {
      const old = previous.get(d.id)
      const deg = degree.get(d.id) ?? 0
      return {
        id: d.id,
        data: d,
        degree: deg,
        radius: (3.5 + Math.sqrt(deg) * 1.9) * s.nodeSize * (d.kind === 'tag' ? 0.8 : 1),
        x: old?.x ?? (Math.random() - 0.5) * 300,
        y: old?.y ?? (Math.random() - 0.5) * 300,
        vx: old?.vx,
        vy: old?.vy,
        lit: old?.lit ?? 1,
        hi: old?.hi ?? 0,
      }
    })
    const links: SimLink[] = filtered.edges.map((e) => ({ source: e.source, target: e.target }))
    const nb = new Map<string, Set<string>>()
    for (const e of filtered.edges) {
      if (!nb.has(e.source)) nb.set(e.source, new Set())
      if (!nb.has(e.target)) nb.set(e.target, new Set())
      nb.get(e.source)!.add(e.target)
      nb.get(e.target)!.add(e.source)
    }
    nodesRef.current = nodes
    linksRef.current = links
    neighbors.current = nb
    setStats({ nodes: nodes.length, edges: links.length })

    sim.current?.stop()
    const simulation = forceSimulation<SimNode, SimLink>(nodes)
      .force('link', forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(s.linkDistance).strength(0.6))
      .force('charge', forceManyBody<SimNode>().strength(-140 * s.repel).distanceMax(600))
      .force('x', forceX<SimNode>(0).strength(s.centerForce))
      .force('y', forceY<SimNode>(0).strength(s.centerForce))
      .force('collide', forceCollide<SimNode>((d) => d.radius + 6))
      .alpha(previous.size ? 0.5 : 1)
      .stop()
    // A simulação avança dentro do nosso laço de animação (um único rAF).
    simulation.on('tick', null)
    sim.current = simulation
    const step = () => {
      if (sim.current !== simulation) return
      if (simulation.alpha() > simulation.alphaMin()) {
        simulation.tick()
        // Na primeira montagem, enquadra tudo quando a simulação quase assentou
        // (a menos que a pessoa já tenha mexido no zoom ou arrastado a vista).
        if (!autoFitted.current && simulation.alpha() < 0.12) {
          autoFitted.current = true
          fitRef.current()
        }
      }
      stepper.current = requestAnimationFrame(step)
      requestDraw()
      if (simulation.alpha() <= simulation.alphaMin()) {
        cancelAnimationFrame(stepper.current)
        stepper.current = 0
      }
    }
    restartStepper.current = () => {
      if (!stepper.current) stepper.current = requestAnimationFrame(step)
    }
    restartStepper.current()
    return () => {
      simulation.stop()
      cancelAnimationFrame(stepper.current)
      stepper.current = 0
    }
  }, [filtered, requestDraw])

  /** Reaquece a simulação (forças mudaram, nó arrastado...). */
  const reheat = useCallback((alpha: number, alphaTarget?: number) => {
    const simulation = sim.current
    if (!simulation) return
    if (alphaTarget !== undefined) simulation.alphaTarget(alphaTarget)
    simulation.alpha(Math.max(simulation.alpha(), alpha))
    restartStepper.current()
  }, [])

  // Forças mudaram: reaplica e reaquece a simulação sem recriar os nós.
  useEffect(() => {
    const simulation = sim.current
    if (!simulation) return
    const link = simulation.force('link') as ReturnType<typeof forceLink<SimNode, SimLink>> | undefined
    link?.distance(settings.linkDistance)
    ;(simulation.force('charge') as ReturnType<typeof forceManyBody<SimNode>> | undefined)?.strength(-140 * settings.repel)
    ;(simulation.force('x') as ReturnType<typeof forceX<SimNode>> | undefined)?.strength(settings.centerForce)
    ;(simulation.force('y') as ReturnType<typeof forceY<SimNode>> | undefined)?.strength(settings.centerForce)
    for (const n of nodesRef.current) {
      n.radius = (3.5 + Math.sqrt(n.degree) * 1.9) * settings.nodeSize * (n.data.kind === 'tag' ? 0.8 : 1)
    }
    simulation.force('collide', forceCollide<SimNode>((d) => d.radius + 6))
    reheat(0.4)
  }, [settings.linkDistance, settings.repel, settings.centerForce, settings.nodeSize, reheat])

  // Cores e aparência
  useEffect(() => {
    palette.current = readPalette(settings)
    requestDraw()
  }, [settings.nodeColor, settings.linkColor, settings.highlightColor, settings, requestDraw])

  useEffect(() => requestDraw(), [activePath, requestDraw])

  // Tamanho do canvas acompanha o painel; tema muda as cores.
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, wrap.clientWidth * dpr)
      canvas.height = Math.max(1, wrap.clientHeight * dpr)
      canvas.style.width = `${wrap.clientWidth}px`
      canvas.style.height = `${wrap.clientHeight}px`
      requestDraw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    resize()
    const onTheme = () => {
      // O tema é aplicado no <html>; lê as novas cores no próximo quadro.
      requestAnimationFrame(() => {
        palette.current = readPalette(settingsRef.current)
        requestDraw()
      })
    }
    window.addEventListener('opalite:theme', onTheme)
    return () => {
      observer.disconnect()
      window.removeEventListener('opalite:theme', onTheme)
      if (frame.current) cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [requestDraw])

  // ------------------------------------------------------------ interação

  const toGraph = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const { x, y, k } = view.current
    return { gx: (clientX - rect.left - rect.width / 2 - x) / k, gy: (clientY - rect.top - rect.height / 2 - y) / k }
  }

  const nodeAt = (clientX: number, clientY: number): SimNode | null => {
    const { gx, gy } = toGraph(clientX, clientY)
    const slack = 4 / view.current.k
    let best: SimNode | null = null
    let bestDist = Infinity
    for (const n of nodesRef.current) {
      const d = Math.hypot(n.x! - gx, n.y! - gy)
      if (d < n.radius + slack && d < bestDist) {
        best = n
        bestDist = d
      }
    }
    return best
  }

  const fit = useCallback(() => {
    const nodes = nodesRef.current
    const canvas = canvasRef.current
    if (!nodes.length || !canvas) return
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const n of nodes) {
      minX = Math.min(minX, n.x!)
      maxX = Math.max(maxX, n.x!)
      minY = Math.min(minY, n.y!)
      maxY = Math.max(maxY, n.y!)
    }
    const rect = canvas.getBoundingClientRect()
    const k = Math.min(3, Math.max(0.15, Math.min(rect.width / (maxX - minX + 120), rect.height / (maxY - minY + 120))))
    target.current = { k, x: -((minX + maxX) / 2) * k, y: -((minY + maxY) / 2) * k }
    requestDraw()
  }, [requestDraw])
  fitRef.current = fit

  /** Zoom pelos botões/atalhos, ancorado no centro da vista. */
  const zoomBy = (factor: number) => {
    autoFitted.current = true
    const t = target.current
    const nextK = Math.min(6, Math.max(0.08, t.k * factor))
    target.current = { k: nextK, x: (t.x * nextK) / t.k, y: (t.y * nextK) / t.k }
    requestDraw()
  }

  const open = (n: SimNode, newTab: boolean) => {
    const vault = useVault.getState()
    if (n.data.kind === 'tag') {
      if (!vault.sidebarOpen) vault.toggleSidebar()
      useWorkspace.getState().search(`tag:${n.data.tags[0] ?? ''}`)
    } else if (n.data.kind === 'unresolved') {
      void vault.openLink(n.data.label, null, { newTab })
    } else {
      void vault.openFile(n.id, { newTab })
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    autoFitted.current = true
    if (e.button !== 0) return
    const canvas = canvasRef.current!
    canvas.setPointerCapture(e.pointerId)
    const node = nodeAt(e.clientX, e.clientY)
    const start = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y }
    let moved = false

    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 3) moved = true
      if (node) {
        const { gx, gy } = toGraph(ev.clientX, ev.clientY)
        node.fx = gx
        node.fy = gy
        reheat(0.25, 0.25)
      } else {
        view.current.x = target.current.x = start.vx + ev.clientX - start.x
        view.current.y = target.current.y = start.vy + ev.clientY - start.y
        requestDraw()
      }
    }
    const onUp = (ev: PointerEvent) => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      if (node) {
        node.fx = null
        node.fy = null
        sim.current?.alphaTarget(0)
        if (!moved) {
          pulse.current = { node, start: performance.now() }
          requestDraw()
          open(node, ev.ctrlKey || ev.metaKey)
        }
      }
    }
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
  }

  const onHoverMove = (e: React.PointerEvent) => {
    if (e.buttons) return
    const node = nodeAt(e.clientX, e.clientY)
    if (node !== hover.current) {
      hover.current = node
      canvasRef.current!.style.cursor = node ? 'pointer' : 'grab'
      requestDraw()
    }
  }

  const onWheel = (e: React.WheelEvent) => {
    autoFitted.current = true
    const rect = canvasRef.current!.getBoundingClientRect()
    const { x, y, k } = target.current
    const nextK = Math.min(6, Math.max(0.08, k * Math.exp(-e.deltaY * 0.0018)))
    // Zoom ancorado no ponteiro: o ponto sob o mouse fica parado.
    const px = e.clientX - rect.left - rect.width / 2
    const py = e.clientY - rect.top - rect.height / 2
    target.current = { k: nextK, x: px - ((px - x) * nextK) / k, y: py - ((py - y) * nextK) / k }
    requestDraw()
  }

  /** Duplo clique num nó aproxima a vista dele; no fundo, enquadra tudo. */
  const onDoubleClick = (e: React.MouseEvent) => {
    const node = nodeAt(e.clientX, e.clientY)
    if (!node) return fit()
    const k = Math.max(target.current.k, 1.8)
    target.current = { k, x: -node.x! * k, y: -node.y! * k }
    requestDraw()
  }

  const update = (patch: Partial<GraphSettings>) => setSettings((s) => ({ ...s, ...patch }))

  return (
    <div ref={wrapRef} className={styles.wrap} data-local={local || undefined}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        onPointerDown={onPointerDown}
        onPointerMove={onHoverMove}
        onPointerLeave={() => {
          hover.current = null
          requestDraw()
        }}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        aria-label={local ? 'Gráfico local da nota' : 'Visualização em gráfico do cofre'}
        role="img"
      />

      {local && !center && <div className={styles.emptyHint}>Abra uma nota para ver as conexões dela.</div>}
      {data && stats.nodes === 0 && (!local || center) && (
        <div className={styles.emptyHint}>{settings.search ? 'Nenhuma nota corresponde à busca.' : 'Nenhuma nota para mostrar.'}</div>
      )}

      <div className={styles.controls}>
        <button className={styles.control} onClick={() => setPanelOpen((v) => !v)} title="Configurações do gráfico" aria-label="Configurações do gráfico" aria-pressed={panelOpen}>
          <Settings2 size={16} strokeWidth={1.75} />
        </button>
        <button className={styles.control} onClick={fit} title="Enquadrar tudo (duplo clique no fundo)" aria-label="Enquadrar tudo">
          <Maximize size={15} strokeWidth={1.75} />
        </button>
        <button className={styles.control} onClick={() => zoomBy(1.3)} title="Aproximar" aria-label="Aproximar">
          <Plus size={15} strokeWidth={1.75} />
        </button>
        <button className={styles.control} onClick={() => zoomBy(1 / 1.3)} title="Afastar" aria-label="Afastar">
          <Minus size={15} strokeWidth={1.75} />
        </button>
      </div>

      {!local && (
        <div className={styles.stats}>
          {stats.nodes} {stats.nodes === 1 ? 'nó' : 'nós'} · {stats.edges} {stats.edges === 1 ? 'conexão' : 'conexões'}
        </div>
      )}

      {panelOpen && (
        <div className={styles.panel} role="dialog" aria-label="Configurações do gráfico">
          <div className={styles.panelHeader}>
            <span>Gráfico</span>
            <div>
              <button className={styles.iconBtn} onClick={() => setSettings(DEFAULT_GRAPH_SETTINGS)} title="Restaurar padrões" aria-label="Restaurar padrões">
                <RotateCcw size={13} strokeWidth={1.75} />
              </button>
              <button className={styles.iconBtn} onClick={() => setPanelOpen(false)} aria-label="Fechar">
                <X size={14} strokeWidth={1.75} />
              </button>
            </div>
          </div>

          <section className={styles.section}>
            <h3>Filtros</h3>
            <input
              className={styles.search}
              placeholder="Buscar arquivos…"
              value={settings.search}
              onChange={(e) => update({ search: e.target.value })}
              spellCheck={false}
            />
            <Toggle label="Tags" value={settings.showTags} onChange={(v) => update({ showTags: v })} />
            <Toggle label="Notas ainda não criadas" value={settings.showUnresolved} onChange={(v) => update({ showUnresolved: v })} />
            <Toggle label="Canvas" value={settings.showCanvas} onChange={(v) => update({ showCanvas: v })} />
            {!local && <Toggle label="Notas sem conexões" value={settings.showOrphans} onChange={(v) => update({ showOrphans: v })} />}
            {local && <Slider label="Profundidade" min={1} max={4} step={1} value={settings.depth} onChange={(v) => update({ depth: v })} />}
          </section>

          <section className={styles.section}>
            <h3>Grupos</h3>
            <div className={styles.segmented} role="radiogroup" aria-label="Colorir por">
              {(
                [
                  ['folder', 'Pasta'],
                  ['tag', 'Tag'],
                  ['none', 'Nenhum'],
                ] as const
              ).map(([value, label]) => (
                <button key={value} role="radio" aria-checked={settings.colorBy === value} data-on={settings.colorBy === value || undefined} onClick={() => update({ colorBy: value })}>
                  {label}
                </button>
              ))}
            </div>
            <Legend nodes={nodesRef.current} colorBy={settings.colorBy} palette={palette.current} version={stats.nodes} />
          </section>

          <section className={styles.section}>
            <h3>Exibição</h3>
            <Slider label="Tamanho dos nós" min={0.5} max={2.5} step={0.1} value={settings.nodeSize} onChange={(v) => update({ nodeSize: v })} />
            <Slider label="Espessura das conexões" min={0.3} max={3} step={0.1} value={settings.linkWidth} onChange={(v) => update({ linkWidth: v })} />
            <Slider label="Nomes a partir do zoom" min={0.2} max={2.5} step={0.1} value={settings.labelZoom} onChange={(v) => update({ labelZoom: v })} />
            <Slider label="Brilho dos nós" min={0} max={1} step={0.05} value={settings.glow} onChange={(v) => update({ glow: v })} />
            <Toggle label="Fluxo nas conexões em foco" value={settings.motion} onChange={(v) => update({ motion: v })} />
            {!local && <Toggle label="Fundo com profundidade" value={settings.stars} onChange={(v) => update({ stars: v })} />}
          </section>

          <section className={styles.section}>
            <h3>Cores</h3>
            <ColorRow label="Nós" value={settings.nodeColor} onChange={(v) => update({ nodeColor: v })} />
            <ColorRow label="Conexões" value={settings.linkColor} onChange={(v) => update({ linkColor: v })} />
            <ColorRow label="Destaque" value={settings.highlightColor} onChange={(v) => update({ highlightColor: v })} />
          </section>

          <section className={styles.section}>
            <h3>Forças</h3>
            <Slider label="Repulsão" min={0.2} max={4} step={0.1} value={settings.repel} onChange={(v) => update({ repel: v })} />
            <Slider label="Distância das conexões" min={20} max={250} step={5} value={settings.linkDistance} onChange={(v) => update({ linkDistance: v })} />
            <Slider label="Centralização" min={0} max={0.3} step={0.01} value={settings.centerForce} onChange={(v) => update({ centerForce: v })} />
          </section>
        </div>
      )}
    </div>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange(v: boolean): void }) {
  return (
    <label className={styles.toggle}>
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span className={styles.switch} aria-hidden="true" />
    </label>
  )
}

function Slider(props: { label: string; min: number; max: number; step: number; value: number; onChange(v: number): void }) {
  return (
    <label className={styles.slider}>
      <span>{props.label}</span>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
    </label>
  )
}

/** Cor própria com volta ao tema (valor vazio = cor do tema). */
function ColorRow({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  return (
    <div className={styles.colorRow}>
      <span>{label}</span>
      <div>
        {value && (
          <button className={styles.linkBtn} onClick={() => onChange('')} title="Voltar à cor do tema">
            tema
          </button>
        )}
        <label className={styles.swatch} style={{ background: value || 'transparent' }} data-auto={!value || undefined} title={value || 'Cor do tema'}>
          <input type="color" value={value || '#9a96c8'} onChange={(e) => onChange(e.target.value)} aria-label={`Cor: ${label}`} />
        </label>
      </div>
    </div>
  )
}

function Legend({ nodes, colorBy, palette }: { nodes: SimNode[]; colorBy: GraphSettings['colorBy']; palette: Palette; version: number }) {
  if (colorBy === 'none') return null
  const groups = [...new Set(nodes.map((n) => groupOf(n.data, colorBy)).filter(Boolean))].sort()
  if (!groups.length) return <p className={styles.legendEmpty}>{colorBy === 'folder' ? 'Todas as notas estão na raiz.' : 'Nenhuma tag nas notas visíveis.'}</p>
  return (
    <ul className={styles.legend}>
      {groups.slice(0, 12).map((g, i) => (
        <li key={g}>
          <span className={styles.dot} style={{ background: rgba(palette.groups[i % palette.groups.length]!, 1) }} />
          {colorBy === 'tag' ? `#${g}` : g}
        </li>
      ))}
      {groups.length > 12 && <li className={styles.legendMore}>+{groups.length - 12} grupos</li>}
    </ul>
  )
}
