import { useMemo, useState } from 'react'
import { documents } from '../editor/document-manager'
import { insertText } from '../editor/markdown-commands'
import { dailyNoteSettings, renderTemplate } from '../lib/daily'
import { fuzzyFilter } from '../lib/fuzzy'
import { isWithin, titleOf } from '../lib/paths'
import { useIndex } from '../state/index-store'
import { useVault } from '../state/vault-store'
import { useWorkspace } from '../state/workspace-store'
import { Highlight, Prompt } from './Prompt'

/**
 * Inserir modelo: lista as notas da pasta de modelos ("Modelos" por padrão)
 * e insere o conteúdo no cursor, trocando {{title}}, {{date}} e {{time}}.
 */
export function TemplatePicker() {
  const close = useWorkspace((s) => s.closeModal)
  const notes = useIndex((s) => s.notes)
  const [query, setQuery] = useState('')
  const folder = dailyNoteSettings().templatesFolder.replace(/^\/+|\/+$/g, '')
  const templates = useMemo(() => notes.filter((n) => folder && isWithin(n.path, folder) && n.path !== folder), [notes, folder])
  const results = fuzzyFilter(templates, query, (n) => n.title, 60)
  const hasNote = useVault.getState().activePath !== null

  const choose = async (path: string) => {
    close()
    const view = documents.editorView
    const current = useVault.getState().activePath
    if (!view || !current) return
    try {
      const { content } = await window.opalite.files.read(path)
      const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '')
      insertText(view, renderTemplate(body, { title: titleOf(current), date: new Date() }))
    } catch (err) {
      useVault.setState({ error: (err as Error).message })
    }
  }

  return (
    <Prompt
      placeholder={hasNote ? 'Escolha um modelo para inserir…' : 'Abra uma nota antes de inserir um modelo'}
      query={query}
      onQuery={setQuery}
      items={results.map(({ item, match }) => ({ key: item.path, content: <span><Highlight text={item.title} indices={match.indices} /></span> }))}
      empty={
        hasNote
          ? `Nenhum modelo encontrado. Crie notas na pasta "${folder}" para usá-las como modelo (variáveis: {{title}}, {{date}}, {{time}}).`
          : 'Abra uma nota primeiro.'
      }
      onClose={close}
      onChoose={(i) => {
        const r = results[i]
        if (r && hasNote) void choose(r.item.path)
        else close()
      }}
    />
  )
}
