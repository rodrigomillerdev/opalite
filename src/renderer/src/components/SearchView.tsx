import { useEffect, useRef, useState } from 'react'
import type { SearchResult } from '../../../shared/types'
import { documents } from '../editor/document-manager'
import { useIndex } from '../state/index-store'
import { useVault } from '../state/vault-store'
import { useWorkspace } from '../state/workspace-store'
import styles from './Panels.module.css'

function Snippet({ text, ranges }: { text: string; ranges: Array<[number, number]> }) {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const [a, b] of ranges) {
    if (a < last) continue
    parts.push(text.slice(last, a), <mark key={a}>{text.slice(a, b)}</mark>)
    last = b
  }
  parts.push(text.slice(last))
  return <>{parts}</>
}

export function SearchView() {
  const query = useWorkspace((s) => s.searchQuery)
  const focusSignal = useWorkspace((s) => s.searchFocus)
  const version = useIndex((s) => s.version)
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusSignal])

  // Busca com debounce; refaz quando o índice muda (notas editadas).
  useEffect(() => {
    if (!query.trim()) {
      setResults(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      window.opalite.index
        .search(query)
        .then((r) => !cancelled && setResults(r))
        .catch(() => !cancelled && setResults([]))
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, version])

  const open = async (path: string, line?: number) => {
    await useVault.getState().openFile(path)
    if (line !== undefined) documents.revealLine(line)
  }

  const total = results?.reduce((n, r) => n + Math.max(r.matches.length, 1), 0) ?? 0

  return (
    <>
      <div className={styles.searchBox}>
        <input
          ref={inputRef}
          className={styles.searchInput}
          placeholder="Buscar no cofre…"
          value={query}
          spellCheck={false}
          onChange={(e) => useWorkspace.setState({ searchQuery: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') useWorkspace.setState({ searchQuery: '' })
            if (e.key === 'Enter' && results?.[0]) void open(results[0].path, results[0].matches[0]?.line)
          }}
          aria-label="Buscar no cofre"
        />
      </div>
      <div className={styles.scroll}>
        {results === null && (
          <div className={styles.hint}>
            Palavras, <code>"frase exata"</code>, <code>tag:projeto</code> ou <code>#projeto</code>,{' '}
            <code>path:pasta</code>, <code>file:nome</code>. Acentos e maiúsculas são ignorados.
          </div>
        )}
        {results && results.length === 0 && <div className={styles.hint}>Nenhum resultado.</div>}
        {results && results.length > 0 && (
          <div className={styles.sectionTitle}>
            <span>{results.length === 60 ? '60+ notas' : `${results.length} ${results.length === 1 ? 'nota' : 'notas'}`}</span>
            <span className={styles.count}>{total}</span>
          </div>
        )}
        {results?.map((r) => (
          <div key={r.path} className={styles.group}>
            <button className={styles.groupTitle} onClick={() => void open(r.path, r.matches[0]?.line)} title={r.path}>
              <span>{r.title}</span>
            </button>
            {r.matches.map((m) => (
              <button key={m.line} className={styles.snippet} onClick={() => void open(r.path, m.line)}>
                <Snippet text={m.text} ranges={m.ranges} />
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}
