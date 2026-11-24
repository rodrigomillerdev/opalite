import { useMemo, useState } from 'react'
import { type AppCommand, COMMANDS, formatHotkey } from '../lib/commands'
import { fuzzyFilter } from '../lib/fuzzy'
import { useWorkspace } from '../state/workspace-store'
import { Highlight, Keys, Prompt, type PromptItem } from './Prompt'

const RECENT_KEY = 'opalite:recent-commands'

function loadRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function saveRecent(id: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...loadRecent().filter((x) => x !== id)].slice(0, 6)))
  } catch {
    // sem armazenamento
  }
}

export function CommandPalette() {
  const close = useWorkspace((s) => s.closeModal)
  const [query, setQuery] = useState('')

  const results = useMemo(() => {
    const available = COMMANDS.filter((c) => c.id !== 'palette' && (!c.available || c.available()))
    if (!query.trim()) {
      // Sem consulta: usados recentemente primeiro, depois em ordem alfabética.
      const recent = loadRecent()
      const byRecent = (c: AppCommand) => {
        const i = recent.indexOf(c.id)
        return i === -1 ? Infinity : i
      }
      return [...available]
        .sort((a, b) => byRecent(a) - byRecent(b) || a.name.localeCompare(b.name, 'pt-BR'))
        .map((cmd) => ({ cmd, indices: [] as number[], recent: recent.includes(cmd.id) }))
    }
    return fuzzyFilter(available, query, (c) => c.name).map((r) => ({ cmd: r.item, indices: r.match.indices, recent: false }))
  }, [query])

  const items: PromptItem[] = results.map(({ cmd, indices, recent }) => {
    const key = cmd.hotkey ?? cmd.editorKey
    return {
      key: cmd.id,
      content: <span><Highlight text={cmd.name} indices={indices} /></span>,
      aside: key ? <Keys keys={formatHotkey(key)} /> : recent ? 'recente' : undefined,
    }
  })

  return (
    <Prompt
      placeholder="Digite um comando…"
      query={query}
      onQuery={setQuery}
      items={items}
      empty="Nenhum comando encontrado."
      onClose={close}
      onChoose={(i) => {
        const cmd = results[i]?.cmd
        close()
        if (!cmd) return
        saveRecent(cmd.id)
        // Espera a paleta fechar para o foco voltar ao editor antes de executar.
        requestAnimationFrame(() => void cmd.run())
      }}
      footer={
        <>
          <span><kbd>↑</kbd> <kbd>↓</kbd> navegar</span>
          <span><kbd>Enter</kbd> executar</span>
          <span><kbd>Esc</kbd> fechar</span>
        </>
      }
    />
  )
}
