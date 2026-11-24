// Utilitários de caminho relativo para a interface (sempre com "/").

export function parentOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

export function join(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

/** true se `path` é `base` ou está dentro da pasta `base`. */
export function isWithin(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`)
}

/** Troca o prefixo `from` por `to` (usado ao renomear pastas). */
export function replacePrefix(path: string, from: string, to: string): string {
  return path === from ? to : `${to}${path.slice(from.length)}`
}

export function titleOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name
}
