import { describe, expect, it } from 'vitest'
import { anchor, bestSides, colorCss, edgePath, nearestSide, nodesInside, parseCanvas, serializeCanvas } from './canvas'
import { renderMiniMarkdown } from './mini-markdown'

describe('parseCanvas', () => {
  it('lê o formato JSON Canvas e ignora itens inválidos', () => {
    const data = parseCanvas(
      JSON.stringify({
        nodes: [
          { id: 'a', type: 'text', text: 'Olá', x: 0, y: 0, width: 200, height: 80, color: '4' },
          { id: 'b', type: 'file', file: 'Notas/X.md', x: 300, y: 0, width: 200, height: 200 },
          { id: 'c', type: 'misterioso' },
          { type: 'text', text: 'sem id' },
          { id: 'd', type: 'file' },
        ],
        edges: [
          { id: 'e1', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left' },
          { id: 'e2', fromNode: 'a', toNode: 'fantasma' },
        ],
      }),
    )
    expect(data.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(data.extra?.nodes).toEqual([{ id: 'c', type: 'misterioso' }])
    expect(data.nodes[0]).toMatchObject({ type: 'text', text: 'Olá', color: '4' })
    expect(data.edges).toEqual([{ id: 'e1', fromNode: 'a', fromSide: 'right', toNode: 'b', toSide: 'left' }])
  })

  it('aceita arquivo vazio e rejeita JSON quebrado', () => {
    expect(parseCanvas('')).toEqual({ nodes: [], edges: [] })
    expect(() => parseCanvas('{')).toThrow(/JSON/)
  })

  it('preserva campos e nós que o Opalite não conhece', () => {
    const original = { version: '1.0', nodes: [{ id: 'g', type: 'group', label: 'G', x: 0, y: 0, width: 10, height: 10, background: 'bg.png', backgroundStyle: 'cover' }, { id: 'z', type: 'futuro', x: 1 }], edges: [] as unknown[] }
    const round = JSON.parse(serializeCanvas(parseCanvas(JSON.stringify(original))))
    expect(round.version).toBe('1.0')
    expect(round.nodes.find((n: { id: string }) => n.id === 'g')).toMatchObject({ background: 'bg.png', backgroundStyle: 'cover', label: 'G' })
    expect(round.nodes.find((n: { id: string }) => n.id === 'z')).toEqual({ id: 'z', type: 'futuro', x: 1 })
  })

  it('ida e volta preserva os dados', () => {
    const data = parseCanvas('{"nodes":[{"id":"g","type":"group","label":"Ideias","x":1,"y":2,"width":3,"height":4}],"edges":[]}')
    expect(parseCanvas(serializeCanvas(data))).toEqual(data)
  })
})

describe('geometria', () => {
  const a = { id: 'a', x: 0, y: 0, width: 100, height: 50 }
  const b = { id: 'b', x: 300, y: 10, width: 100, height: 50 }

  it('calcula âncoras e o lado mais próximo', () => {
    expect(anchor(a, 'right')).toEqual({ x: 100, y: 25 })
    expect(nearestSide(a, 50, -30)).toBe('top')
    expect(bestSides(a, b)).toEqual(['right', 'left'])
  })

  it('gera um caminho SVG cúbico', () => {
    expect(edgePath({ x: 0, y: 0 }, 'right', { x: 100, y: 0 }, 'left')).toMatch(/^M 0 0 C /)
  })

  it('encontra nós dentro de um grupo', () => {
    const group = { id: 'g', type: 'group' as const, x: -10, y: -10, width: 200, height: 100 }
    expect(nodesInside(group, [group, { ...a, type: 'text', text: '' }, { ...b, type: 'text', text: '' }]).map((n) => n.id)).toEqual(['a'])
  })

  it('traduz cores do formato', () => {
    expect(colorCss('1')).toBe('#e5655f')
    expect(colorCss('#123456')).toBe('#123456')
    expect(colorCss(undefined)).toBeNull()
  })
})

describe('renderMiniMarkdown', () => {
  it('escapa HTML antes de formatar', () => {
    expect(renderMiniMarkdown('<script>x</script> **a**')).toBe('<p>&lt;script&gt;x&lt;/script&gt; <strong>a</strong></p>')
  })

  it('converte títulos, listas, tarefas e links', () => {
    const html = renderMiniMarkdown('# T\n- um\n- [x] feito\n[[Nota|apelido]] e [site](https://ex.com)')
    expect(html).toBe(
      '<h2>T</h2><ul><li>um</li><li class="task done">feito</li></ul><p><a data-link="Nota">apelido</a> e <a data-url="https://ex.com">site</a></p>',
    )
  })

  it('não interpreta nada dentro de blocos de código', () => {
    expect(renderMiniMarkdown('```\n**x** <b>\n```')).toBe('<pre><code>**x** &lt;b&gt;\n</code></pre>')
  })
})
