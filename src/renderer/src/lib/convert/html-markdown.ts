/*
 * HTML (vindo de um .docx) -> Markdown. Títulos, parágrafos, negrito,
 * itálico, tachado, código, links, listas (aninhadas), citações, tabelas e
 * imagens. As imagens são entregues a `onImage`, que as grava no cofre e
 * devolve o caminho para o link ![[...]].
 */

export async function htmlToMarkdown(html: string, onImage: (dataUrl: string, index: number) => Promise<string | null>): Promise<string> {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  let imageIndex = 0

  const inline = async (node: Node): Promise<string> => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ').replace(/([*_`[\]])/g, '\\$1')
    if (!(node instanceof HTMLElement)) return ''
    const inner = async () => (await Promise.all([...node.childNodes].map(inline))).join('')
    switch (node.tagName) {
      case 'STRONG':
      case 'B': {
        const t = (await inner()).trim()
        return t ? `**${t}**` : ''
      }
      case 'EM':
      case 'I': {
        const t = (await inner()).trim()
        return t ? `*${t}*` : ''
      }
      case 'S':
      case 'DEL':
      case 'STRIKE': {
        const t = (await inner()).trim()
        return t ? `~~${t}~~` : ''
      }
      case 'U':
        return inner()
      case 'CODE':
        return `\`${node.textContent ?? ''}\``
      case 'BR':
        return '  \n'
      case 'A': {
        const href = node.getAttribute('href') ?? ''
        const t = (await inner()).trim()
        return /^(https?:|mailto:)/i.test(href) ? `[${t || href}](${href})` : t
      }
      case 'IMG': {
        const src = node.getAttribute('src') ?? ''
        if (!src.startsWith('data:image/')) return ''
        const path = await onImage(src, ++imageIndex)
        return path ? `![[${path}]]` : ''
      }
      case 'SUP':
        return `^${await inner()}`
      default:
        return inner()
    }
  }

  const list = async (el: HTMLElement, depth: number): Promise<string> => {
    const ordered = el.tagName === 'OL'
    let out = ''
    let n = 1
    for (const li of [...el.children]) {
      if (li.tagName !== 'LI') continue
      let text = ''
      let nested = ''
      for (const c of [...li.childNodes]) {
        if (c instanceof HTMLElement && (c.tagName === 'UL' || c.tagName === 'OL')) nested += await list(c, depth + 1)
        else if (c instanceof HTMLElement && c.tagName === 'P') text += (await inline(c)).trim() + ' '
        else text += await inline(c)
      }
      out += `${'  '.repeat(depth)}${ordered ? `${n++}.` : '-'} ${text.trim()}\n${nested}`
    }
    return out
  }

  const table = async (el: HTMLTableElement): Promise<string> => {
    const rows: string[][] = []
    for (const tr of [...el.rows]) rows.push(await Promise.all([...tr.cells].map(async (c) => (await inline(c)).trim().replace(/\|/g, '\\|').replace(/\n/g, ' '))))
    if (!rows.length) return ''
    const cols = Math.max(...rows.map((r) => r.length))
    const line = (r: string[]) => `| ${Array.from({ length: cols }, (_, i) => r[i] ?? '').join(' | ')} |`
    return [line(rows[0]!), `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n') + '\n'
  }

  const blocks = async (container: Element): Promise<string[]> => {
    const out: string[] = []
    for (const node of [...container.childNodes]) {
      if (!(node instanceof HTMLElement)) {
        const t = (await inline(node)).trim()
        if (t) out.push(t)
        continue
      }
      const tag = node.tagName
      const h = /^H([1-6])$/.exec(tag)
      if (h) out.push(`${'#'.repeat(Number(h[1]))} ${(await inline(node)).trim()}`)
      else if (tag === 'P' || tag === 'DIV') {
        const t = (await inline(node)).trim()
        if (t) out.push(t)
      } else if (tag === 'UL' || tag === 'OL') out.push((await list(node, 0)).trimEnd())
      else if (tag === 'TABLE') out.push((await table(node as HTMLTableElement)).trimEnd())
      else if (tag === 'BLOCKQUOTE') out.push((await blocks(node)).map((b) => b.split('\n').map((l) => `> ${l}`).join('\n')).join('\n>\n'))
      else if (tag === 'PRE') out.push(`\`\`\`\n${node.textContent ?? ''}\n\`\`\``)
      else if (tag === 'HR') out.push('---')
      else {
        const t = (await inline(node)).trim()
        if (t) out.push(t)
      }
    }
    return out
  }

  return (await blocks(doc.body)).join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n'
}
