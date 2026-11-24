import { create } from 'zustand'

export type LeftTab = 'files' | 'search' | 'tags' | 'favorites'
export type RightTab = 'backlinks' | 'outgoing' | 'outline' | 'graph' | 'calendar'
export type Modal = 'palette' | 'switcher' | 'template' | 'theme' | 'converter' | 'settings' | 'history' | 'studio' | null

interface WorkspaceState {
  leftTab: LeftTab
  rightOpen: boolean
  rightTab: RightTab
  modal: Modal
  searchQuery: string
  /** Arquivo pré-selecionado no conversor. */
  converterPath: string | null
  /** Arquivo cujo histórico de versões está aberto. */
  historyPath: string | null
  openHistory(path: string): void
  /** Incrementado para pedir foco no campo de busca. */
  searchFocus: number
  setLeftTab(tab: LeftTab): void
  setRightTab(tab: RightTab): void
  toggleRight(): void
  openModal(modal: Exclude<Modal, null>): void
  openConverter(path?: string | null): void
  closeModal(): void
  /** Abre a busca do cofre com uma consulta (ex.: "tag:projeto"). */
  search(query?: string): void
}

const RIGHT_KEY = 'opalite:right-open'

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // sem armazenamento: só não lembra a preferência
  }
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  leftTab: 'files',
  rightOpen: readBool(RIGHT_KEY, true),
  rightTab: 'backlinks',
  modal: null,
  searchQuery: '',
  converterPath: null,
  historyPath: null,
  searchFocus: 0,

  setLeftTab(leftTab) {
    set({ leftTab })
  },

  setRightTab(rightTab) {
    set({ rightTab, rightOpen: true })
    writeBool(RIGHT_KEY, true)
  },

  toggleRight() {
    set((s) => {
      writeBool(RIGHT_KEY, !s.rightOpen)
      return { rightOpen: !s.rightOpen }
    })
  },

  openModal(modal) {
    set({ modal })
  },

  openHistory(path) {
    set({ modal: 'history', historyPath: path })
  },

  openConverter(path = null) {
    set({ modal: 'converter', converterPath: path })
  },

  closeModal() {
    set({ modal: null })
  },

  search(query) {
    set((s) => ({
      leftTab: 'search',
      searchQuery: query ?? s.searchQuery,
      searchFocus: s.searchFocus + 1,
    }))
  },
}))
