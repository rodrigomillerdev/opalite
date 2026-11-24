import { create } from 'zustand'
import { LinkResolver } from '../../../shared/markdown/resolve'
import type { NoteSummary, TagCount } from '../../../shared/types'

interface IndexState {
  notes: NoteSummary[]
  tags: TagCount[]
  resolver: LinkResolver
  /** Aumenta a cada atualização; painéis usam para saber quando recarregar. */
  version: number
  refresh(): Promise<void>
  clear(): void
}

/**
 * Cópia leve do índice do processo principal: lista de notas (títulos,
 * apelidos, tags) e o resolvedor de links. O conteúdo das notas fica no main;
 * backlinks e busca são pedidos sob demanda.
 */
let lastNotesKey = ''
let lastTagsKey = ''

export const useIndex = create<IndexState>((set) => ({
  notes: [],
  tags: [],
  resolver: new LinkResolver([]),
  version: 0,

  async refresh() {
    try {
      const [notes, tags] = await Promise.all([window.opalite.index.notes(), window.opalite.index.tags()])
      set((s) => {
        const notesKey = JSON.stringify(notes)
        const tagsKey = JSON.stringify(tags)
        const sameNotes = notesKey === lastNotesKey
        lastNotesKey = notesKey
        const sameTags = tagsKey === lastTagsKey
        lastTagsKey = tagsKey
        // A versão sobe sempre (o conteúdo das notas pode ter mudado), mas lista,
        // tags e resolvedor só são trocados se mudaram de verdade.
        return {
          notes: sameNotes ? s.notes : notes,
          tags: sameTags ? s.tags : tags,
          resolver: sameNotes ? s.resolver : new LinkResolver(notes),
          version: s.version + 1,
        }
      })
    } catch {
      // cofre fechado no meio da atualização
    }
  },

  clear() {
    lastNotesKey = ''
    lastTagsKey = ''
    set((s) => ({ notes: [], tags: [], resolver: new LinkResolver([]), version: s.version + 1 }))
  },
}))
