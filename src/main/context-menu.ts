import {
  type BrowserWindow,
  type ContextMenuParams,
  Menu,
  type MenuItemConstructorOptions,
} from 'electron'
import type { MenuRole, MenuSpecItem } from '../shared/types'

/*
 * Menu de contexto do editor. A interface descreve os itens (MenuSpecItem) e o
 * main monta um menu NATIVO do sistema, com submenus e atalhos.
 *
 * Correção ortográfica: o Chromium só informa a palavra errada e as sugestões
 * ao processo principal (evento "context-menu"). Guardamos esses dados por um
 * instante e, se o clique foi numa palavra errada, as sugestões aparecem no topo.
 */

const ROLES = new Set<MenuRole>(['cut', 'copy', 'paste', 'pasteAndMatchStyle', 'selectAll'])

let lastParams: { params: ContextMenuParams; at: number } | null = null
let waiter: ((params: ContextMenuParams) => void) | null = null

/** Chamado pelo evento "context-menu" do webContents. */
export function recordContextParams(params: ContextMenuParams): void {
  lastParams = { params, at: Date.now() }
  waiter?.(params)
  waiter = null
}

/** Parâmetros do clique atual: usa o recente ou espera um pouco pelo evento. */
function currentParams(timeoutMs = 150): Promise<ContextMenuParams | null> {
  if (lastParams && Date.now() - lastParams.at < 400) return Promise.resolve(lastParams.params)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiter = null
      resolve(null)
    }, timeoutMs)
    waiter = (params) => {
      clearTimeout(timer)
      resolve(params)
    }
  })
}

function toTemplate(items: unknown, choose: (id: string) => void, depth = 0): MenuItemConstructorOptions[] {
  if (!Array.isArray(items) || depth > 3) return []
  const out: MenuItemConstructorOptions[] = []
  for (const raw of items.slice(0, 80) as MenuSpecItem[]) {
    if (!raw || typeof raw !== 'object') continue
    if (raw.type === 'separator') {
      out.push({ type: 'separator' })
      continue
    }
    const label = typeof raw.label === 'string' ? raw.label.slice(0, 80) : ''
    if (!label) continue
    const item: MenuItemConstructorOptions = { label, enabled: raw.enabled !== false }
    if (typeof raw.accelerator === 'string') {
      item.accelerator = raw.accelerator
      // Só exibe o atalho; quem executa é o editor (evita disparar duas vezes).
      item.registerAccelerator = false
    }
    if (raw.role && ROLES.has(raw.role)) {
      item.role = raw.role
    } else if (Array.isArray(raw.submenu)) {
      item.submenu = toTemplate(raw.submenu, choose, depth + 1)
    } else if (typeof raw.id === 'string') {
      const id = raw.id
      item.click = () => choose(id)
    }
    out.push(item)
  }
  return out
}

/** Palavra errada e sugestões do clique atual (para o menu desenhado pela interface). */
export async function spellingAtClick(): Promise<{ word: string; suggestions: string[] } | null> {
  const params = await currentParams()
  if (!params?.misspelledWord) return null
  return { word: params.misspelledWord, suggestions: params.dictionarySuggestions.slice(0, 5) }
}

export async function showContextMenu(win: BrowserWindow | null, items: unknown): Promise<string | null> {
  const params = await currentParams()
  lastParams = null

  return new Promise((resolve) => {
    let chosen: string | null = null
    const template = toTemplate(items, (id) => {
      chosen = id
    })

    // Sugestões de ortografia no topo, como nos editores do sistema.
    if (win && params?.misspelledWord) {
      const word = params.misspelledWord
      const suggestions: MenuItemConstructorOptions[] = params.dictionarySuggestions.slice(0, 5).map((s) => ({
        label: s,
        click: () => win.webContents.replaceMisspelling(s),
      }))
      if (suggestions.length === 0) suggestions.push({ label: 'Nenhuma sugestão', enabled: false })
      template.unshift(
        ...suggestions,
        {
          label: `Adicionar "${word}" ao dicionário`,
          click: () => win.webContents.session.addWordToSpellCheckerDictionary(word),
        },
        { type: 'separator' },
      )
    }

    Menu.buildFromTemplate(template).popup({
      ...(win ? { window: win } : {}),
      callback: () => resolve(chosen),
    })
  })
}
