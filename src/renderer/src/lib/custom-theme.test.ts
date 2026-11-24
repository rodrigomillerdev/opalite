import { describe, expect, it } from 'vitest'
import { DEFAULT_CUSTOM, applyHarmony, customTokens, hexToHsl, hexToPoint, hslToHex, pointToHex, resolveMode } from './custom-theme'

/** Luminância relativa (WCAG) para checar contraste. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

describe('conversão de cores', () => {
  it('HSL <-> hex ida e volta', () => {
    expect(hslToHex({ h: 0, s: 1, l: 0.5 })).toBe('#ff0000')
    expect(hslToHex({ h: 120, s: 1, l: 0.25 })).toBe('#008000')
    const back = hexToHsl('#3f7fe0')
    expect(hslToHex(back)).toBe('#3f7fe0')
  })

  it('posição no campo <-> cor mantém a matiz', () => {
    const p = hexToPoint('#5ce8ae')
    expect(Math.abs(hexToHsl(pointToHex(p)).h - hexToHsl('#5ce8ae').h)).toBeLessThan(3)
  })
})

describe('harmonias', () => {
  it('complementar fica do lado oposto do círculo', () => {
    const [, second] = applyHarmony([{ x: 0.1, y: 0.3 }, { x: 0, y: 0 }], 'complementary')
    expect(second!.x).toBeCloseTo(0.6)
  })

  it('não mexe numa cor única', () => {
    expect(applyHarmony([{ x: 0.2, y: 0.2 }], 'triad')).toEqual([{ x: 0.2, y: 0.2 }])
  })
})

describe('customTokens', () => {
  it('gera todas as variáveis esperadas', () => {
    const t = customTokens(DEFAULT_CUSTOM, true)
    for (const key of ['--bg-0', '--bg-2', '--text-0', '--accent', '--opal-1', '--opal-4', '--syn-keyword', '--texture']) expect(t[key]).toBeTruthy()
  })

  it('mantém o texto legível (contraste AA) em claro e escuro, com qualquer cor', () => {
    for (const x of [0, 0.15, 0.33, 0.5, 0.7, 0.9]) {
      for (const mode of ['dark', 'light'] as const) {
        const t = customTokens({ ...DEFAULT_CUSTOM, mode, intensity: 1, colors: [{ x, y: 0 }] }, true)
        expect(contrast(t['--text-0']!, t['--bg-2']!)).toBeGreaterThan(7)
        expect(contrast(t['--text-1']!, t['--bg-2']!)).toBeGreaterThan(4.5)
      }
    }
  })

  it('modo automático segue o sistema', () => {
    expect(resolveMode('auto', true)).toBe('dark')
    expect(resolveMode('auto', false)).toBe('light')
    expect(customTokens({ ...DEFAULT_CUSTOM, mode: 'auto' }, false)['color-scheme']).toBe('light')
  })
})

describe('estúdio de temas', () => {
  it('aplica cores por elemento e ignora variáveis não editáveis', async () => {
    const { customTokens, DEFAULT_CUSTOM } = await import('./custom-theme')
    const t = customTokens({ ...DEFAULT_CUSTOM, overrides: { '--accent': '#ff0000', '--font-ui': 'Comic Sans', '--bg-0': 'vermelho' } }, true)
    expect(t['--accent']).toBe('#ff0000')
    expect(t['--font-ui']).toBeUndefined()
    expect(t['--bg-0']).not.toBe('vermelho')
  })

  it('gradiente deixa barras translúcidas e gera o CSS', async () => {
    const { customTokens, gradientCss, DEFAULT_CUSTOM } = await import('./custom-theme')
    const g = { enabled: true, stops: ['#112233', '#445566', '#778899'], angle: 90, intensity: 1, kind: 'linear' as const }
    const t = customTokens({ ...DEFAULT_CUSTOM, gradient: g }, true)
    expect(t['--app-gradient']).toBe('linear-gradient(90deg, #112233, #445566, #778899)')
    expect(t['--bg-0']).toMatch(/^color-mix\(in srgb, #[0-9a-f]{6} 38%, transparent\)$/)
    expect(t['--bg-2']).toMatch(/^#[0-9a-f]{6}$/)
    expect(gradientCss({ ...g, kind: 'radial' })).toContain('radial-gradient')
  })

  it('valida tema importado (campos inválidos voltam ao padrão)', async () => {
    const { sanitizeCustomTheme, DEFAULT_GRADIENT } = await import('./custom-theme')
    const t = sanitizeCustomTheme({ mode: 'neon', colors: 'x', gradient: { enabled: 1, stops: ['#000000', 'url(x)'], angle: 400 }, overrides: { '--accent': 'javascript:1' } })
    expect(t.mode).toBe('dark')
    expect(t.overrides).toEqual({})
    expect(t.gradient.enabled).toBe(true)
    expect(t.gradient.stops).toEqual(DEFAULT_GRADIENT.stops)
    expect(t.gradient.angle).toBe(40)
    expect(sanitizeCustomTheme(null).gradient.enabled).toBe(false)
  })
})
