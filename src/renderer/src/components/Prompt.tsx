import { type ReactNode, useEffect, useRef, useState } from 'react'
import styles from './Prompt.module.css'

export interface PromptItem {
  key: string
  content: ReactNode
  aside?: ReactNode
}

interface PromptProps {
  placeholder: string
  items: PromptItem[]
  query: string
  onQuery(query: string): void
  onChoose(index: number, event: { shift: boolean; mod: boolean }): void
  onClose(): void
  empty?: ReactNode
  footer?: ReactNode
}

/**
 * Janela flutuante com campo de texto e lista navegável por teclado.
 * Base da paleta de comandos e da troca rápida de notas.
 */
export function Prompt({ placeholder, items, query, onQuery, onChoose, onClose, empty, footer }: PromptProps) {
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => setSelected(0), [query])

  useEffect(() => {
    listRef.current?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, items.length - 1))
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (items.length) onChoose(selected, { shift: e.shiftKey, mod: e.ctrlKey || e.metaKey })
      else onChoose(-1, { shift: e.shiftKey, mod: e.ctrlKey || e.metaKey })
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
    // Impede que atalhos globais (Ctrl+N etc.) disparem enquanto digita aqui.
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
  }

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div className={styles.prompt} role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <input
          className={styles.input}
          autoFocus
          placeholder={placeholder}
          value={query}
          spellCheck={false}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls="prompt-list"
          aria-activedescendant={items[selected] ? `prompt-${items[selected]!.key}` : undefined}
        />
        <div ref={listRef} id="prompt-list" role="listbox" className={styles.list}>
          {items.length === 0 && empty && <div className={styles.empty}>{empty}</div>}
          {items.map((item, i) => (
            <div
              key={item.key}
              id={`prompt-${item.key}`}
              role="option"
              aria-selected={i === selected}
              data-selected={i === selected || undefined}
              className={styles.item}
              onMouseMove={() => setSelected(i)}
              onClick={(e) => onChoose(i, { shift: e.shiftKey, mod: e.ctrlKey || e.metaKey })}
            >
              <div className={styles.main}>{item.content}</div>
              {item.aside && <div className={styles.aside}>{item.aside}</div>}
            </div>
          ))}
        </div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  )
}

/** Texto com as letras encontradas destacadas. */
export function Highlight({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>
  const set = new Set(indices)
  const parts: ReactNode[] = []
  let buffer = ''
  let marked = false
  const flush = (key: number) => {
    if (!buffer) return
    parts.push(marked ? <mark key={key}>{buffer}</mark> : buffer)
    buffer = ''
  }
  for (let i = 0; i < text.length; i++) {
    const isMarked = set.has(i)
    if (isMarked !== marked) {
      flush(i)
      marked = isMarked
    }
    buffer += text[i]
  }
  flush(text.length)
  return <>{parts}</>
}

export function Keys({ keys }: { keys: string[] }) {
  return (
    <span className={styles.keys}>
      {keys.map((k) => (
        <kbd key={k}>{k}</kbd>
      ))}
    </span>
  )
}
