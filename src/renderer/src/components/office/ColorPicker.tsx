import { Check, ChevronDown, type LucideIcon, Pipette } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './ColorPicker.module.css'

/*
 * Botão de cor com paleta (cor do texto, preenchimento). Abre um painel com
 * cores do tema em tons, cores recentes e "Personalizada…" (seletor do
 * sistema + campo hexadecimal). O painel não rouba o foco: com texto em
 * edição, a seleção continua lá e a cor vale só para o trecho selecionado.
 */

const BASE = ['#1f2430', '#e5484d', '#f2994a', '#f2c94c', '#27ae60', '#14a3a3', '#2f80ed', '#7c6cf0', '#d6409f', '#8b5e3c']
const GRAYS = ['#000000', '#3a3f4b', '#5b6170', '#8a909c', '#b8bcc4', '#d9dce1', '#eceef1', '#ffffff']
const RECENT_KEY = 'opalite.colors.recent'

/** Mistura uma cor com branco (t > 0) ou preto (t < 0). */
function shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(t > 0 ? c + (255 - c) * t : c * (1 + t)))
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

const PALETTE = [BASE.map((c) => shade(c, 0.75)), BASE.map((c) => shade(c, 0.45)), BASE, BASE.map((c) => shade(c, -0.35))]

function readRecent(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).slice(0, 10) : []
  } catch {
    return []
  }
}

function pushRecent(color: string) {
  try {
    const list = [color, ...readRecent().filter((c) => c !== color)].slice(0, 10)
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    // só desta sessão
  }
}

export function ColorPickerButton({
  icon: Icon,
  label,
  value,
  fallback,
  automatic,
  disabled,
  onPick,
}: {
  icon: LucideIcon
  label: string
  /** Cor atual (mostrada na faixa sob o ícone e marcada na paleta). */
  value: string | undefined
  /** Cor mostrada na faixa quando não há valor. */
  fallback: string
  /** Texto da opção "sem cor própria" (omitida se ausente). */
  automatic?: { label: string; color: string | null }
  disabled?: boolean
  onPick(color: string | null): void
}) {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)

  const toggle = () => {
    if (open) return setOpen(null)
    const r = button.current!.getBoundingClientRect()
    setOpen({ x: r.left, y: r.bottom + 6 })
  }

  return (
    <>
      <button
        ref={button}
        className={styles.trigger}
        data-open={open ? true : undefined}
        disabled={disabled}
        onClick={toggle}
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={Boolean(open)}
      >
        <span className={styles.triggerIcon}>
          <Icon size={15} />
          <span className={styles.bar} style={{ background: value ?? fallback }} />
        </span>
        <ChevronDown size={11} className={styles.caret} />
      </button>
      {open && (
        <ColorPopover
          at={open}
          label={label}
          value={value}
          automatic={automatic}
          anchor={button.current}
          onClose={() => setOpen(null)}
          onPick={(c) => {
            if (c) pushRecent(c)
            onPick(c)
          }}
        />
      )}
    </>
  )
}

/**
 * Campo de cor para painéis (chip + código). Abre a mesma paleta do app, que
 * se reposiciona para caber na janela (o seletor nativo do sistema ficava
 * cortado na borda direita).
 */
export function ColorField({ value, empty, label, onChange }: { value: string | undefined; empty?: string; label: string; onChange(color: string): void }) {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={button}
        type="button"
        className={styles.field}
        data-open={open ? true : undefined}
        title={value ? value.toUpperCase() : empty}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={Boolean(open)}
        onClick={() => {
          if (open) return setOpen(null)
          const r = button.current!.getBoundingClientRect()
          setOpen({ x: r.right - 252, y: r.bottom + 6 })
        }}
      >
        <span className={styles.fieldChip} data-empty={!value || undefined} style={value ? { background: value } : undefined} />
        <span className={styles.fieldText}>{value ? value.toUpperCase() : empty}</span>
      </button>
      {open && (
        <ColorPopover
          at={open}
          label={label}
          value={value}
          anchor={button.current}
          onClose={() => setOpen(null)}
          onPick={(c) => {
            if (!c) return
            pushRecent(c)
            onChange(c)
          }}
        />
      )}
    </>
  )
}

function ColorPopover({
  at,
  label,
  value,
  automatic,
  anchor,
  onClose,
  onPick,
}: {
  at: { x: number; y: number }
  label: string
  value: string | undefined
  automatic?: { label: string; color: string | null }
  anchor: HTMLElement | null
  onClose(): void
  onPick(color: string | null): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const native = useRef<HTMLInputElement>(null)
  const [pos, setPos] = useState(at)
  const [hex, setHex] = useState(value ?? '')
  const [recent] = useState(readRecent)
  const current = value?.toLowerCase()

  // Mantém o painel dentro da janela.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const above = anchor ? anchor.getBoundingClientRect().top - r.height - 6 : at.y
    const y = at.y + r.height > window.innerHeight - 8 && above >= 8 ? above : Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8))
    setPos({ x: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)), y })
  }, [at, anchor])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchor?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [anchor, onClose])

  const pick = (c: string | null) => {
    onPick(c)
    onClose()
  }

  const Swatch = ({ c }: { c: string }) => (
    <button className={styles.swatch} style={{ background: c }} data-on={current === c || undefined} data-light={isLight(c) || undefined} onClick={() => pick(c)} title={c.toUpperCase()} aria-label={c.toUpperCase()}>
      {current === c && <Check size={11} strokeWidth={3} />}
    </button>
  )

  return createPortal(
    <div
      ref={ref}
      className={styles.popover}
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label={label}
      data-keep-editing
      // Não tira o foco (nem a seleção) do texto em edição; o campo hexadecimal é a exceção.
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest('input')) e.preventDefault()
      }}
    >
      {automatic && (
        <button className={styles.auto} onClick={() => pick(automatic.color)}>
          <span className={styles.autoChip} style={automatic.color ? { background: automatic.color } : undefined} data-none={!automatic.color || undefined} />
          {automatic.label}
        </button>
      )}
      <div className={styles.grid}>
        {GRAYS.map((c) => (
          <Swatch key={c} c={c} />
        ))}
      </div>
      <div className={styles.grid} data-cols="10">
        {PALETTE.flat().map((c, i) => (
          <Swatch key={`${c}${i}`} c={c} />
        ))}
      </div>
      {recent.length > 0 && (
        <>
          <span className={styles.heading}>Recentes</span>
          <div className={styles.grid} data-cols="10">
            {recent.map((c) => (
              <Swatch key={c} c={c} />
            ))}
          </div>
        </>
      )}
      <div className={styles.custom}>
        <button className={styles.more} onClick={() => native.current?.click()} title="Escolher no seletor de cores">
          <Pipette size={13} /> Personalizada…
        </button>
        <input
          className={styles.hex}
          value={hex}
          placeholder="#RRGGBB"
          spellCheck={false}
          maxLength={7}
          aria-label="Cor em hexadecimal"
          onChange={(e) => setHex(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              const v = normalizeHex(hex)
              if (v) pick(v)
            } else if (e.key === 'Escape') onClose()
          }}
        />
        <input
          ref={native}
          type="color"
          className={styles.native}
          defaultValue={value ?? '#7c6cf0'}
          tabIndex={-1}
          onChange={(e) => {
            setHex(e.target.value)
            onPick(e.target.value)
          }}
          onBlur={(e) => pushRecent(e.target.value)}
        />
      </div>
    </div>,
    document.body,
  )
}

function normalizeHex(v: string): string | null {
  const s = v.trim().replace(/^#?/, '#').toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join('')}`
  return null
}

function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) > 200
}
