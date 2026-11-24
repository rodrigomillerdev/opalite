import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { TagCount } from '../../../shared/types'
import { useIndex } from '../state/index-store'
import { useWorkspace } from '../state/workspace-store'
import treeStyles from './FileTree.module.css'
import styles from './Panels.module.css'

interface TagNode {
  tag: string
  name: string
  count: number
  children: TagNode[]
}

/** Monta a hierarquia "projeto" > "projeto/opalite" a partir da lista plana. */
function buildTree(tags: TagCount[]): TagNode[] {
  const nodes = new Map<string, TagNode>()
  const roots: TagNode[] = []
  for (const { tag, count } of tags) {
    const node: TagNode = { tag, name: tag.slice(tag.lastIndexOf('/') + 1), count, children: [] }
    nodes.set(tag, node)
    const parent = tag.includes('/') ? nodes.get(tag.slice(0, tag.lastIndexOf('/'))) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

export function TagsView() {
  const tags = useIndex((s) => s.tags)
  const tree = useMemo(() => buildTree(tags), [tags])
  const [open, setOpen] = useState<Record<string, boolean>>({})

  if (tree.length === 0) {
    return (
      <div className={styles.scroll}>
        <div className={styles.hint}>
          Nenhuma tag ainda. Escreva <code>#ideia</code> em uma nota ou use <code>tags:</code> no frontmatter.
        </div>
      </div>
    )
  }

  const render = (node: TagNode, depth: number): React.ReactNode => (
    <div key={node.tag} role="none">
      <div
        role="treeitem"
        tabIndex={0}
        aria-expanded={node.children.length ? Boolean(open[node.tag]) : undefined}
        className={treeStyles.row}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => useWorkspace.getState().search(`tag:${node.tag}`)}
        onKeyDown={(e) => e.key === 'Enter' && useWorkspace.getState().search(`tag:${node.tag}`)}
        title={`Buscar notas com #${node.tag}`}
      >
        <span
          className={treeStyles.chevron}
          data-open={open[node.tag] || undefined}
          onClick={(e) => {
            if (!node.children.length) return
            e.stopPropagation()
            setOpen((o) => ({ ...o, [node.tag]: !o[node.tag] }))
          }}
        >
          {node.children.length > 0 && <ChevronRight size={13} strokeWidth={2} />}
        </span>
        <span className={treeStyles.label}>#{node.name}</span>
        <span className={styles.count} style={{ marginLeft: 'auto' }}>
          {node.count}
        </span>
      </div>
      {open[node.tag] && node.children.map((c) => render(c, depth + 1))}
    </div>
  )

  return (
    <div className={styles.scroll} role="tree" aria-label="Tags do cofre">
      {tree.map((n) => render(n, 0))}
    </div>
  )
}
