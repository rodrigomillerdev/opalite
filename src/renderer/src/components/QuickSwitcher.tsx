import { useMemo, useState } from 'react'
import { fuzzyFilter } from '../lib/fuzzy'
import { parentOf } from '../lib/paths'
import { useIndex } from '../state/index-store'
import { useVault } from '../state/vault-store'
import { useWorkspace } from '../state/workspace-store'
import styles from './QuickSwitcher.module.css'
import { Highlight, Prompt, type PromptItem } from './Prompt'

interface Entry {
  path: string
  /** Texto que casou: título ou um apelido. */
  label: string
  alias: boolean
}

type Row = { kind: 'note'; entry: Entry; indices: number[] } | { kind: 'create'; name: string }

export function QuickSwitcher() {
  const close = useWorkspace((s) => s.closeModal)
  const notes = useIndex((s) => s.notes)
  const [query, setQuery] = useState('')

  const rows = useMemo<Row[]>(() => {
    const { back, activePath } = useVault.getState()
    if (!query.trim()) {
      // Sem consulta: notas abertas recentemente primeiro.
      const recent = [...new Set([...back].reverse())].filter((p) => p !== activePath)
      const rest = notes.map((n) => n.path).filter((p) => !recent.includes(p) && p !== activePath)
      const titleOf = new Map(notes.map((n) => [n.path, n.title]))
      return [...recent, ...rest.sort((a, b) => (titleOf.get(a) ?? a).localeCompare(titleOf.get(b) ?? b, 'pt-BR'))]
        .filter((p) => titleOf.has(p))
        .slice(0, 100)
        .map((path) => ({ kind: 'note', entry: { path, label: titleOf.get(path)!, alias: false }, indices: [] }))
    }

    const entries: Entry[] = notes.flatMap((n) => [
      { path: n.path, label: n.title, alias: false },
      ...n.aliases.map((a) => ({ path: n.path, label: a, alias: true })),
    ])
    // Casa pelo título; o caminho entra com peso menor (ex.: "proj opal").
    const matched = fuzzyFilter(entries, query, (e) => e.label, 200)
    const byPath = fuzzyFilter(entries.filter((e) => !e.alias), query, (e) => e.path, 200)
    const seen = new Set<string>()
    const result: Row[] = []
    for (const r of [...matched, ...byPath.map((r) => ({ ...r, match: { ...r.match, indices: [] } }))]) {
      if (seen.has(r.item.path)) continue
      seen.add(r.item.path)
      result.push({ kind: 'note', entry: r.item, indices: r.match.indices })
      if (result.length >= 60) break
    }
    const exact = notes.some((n) => n.title.toLowerCase() === query.trim().toLowerCase())
    if (!exact) result.push({ kind: 'create', name: query.trim() })
    return result
  }, [notes, query])

  const items: PromptItem[] = rows.map((row) =>
    row.kind === 'create'
      ? {
          key: '__create',
          content: <span className={styles.create}>Criar nota “{row.name}”</span>,
          aside: 'Shift Enter',
        }
      : {
          key: `${row.entry.path}:${row.entry.label}`,
          content: (
            <>
              <span><Highlight text={row.entry.label} indices={row.indices} /></span>
              {(row.entry.alias || parentOf(row.entry.path)) && (
                <span className={styles.path}>
                  {row.entry.alias ? `apelido de ${row.entry.path}` : parentOf(row.entry.path)}
                </span>
              )}
            </>
          ),
        },
  )

  const create = async (name: string) => {
    if (!name) return
    const path = await window.opalite.files.createNote(`${name}.md`).catch((err: Error) => {
      useVault.setState({ error: err.message })
      return null
    })
    if (!path) return
    await useVault.getState().refreshTree()
    await useVault.getState().openFile(path)
  }

  return (
    <Prompt
      placeholder="Encontre ou crie uma nota…"
      query={query}
      onQuery={setQuery}
      items={items}
      empty="O cofre ainda não tem notas. Digite um nome para criar a primeira."
      onClose={close}
      onChoose={(i, { shift }) => {
        close()
        const row = rows[i]
        if (shift || !row) return void create(query.trim())
        if (row.kind === 'create') return void create(row.name)
        void useVault.getState().openFile(row.entry.path)
      }}
      footer={
        <>
          <span><kbd>Enter</kbd> abrir</span>
          <span><kbd>Shift</kbd> <kbd>Enter</kbd> criar</span>
          <span><kbd>Esc</kbd> fechar</span>
        </>
      }
    />
  )
}
