import { Check, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import styles from './Menu.module.css'

/*
 * Menu de contexto do Opalite (substitui o menu nativo do sistema para poder
 * ter animação, ícones e o mesmo visual do resto do app). Uso imperativo:
 *
 *   const id = await openMenu(items, { x, y })   // null se fechado sem escolha
 *
 * Teclado: setas navegam, → abre submenu, ← volta, Enter escolhe, Esc fecha.
 */

export interface MenuItem {
  id?: string
  label?: string
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number }>
  /** Texto do atalho à direita (ex.: "Ctrl+B"). */
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  checked?: boolean
  submenu?: MenuItem[]
  type?: 'separator' | 'label'
}

interface MenuRequest {
  items: MenuItem[]
  x: number
  y: number
  resolve(id: string | null): void
}

const useMenu = create<{ request: MenuRequest | null }>(() => ({ request: null }))

export function openMenu(items: MenuItem[], at: { x: number; y: number }): Promise<string | null> {
  return new Promise((resolve) => {
    useMenu.getState().request?.resolve(null)
    useMenu.setState({ request: { items, x: at.x, y: at.y, resolve } })
  })
}

export const isMenuOpen = () => useMenu.getState().request !== null

const selectable = (i: MenuItem) => i.type !== 'separator' && i.type !== 'label' && !i.disabled

/** Fica montado uma vez no app; desenha o menu pedido por openMenu(). */
export function MenuHost() {
  const request = useMenu((s) => s.request)
  const [closing, setClosing] = useState(false)

  const finish = useCallback(
    (id: string | null) => {
      const req = useMenu.getState().request
      if (!req) return
      setClosing(true)
      // Espera a animação de saída antes de desmontar.
      setTimeout(() => {
        useMenu.setState({ request: null })
        setClosing(false)
        req.resolve(id)
      }, id ? 70 : 90)
    },
    [],
  )

  useEffect(() => {
    if (!request) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(`.${styles.menu}`)) finish(null)
    }
    const onBlur = () => finish(null)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onBlur)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onBlur)
    }
  }, [request, finish])

  if (!request) return null
  return <MenuPanel key={`${request.x},${request.y}`} items={request.items} x={request.x} y={request.y} root closing={closing} onPick={finish} onBack={() => finish(null)} />
}

interface PanelProps {
  items: MenuItem[]
  x: number
  y: number
  root?: boolean
  closing?: boolean
  /** Lado de onde o submenu abre (para animar na direção certa). */
  side?: 'right' | 'left'
  onPick(id: string | null): void
  onBack(): void
}

function MenuPanel({ items, x, y, root, closing, side = 'right', onPick, onBack }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y, origin: 'top left' })
  const [active, setActive] = useState(root ? -1 : items.findIndex(selectable))
  const [sub, setSub] = useState<{ index: number; x: number; y: number; side: 'right' | 'left' } | null>(null)
  const subTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Mantém o menu dentro da janela (vira para cima/esquerda se precisar).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const W = window.innerWidth
    const H = window.innerHeight
    // Submenu à esquerda: x é a borda esquerda da linha que o abriu.
    let left = side === 'left' && !root ? x - width : x
    let originX = side === 'left' && !root ? 'right' : 'left'
    if (left + width > W - 8) {
      left = root ? x - width : W - width - 8
      originX = 'right'
    }
    left = Math.max(8, left)
    let top = y
    let originY = 'top'
    if (top + height > H - 8) {
      top = root ? y - height : H - height - 8
      originY = root ? 'bottom' : 'top'
    }
    top = Math.max(8, top)
    setPos({ left, top, origin: `${originY} ${originX}` })
    el.focus({ preventScroll: true })
  }, [x, y, root, side])

  const openSub = (index: number, immediate = false) => {
    if (subTimer.current) clearTimeout(subTimer.current)
    const run = () => {
      const row = ref.current?.querySelectorAll<HTMLElement>(`[data-index]`)[index]
      if (!row || !items[index]?.submenu) return setSub(null)
      const r = row.getBoundingClientRect()
      const room = window.innerWidth - r.right
      const s: 'right' | 'left' = room < 230 ? 'left' : 'right'
      setSub({ index, x: s === 'right' ? r.right + 2 : r.left - 2, y: r.top - 5, side: s })
    }
    if (immediate) run()
    else subTimer.current = setTimeout(run, 110)
  }

  const pick = (item: MenuItem, index: number) => {
    if (!selectable(item)) return
    if (item.submenu) return openSub(index, true)
    onPick(item.id ?? null)
  }

  const move = (dir: 1 | -1) => {
    if (!items.some(selectable)) return
    let i = active
    do i = (i + dir + items.length) % items.length
    while (!selectable(items[i]!))
    setActive(i)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (sub) return // o submenu aberto cuida das teclas
    e.stopPropagation()
    if (e.key === 'ArrowDown') move(1)
    else if (e.key === 'ArrowUp') move(-1)
    else if (e.key === 'ArrowRight' && items[active]?.submenu) openSub(active, true)
    else if (e.key === 'ArrowLeft' && !root) onBack()
    else if (e.key === 'Enter' || e.key === ' ') items[active] && pick(items[active]!, active)
    else if (e.key === 'Escape') root ? onPick(null) : onBack()
    else return
    e.preventDefault()
  }

  return (
    <>
      <div
        ref={ref}
        className={styles.menu}
        data-closing={closing || undefined}
        data-sub={root ? undefined : side}
        role="menu"
        tabIndex={-1}
        style={{ left: pos.left, top: pos.top, transformOrigin: pos.origin }}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((item, i) => {
          if (item.type === 'separator') return <div key={`s${i}`} className={styles.sep} role="separator" />
          if (item.type === 'label') return <div key={`l${i}`} className={styles.label}>{item.label}</div>
          const Icon = item.icon
          return (
            <button
              key={item.id ?? `${item.label}${i}`}
              data-index={i}
              className={styles.item}
              role="menuitem"
              aria-haspopup={item.submenu ? 'menu' : undefined}
              aria-expanded={item.submenu ? sub?.index === i : undefined}
              aria-disabled={item.disabled || undefined}
              data-active={active === i || sub?.index === i || undefined}
              data-danger={item.danger || undefined}
              disabled={item.disabled}
              tabIndex={-1}
              onMouseEnter={() => {
                setActive(i)
                if (item.submenu) openSub(i)
                else {
                  if (subTimer.current) clearTimeout(subTimer.current)
                  subTimer.current = setTimeout(() => setSub(null), 120)
                }
              }}
              onClick={() => pick(item, i)}
            >
              <span className={styles.icon}>{item.checked ? <Check size={14} /> : Icon ? <Icon size={15} strokeWidth={1.7} /> : null}</span>
              <span className={styles.text}>{item.label}</span>
              {item.shortcut && <kbd className={styles.shortcut}>{item.shortcut}</kbd>}
              {item.submenu && <ChevronRight size={13} className={styles.chevron} />}
            </button>
          )
        })}
      </div>
      {sub && items[sub.index]?.submenu && (
        <MenuPanel
          key={sub.index}
          items={items[sub.index]!.submenu!}
          x={sub.x}
          y={sub.y}
          side={sub.side}
          closing={closing}
          onPick={onPick}
          onBack={() => {
            setSub(null)
            ref.current?.focus()
          }}
        />
      )}
    </>
  )
}
