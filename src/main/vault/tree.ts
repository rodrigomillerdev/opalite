import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { TreeNode } from '../../shared/types'
import { fileKind, joinRel } from './paths'

// Collator com `numeric: true` ordena "Aula 2" antes de "Aula 10",
// e `sensitivity: 'base'` ignora maiúsculas e acentos na comparação.
const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })

/** Pastas primeiro, depois arquivos, cada grupo em ordem natural. */
export function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
  return collator.compare(a.name, b.name)
}

/**
 * Lê a árvore do cofre recursivamente. Regras:
 * - itens que começam com "." ficam de fora (.git, .opalite...);
 * - links simbólicos são ignorados (evita loops e fuga da pasta do cofre);
 * - mostramos notas, canvas e anexos de tipos conhecidos (PDF, DOCX, imagens...).
 */
export async function readTree(root: string, rel = ''): Promise<TreeNode[]> {
  const dirAbs = rel ? path.join(root, ...rel.split('/')) : root
  let entries
  try {
    entries = await fs.readdir(dirAbs, { withFileTypes: true })
  } catch {
    return [] // pasta removida durante a leitura, sem permissão etc.
  }

  const nodes = await Promise.all(
    entries.map(async (entry): Promise<TreeNode | null> => {
      if (entry.name.startsWith('.')) return null
      const childRel = joinRel(rel, entry.name)
      if (entry.isDirectory()) {
        return {
          kind: 'folder',
          path: childRel,
          name: entry.name,
          children: await readTree(root, childRel),
        }
      }
      const kind = entry.isFile() ? fileKind(entry.name) : null
      if (kind) {
        // Notas e canvas mostram o nome sem extensão; anexos mostram o nome completo.
        const strip = kind === 'md' || kind === 'canvas'
        return {
          kind: 'file',
          path: childRel,
          name: entry.name,
          title: strip ? entry.name.slice(0, entry.name.lastIndexOf('.')) : entry.name,
          ext: kind,
        }
      }
      return null
    }),
  )

  return nodes.filter((n): n is TreeNode => n !== null).sort(compareNodes)
}
