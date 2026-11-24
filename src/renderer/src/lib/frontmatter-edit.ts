/*
 * Edita chaves de primeiro nível do frontmatter YAML sem reescrever o resto
 * (comentários, ordem e formatação das outras chaves ficam como estavam).
 * Usado pela capa da nota (banner, banner_y).
 */

const BLOCK = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/

function formatValue(value: string): string {
  // Aspas quando o YAML poderia interpretar errado (":", "#", começo especial...).
  const plain =
    /^[\p{L}\p{N}_./-][\p{L}\p{N}_./: -]*$/u.test(value) &&
    !value.includes(': ') &&
    !/\s$/.test(value) &&
    !/^(true|false|null|yes|no|~|\d[\d.]*)$/i.test(value)
  return plain
    ? value
    : JSON.stringify(value)
}

/** Aplica `updates` (null remove a chave). Devolve o texto novo. */
export function setFrontmatter(text: string, updates: Record<string, string | null>): string {
  const match = BLOCK.exec(text)
  const body = match ? text.slice(match[0].length) : text
  let lines = match && match[1] !== undefined ? match[1].split(/\r?\n/) : []
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  if (lines.length === 1 && lines[0] === '') lines = []

  for (const [key, value] of Object.entries(updates)) {
    const start = lines.findIndex((l) => new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`).test(l))
    // Linhas seguintes recuadas (listas, valores multilinha) pertencem à mesma chave.
    let end = start + 1
    if (start !== -1) while (end < lines.length && /^\s+\S|^\s*-\s/.test(lines[end]!)) end++
    if (value === null) {
      if (start !== -1) lines.splice(start, end - start)
    } else if (start !== -1) {
      lines.splice(start, end - start, `${key}: ${formatValue(value)}`)
    } else {
      lines.push(`${key}: ${formatValue(value)}`)
    }
  }

  if (lines.length === 0) return match ? body.replace(/^\r?\n/, '') : text
  const head = `---${eol}${lines.join(eol)}${eol}---${eol}`
  return head + (match ? body : body.startsWith(eol) ? body : `${eol}${body}`)
}

/** Tamanho do bloco de frontmatter (0 se não houver). */
export function frontmatterLength(text: string): number {
  return BLOCK.exec(text)?.[0].length ?? 0
}
