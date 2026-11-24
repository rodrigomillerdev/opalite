// Resolução de wikilinks: dado "[[Nota]]" escrito em uma nota de origem,
// descobre qual arquivo do cofre ele representa.
//
// Regras (em ordem):
// 1. Se o destino tem "/", compara com o caminho completo (sem .md).
//    Se não achar, compara com o final do caminho ("Pasta/Nota" acha "A/Pasta/Nota.md").
// 2. Senão, procura pelo nome do arquivo e depois pelos apelidos (frontmatter "aliases").
// 3. Empate entre notas com o mesmo nome: vence a da mesma pasta da origem,
//    depois a de caminho mais curto.
// Tudo sem diferenciar maiúsculas de minúsculas.

export interface LinkableNote {
  path: string
  aliases?: string[]
}

export function stripMd(path: string): string {
  return path.toLowerCase().endsWith('.md') ? path.slice(0, -3) : path
}

export function basenameNoExt(path: string): string {
  return stripMd(path.slice(path.lastIndexOf('/') + 1))
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

export class LinkResolver {
  private byPath = new Map<string, string>()
  private byName = new Map<string, string[]>()
  private byAlias = new Map<string, string[]>()

  constructor(notes: Iterable<LinkableNote>) {
    for (const note of notes) {
      this.byPath.set(stripMd(note.path).toLowerCase(), note.path)
      push(this.byName, basenameNoExt(note.path).toLowerCase(), note.path)
      for (const alias of note.aliases ?? []) push(this.byAlias, alias.toLowerCase(), note.path)
    }
  }

  resolve(target: string, fromPath: string | null = null): string | null {
    const key = stripMd(target.trim().replace(/\\/g, '/').replace(/^\/+/, '')).toLowerCase()
    if (!key) return fromPath // "[[#Seção]]" aponta para a própria nota

    if (key.includes('/')) {
      const exact = this.byPath.get(key)
      if (exact) return exact
      const suffix = [...this.byPath.entries()].filter(([p]) => p.endsWith(`/${key}`)).map(([, v]) => v)
      return pickClosest(suffix, fromPath)
    }
    return pickClosest(this.byName.get(key) ?? [], fromPath) ?? pickClosest(this.byAlias.get(key) ?? [], fromPath)
  }

  /** Texto mais curto que ainda resolve para `path` a partir de qualquer nota. */
  linkTextFor(path: string): string {
    const name = basenameNoExt(path)
    const same = this.byName.get(name.toLowerCase()) ?? []
    return same.length <= 1 ? name : stripMd(path)
  }
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function pickClosest(candidates: string[], fromPath: string | null): string | null {
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]!
  const fromDir = fromPath ? dirOf(fromPath) : ''
  const sameDir = candidates.find((c) => dirOf(c) === fromDir)
  if (sameDir) return sameDir
  return [...candidates].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0]!
}
