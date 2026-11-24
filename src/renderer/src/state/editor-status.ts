import { create } from 'zustand'
import type { Heading, WikiLink } from '../../../shared/markdown/parse'

export type SaveState = 'idle' | 'saved' | 'dirty' | 'saving' | 'error' | 'conflict'

interface EditorStatus {
  saveState: SaveState
  error: string | null
  words: number
  chars: number
  /** Títulos da nota aberta (painel Estrutura). */
  headings: Heading[]
  /** Links da nota aberta (painel Links de saída). */
  links: WikiLink[]
  /** Frontmatter da nota aberta (capa, propriedades). */
  frontmatter: Record<string, unknown>
}

/** Estado leve exibido na barra de status e nos painéis. Atualizado pelo DocumentManager. */
export const useEditorStatus = create<EditorStatus>(() => ({
  saveState: 'idle',
  error: null,
  words: 0,
  chars: 0,
  headings: [],
  links: [],
  frontmatter: {},
}))
