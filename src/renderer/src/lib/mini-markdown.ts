/*
 * Renderizador Markdown mínimo e seguro para os cartões do canvas.
 * Todo o texto é escapado ANTES das substituições, então nenhum HTML da nota
 * chega ao DOM. Cobre o essencial: títulos, listas, tarefas, citações,
 * negrito, itálico, tachado, realce, código, [[links]] e [links](url).
 */

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

function inline(text: string): string {
  return escape(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => `<a data-link="${target.trim()}">${(alias ?? target).trim()}</a>`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a data-url="$2">$1</a>')
}

export function renderMiniMarkdown(source: string): string {
  const out: string[] = []
  let list: 'ul' | null = null
  let inCode = false
  const closeList = () => {
    if (list) out.push('</ul>')
    list = null
  }
  for (const line of source.split('\n')) {
    if (/^\s*```/.test(line)) {
      closeList()
      out.push(inCode ? '</code></pre>' : '<pre><code>')
      inCode = !inCode
      continue
    }
    if (inCode) {
      out.push(`${escape(line)}\n`)
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    const task = /^\s*[-*+] \[( |x|X)\] (.*)$/.exec(line)
    const bullet = /^\s*(?:[-*+]|\d+[.)]) (.*)$/.exec(line)
    if (heading) {
      closeList()
      out.push(`<h${Math.min(heading[1]!.length + 1, 6)}>${inline(heading[2]!)}</h${Math.min(heading[1]!.length + 1, 6)}>`)
    } else if (task || bullet) {
      if (!list) out.push('<ul>')
      list = 'ul'
      out.push(task ? `<li class="task${task[1] !== ' ' ? ' done' : ''}">${inline(task[2]!)}</li>` : `<li>${inline(bullet![1]!)}</li>`)
    } else if (/^>\s?/.test(line)) {
      closeList()
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`)
    } else if (line.trim() === '') {
      closeList()
    } else {
      closeList()
      out.push(`<p>${inline(line)}</p>`)
    }
  }
  closeList()
  if (inCode) out.push('</code></pre>')
  return out.join('')
}
