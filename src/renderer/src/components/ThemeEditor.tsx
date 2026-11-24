import { ChevronLeft, ChevronRight, Minus, Moon, Plus, Sparkles, Sun } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type ColorPoint,
  type CustomTheme,
  HARMONY_LABEL,
  NEXT_HARMONY,
  SWATCHES,
  type ThemeMode,
  applyHarmony,
  hexToPoint,
  loadCustomTheme,
  pointToHex,
  saveCustomTheme,
} from '../lib/custom-theme'
import { THEMES, type ThemeId, applyTheme, loadTheme } from '../lib/theme'
import { useWorkspace } from '../state/workspace-store'
import styles from './ThemeEditor.module.css'

/*
 * Editor de tema: arraste as bolinhas no campo para escolher as cores
 * (horizontal = matiz, vertical = saturação), ajuste a textura na onda e a
 * intensidade no botão giratório. Tudo se aplica ao vivo.
 */

const MAX_COLORS = 3
const clamp = (v: number) => Math.min(1, Math.max(0, v))

export function ThemeEditor() {
  const close = useWorkspace((s) => s.closeModal)
  const [theme, setTheme] = useState<CustomTheme>(loadCustomTheme)
  const [active, setActive] = useState<ThemeId>(loadTheme)
  const [page, setPage] = useState(0)
  const frame = useRef(0)

  // Aplica no próximo quadro (no máximo 60x por segundo durante o arraste).
  const update = useCallback((next: CustomTheme) => {
    setTheme(next)
    saveCustomTheme(next)
    setActive('personalizado')
    if (!frame.current) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0
        applyTheme('personalizado')
      })
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const setColors = (colors: ColorPoint[]) => update({ ...theme, colors: applyHarmony(colors, theme.harmony) })

  const choosePreset = (id: ThemeId) => {
    setActive(id)
    applyTheme(id)
  }

  return (
    <div className={styles.backdrop} onMouseDown={close}>
      <div className={styles.panel} role="dialog" aria-label="Editar tema" onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.surface}>
          <div className={styles.modes} role="radiogroup" aria-label="Modo">
            {(
              [
                ['auto', Sparkles, 'Automático (segue o sistema)'],
                ['light', Sun, 'Claro'],
                ['dark', Moon, 'Escuro'],
              ] as Array<[ThemeMode, typeof Sun, string]>
            ).map(([mode, Icon, label]) => (
              <button
                key={mode}
                role="radio"
                aria-checked={theme.mode === mode}
                data-on={theme.mode === mode || undefined}
                className={styles.mode}
                title={label}
                aria-label={label}
                onClick={() => update({ ...theme, mode })}
              >
                <Icon size={18} strokeWidth={1.75} />
              </button>
            ))}
          </div>

          <ColorField theme={theme} onChange={setColors} />

          <div className={styles.fieldTools}>
            <button
              className={styles.tool}
              onClick={() => setColors([...theme.colors, { x: (theme.colors[0]!.x + 0.15) % 1, y: theme.colors[0]!.y }])}
              disabled={theme.colors.length >= MAX_COLORS}
              title="Adicionar cor"
              aria-label="Adicionar cor"
            >
              <Plus size={18} strokeWidth={1.75} />
            </button>
            <button
              className={styles.tool}
              onClick={() => setColors(theme.colors.slice(0, -1))}
              disabled={theme.colors.length <= 1}
              title="Remover cor"
              aria-label="Remover cor"
            >
              <Minus size={18} strokeWidth={1.75} />
            </button>
            <button
              className={styles.tool}
              onClick={() => {
                const harmony = NEXT_HARMONY[theme.harmony]
                update({ ...theme, harmony, colors: applyHarmony(theme.colors, harmony) })
              }}
              disabled={theme.colors.length <= 1}
              title={`Harmonia: ${HARMONY_LABEL[theme.harmony]} (clique para trocar)`}
              aria-label={`Harmonia das cores: ${HARMONY_LABEL[theme.harmony]}`}
            >
              <HarmonyIcon />
            </button>
          </div>
        </div>

        <div className={styles.swatches}>
          <button className={styles.page} onClick={() => setPage((p) => (p + SWATCHES.length - 1) % SWATCHES.length)} aria-label="Cores anteriores">
            <ChevronLeft size={16} strokeWidth={1.75} />
          </button>
          {SWATCHES[page]!.map((hex) => (
            <button
              key={hex}
              className={styles.swatch}
              style={{ background: hex }}
              title={hex}
              aria-label={`Usar a cor ${hex}`}
              onClick={() => setColors([hexToPoint(hex), ...theme.colors.slice(1)])}
            />
          ))}
          <button className={styles.page} onClick={() => setPage((p) => (p + 1) % SWATCHES.length)} aria-label="Mais cores">
            <ChevronRight size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className={styles.bottom}>
          <WaveSlider value={theme.texture} onChange={(texture) => update({ ...theme, texture })} />
          <Dial value={theme.intensity} onChange={(intensity) => update({ ...theme, intensity })} />
        </div>

        <div className={styles.presets} role="radiogroup" aria-label="Temas">
          {THEMES.map((t) => (
            <button key={t.id} role="radio" aria-checked={active === t.id} data-on={active === t.id || undefined} onClick={() => choosePreset(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <button className={styles.studio} onClick={() => useWorkspace.getState().openModal('studio')}>
          Cores por elemento, gradiente e temas salvos…
        </button>
      </div>
    </div>
  )
}

/** Campo de cores: bolinhas arrastáveis sobre uma superfície pontilhada. */
function ColorField({ theme, onChange }: { theme: CustomTheme; onChange(colors: ColorPoint[]): void }) {
  const ref = useRef<HTMLDivElement>(null)

  const pointFrom = (clientX: number, clientY: number): ColorPoint => {
    const r = ref.current!.getBoundingClientRect()
    return { x: clamp((clientX - r.left) / r.width), y: clamp((clientY - r.top) / r.height) }
  }

  /** Segue o ponteiro movendo a cor `index` até soltar. */
  const startDrag = (index: number, target: HTMLElement, pointerId: number) => {
    target.setPointerCapture(pointerId)
    const move = (ev: PointerEvent) => {
      const colors = [...theme.colors]
      colors[index] = pointFrom(ev.clientX, ev.clientY)
      // As outras cores acompanham, segundo a harmonia escolhida.
      onChange(colors)
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }

  const drag = (index: number, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    startDrag(index, e.currentTarget as HTMLElement, e.pointerId)
  }

  return (
    <div
      ref={ref}
      className={styles.field}
      onPointerDown={(e) => {
        // Clique no vazio leva a cor principal até ali e já permite arrastar.
        onChange([pointFrom(e.clientX, e.clientY), ...theme.colors.slice(1)])
        startDrag(0, e.currentTarget, e.pointerId)
      }}
    >
      {theme.colors.map((p, i) => (
        <span
          key={i}
          data-dot={i}
          className={styles.dot}
          data-primary={i === 0 || undefined}
          style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, background: pointToHex(p) }}
          role="slider"
          tabIndex={0}
          aria-label={i === 0 ? 'Cor principal' : `Cor ${i + 1}`}
          aria-valuetext={pointToHex(p)}
          onPointerDown={(e) => drag(i, e)}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.05 : 0.01
            const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
            if (!d) return
            e.preventDefault()
            const colors = [...theme.colors]
            colors[i] = { x: (p.x + d[0]! + 1) % 1, y: clamp(p.y + d[1]!) }
            onChange(colors)
          }}
        />
      ))}
    </div>
  )
}

/** Controle de textura: uma onda que cresce até o puxador. */
function WaveSlider({ value, onChange }: { value: number; onChange(v: number): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const set = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    onChange(clamp((clientX - r.left - 16) / (r.width - 32)))
  }
  const width = 260
  const thumbX = 16 + value * (width - 32)
  // Onda senoidal do começo até o puxador; depois disso, linha reta.
  let d = `M 4 30`
  for (let x = 4; x <= thumbX; x += 2) d += ` L ${x} ${30 + Math.sin((x - 4) / 6.5) * 12}`
  return (
    <div
      ref={ref}
      className={styles.wave}
      role="slider"
      tabIndex={0}
      aria-label="Textura"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      title={`Textura: ${Math.round(value * 100)}%`}
      onPointerDown={(e) => {
        const target = e.currentTarget
        target.setPointerCapture(e.pointerId)
        set(e.clientX)
        const move = (ev: PointerEvent) => set(ev.clientX)
        const up = () => {
          target.removeEventListener('pointermove', move)
          target.removeEventListener('pointerup', up)
        }
        target.addEventListener('pointermove', move)
        target.addEventListener('pointerup', up)
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(clamp(value - 0.05))
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(clamp(value + 0.05))
      }}
    >
      <svg viewBox={`0 0 ${width} 60`} preserveAspectRatio="none" aria-hidden="true">
        <path d={`M ${thumbX} 30 L ${width - 4} 30`} className={styles.waveFlat} />
        <path d={d} className={styles.waveLine} />
      </svg>
      <span className={styles.waveThumb} style={{ left: `${(thumbX / width) * 100}%` }} />
    </div>
  )
}

/** Botão giratório de intensidade: arraste para cima/baixo ou use a rolagem. */
function Dial({ value, onChange }: { value: number; onChange(v: number): void }) {
  const angle = -135 + value * 270
  return (
    <div
      className={styles.dial}
      role="slider"
      tabIndex={0}
      aria-label="Intensidade da cor"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      title={`Intensidade: ${Math.round(value * 100)}%`}
      onPointerDown={(e) => {
        const target = e.currentTarget
        target.setPointerCapture(e.pointerId)
        const startY = e.clientY
        const start = value
        const move = (ev: PointerEvent) => onChange(clamp(start + (startY - ev.clientY) / 150))
        const up = () => {
          target.removeEventListener('pointermove', move)
          target.removeEventListener('pointerup', up)
        }
        target.addEventListener('pointermove', move)
        target.addEventListener('pointerup', up)
      }}
      onWheel={(e) => onChange(clamp(value - e.deltaY / 1500))}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(clamp(value - 0.05))
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(clamp(value + 0.05))
      }}
    >
      {Array.from({ length: 13 }, (_, i) => {
        const a = ((-135 + i * 22.5) * Math.PI) / 180
        return <span key={i} className={styles.tick} data-on={i / 12 <= value + 0.001 || undefined} style={{ left: `${50 + Math.sin(a) * 44}%`, top: `${50 - Math.cos(a) * 44}%` }} />
      })}
      <span className={styles.knob} style={{ transform: `rotate(${angle}deg)` }}>
        <span className={styles.indicator} />
      </span>
    </div>
  )
}

function HarmonyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="6.5" r="3" />
      <circle cx="6.5" cy="16" r="3" />
      <circle cx="17.5" cy="16" r="3" />
    </svg>
  )
}
