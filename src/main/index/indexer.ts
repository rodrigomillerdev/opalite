import type { TreeNode, VaultEvent } from '../../shared/types'
import type { VaultService } from '../vault/vault-service'
import type { VaultIndex } from './vault-index'

function collectFiles(nodes: TreeNode[], ext: 'md' | 'canvas', out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === 'file') {
      if (node.ext === ext) out.push(node.path)
    } else collectFiles(node.children, ext, out)
  }
  return out
}

function collectAttachments(nodes: TreeNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === 'file') {
      if (node.ext !== 'md' && node.ext !== 'canvas') out.push(node.path)
    } else collectAttachments(node.children, out)
  }
  return out
}

/** Lê todas as notas (e canvas) do cofre e reconstrói o índice do zero. */
export async function rebuildIndex(vault: VaultService, index: VaultIndex): Promise<void> {
  const tree = await vault.tree()
  await index.build(collectFiles(tree, 'md'), async (path) => (await vault.read(path)).content)
  index.setFiles(collectAttachments(tree))
  for (const path of collectFiles(tree, 'canvas')) {
    try {
      index.setCanvas(path, (await vault.read(path)).content)
    } catch {
      // canvas ilegível: aparece no grafo sem conexões
    }
  }
}

/** Aplica ao índice um lote de eventos do observador de arquivos. */
export async function applyVaultEvents(
  events: VaultEvent[],
  vault: VaultService,
  index: VaultIndex,
): Promise<boolean> {
  if (!vault.info()) return false
  // Só o último evento de cada caminho importa.
  const last = new Map<string, VaultEvent['type']>()
  for (const e of events) last.set(e.path, e.type)

  let changed = false
  for (const [path, type] of last) {
    const isNote = path.toLowerCase().endsWith('.md')
    const isCanvas = path.toLowerCase().endsWith('.canvas')
    if ((type === 'add' || type === 'change') && isCanvas) {
      try {
        index.setCanvas(path, (await vault.read(path)).content)
        changed = true
      } catch {
        // será tratado no próximo evento
      }
    } else if ((type === 'add' || type === 'change') && isNote) {
      try {
        // set() devolve false quando é só o eco de um save feito pelo app.
        if (index.set(path, (await vault.read(path)).content)) changed = true
      } catch {
        // pode ter sido apagado logo depois; o "unlink" virá em seguida
      }
    } else if (type === 'add' && !isNote && !isCanvas) {
      index.addFile(path)
      changed = true
    } else if (type === 'unlink' || type === 'unlinkDir') {
      index.remove(path)
      changed = true
    }
  }
  return changed
}
