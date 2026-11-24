import {
  BookPlus,
  Bold,
  Clipboard,
  ClipboardType,
  Code,
  Copy,
  Database,
  Footprints,
  Heading,
  Highlighter,
  Image,
  Italic,
  Link,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  MessageSquare,
  Minus,
  Pilcrow,
  Plus,
  Quote,
  RemoveFormatting,
  Scissors,
  Sigma,
  SpellCheck,
  SquareCode,
  Strikethrough,
  Table,
  TextSelect,
  TriangleAlert,
  Type,
} from 'lucide-react'
import type { MenuRole } from '../../../shared/types'
import { type MenuItem, openMenu } from '../components/ui/Menu'
import { COMMANDS, formatHotkey } from '../lib/commands'
import { HIGHLIGHTS } from './format'

/*
 * Menu do botão direito no editor, desenhado pelo próprio Opalite (com
 * animação, ícones e o mesmo visual do resto do app). Cada item aponta para um
 * comando do registro (lib/commands.ts), então a paleta e o menu fazem
 * exatamente a mesma coisa. Recortar/copiar/colar usam as ações do sistema e
 * as sugestões de ortografia vêm do dicionário do sistema.
 */

function shortcut(id: string): string | undefined {
  const cmd = COMMANDS.find((c) => c.id === id)
  const key = cmd?.hotkey ?? cmd?.editorKey
  return key ? formatHotkey(key).join('+') : undefined
}

const item = (id: string, label: string, icon?: MenuItem['icon']): MenuItem => ({ id, label, icon, shortcut: shortcut(id) })
const sep: MenuItem = { type: 'separator' }

export function editorMenu(hasSelection: boolean): MenuItem[] {
  return [
    item('wikilink', 'Adicionar link', Link2),
    item('md-link', 'Adicionar link externo', Link),
    sep,
    {
      label: 'Formatar',
      icon: Type,
      submenu: [
        item('bold', 'Negrito', Bold),
        item('italic', 'Itálico', Italic),
        item('strike', 'Riscado', Strikethrough),
        { label: 'Realce', icon: Highlighter, submenu: HIGHLIGHTS.map((h) => item(`highlight-${h.id}`, h.label)) },
        item('code', 'Código', Code),
        item('math-inline', 'Equação', Sigma),
        item('comment', 'Comentário', MessageSquare),
        sep,
        item('clear-format', 'Limpar formatação', RemoveFormatting),
      ],
    },
    {
      label: 'Parágrafo',
      icon: Pilcrow,
      submenu: [
        item('bullet', 'Lista com marcadores', List),
        item('numbered', 'Lista numerada', ListOrdered),
        item('task', 'Lista de tarefas', ListChecks),
        sep,
        ...[1, 2, 3, 4, 5, 6].map((n) => item(`h${n}`, `Título ${n}`, Heading)),
        item('paragraph', 'Texto', Pilcrow),
        sep,
        item('quote', 'Citação', Quote),
      ],
    },
    {
      label: 'Inserir',
      icon: Plus,
      submenu: [
        item('footnote', 'Nota de rodapé', Footprints),
        item('table', 'Tabela', Table),
        item('insert-image', 'Imagem…', Image),
        item('callout', 'Destaque', TriangleAlert),
        item('hr', 'Régua horizontal', Minus),
        item('code-block', 'Bloco de código', SquareCode),
        item('math-block', 'Equação em bloco', Sigma),
        sep,
        item('base', 'Nova base', Database),
      ],
    },
    sep,
    { id: 'edit:cut', label: 'Recortar', icon: Scissors, shortcut: 'Ctrl+X', disabled: !hasSelection },
    { id: 'edit:copy', label: 'Copiar', icon: Copy, shortcut: 'Ctrl+C', disabled: !hasSelection },
    { id: 'edit:paste', label: 'Colar', icon: Clipboard, shortcut: 'Ctrl+V' },
    { id: 'edit:pasteAndMatchStyle', label: 'Colar como texto simples', icon: ClipboardType, shortcut: 'Ctrl+Shift+V' },
    // Selecionar tudo pelo CodeMirror: o editor só mantém no DOM as linhas visíveis.
    item('select-all', 'Selecionar tudo', TextSelect),
  ]
}

/** Abre o menu no ponto do clique e executa o comando escolhido. */
export async function openEditorMenu(hasSelection: boolean, at: { x: number; y: number }): Promise<void> {
  const spelling = await window.opalite.ui.spelling().catch(() => null)
  const items = editorMenu(hasSelection)
  if (spelling) {
    items.unshift(
      { type: 'label', label: `Ortografia: “${spelling.word}”` },
      ...(spelling.suggestions.length ? spelling.suggestions.map((s) => ({ id: `spell:${s}`, label: s, icon: SpellCheck })) : [{ label: 'Nenhuma sugestão', disabled: true }]),
      { id: `dict:${spelling.word}`, label: `Adicionar “${spelling.word}” ao dicionário`, icon: BookPlus },
      sep,
    )
  }
  const id = await openMenu(items, at)
  if (!id) return
  if (id.startsWith('spell:')) return void window.opalite.ui.replaceMisspelling(id.slice(6))
  if (id.startsWith('dict:')) return void window.opalite.ui.addToDictionary(id.slice(5))
  if (id.startsWith('edit:')) return void window.opalite.ui.edit(id.slice(5) as MenuRole)
  await COMMANDS.find((c) => c.id === id)?.run()
}
