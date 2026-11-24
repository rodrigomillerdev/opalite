import { GFM, parser as baseParser } from '@lezer/markdown'
import type { SyntaxNode } from '@lezer/common'

/*
 * Markdown -> HTML para exportar notas (DOCX, PDF, HTML). Usa o mesmo
 * analisador do editor (Lezer, com tabelas, tachado e tarefas do GFM) e
 * entende a sintaxe do Obsidian: [[links]], ![[imagens]], ==realce==,
 * callouts "> [!nota]" e frontmatter (removido). Todo texto é escapado.
 */

const parser = baseParser.configure([GFM])

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface MdOptions {
  /** Converte ![[imagem]] em data: URL (ou null se não houver). */
  image?(target: string): string | null
}

/*
 * [[links]], ![[imagens]] e o "[!tipo]" dos callouts viram marcadores antes da
 * análise: o Lezer leria esses colchetes como links do Markdown.
 */
const TOKEN = /\u0001(\d+)\u0001/g

function renderWiki(embed: boolean, inner: string, opts: MdOptions): string {
  const [target = '', ...rest] = inner.split('|')
  if (embed) {
    const src = opts.image?.(target.trim())
    const width = rest.map((r) => /^(\d+)(?:x(\d+))?$/.exec(r.trim())).find(Boolean)
    const align = rest.map((r) => r.trim()).find((r) => r === 'center' || r === 'right')
    if (!src) return `<em>[${esc(target)}]</em>`
    const img = `<img src="${src}" alt="${esc(target)}"${width ? ` width="${width[1]}"${width[2] ? ` height="${width[2]}"` : ''}` : ''}>`
    return align ? `<span style="display:block;text-align:${align}">${img}</span>` : img
  }
  const alias = rest.join('|').trim()
  return `<span class="wikilink">${esc(alias || target.replace(/#/g, ' › '))}</span>`
}

/** Texto comum: escapa, aplica ==realce== e devolve os marcadores guardados. */
function inlineText(text: string, tokens: string[]): string {
  return esc(text)
    .replace(/==([^=\n]+)==/g, '<mark>$1</mark>')
    .replace(TOKEN, (_m, i: string) => tokens[Number(i)] ?? '')
}

export function markdownToHtml(source: string, opts: MdOptions = {}): string {
  const tokens: string[] = []
  const keep = (html: string) => `\u0001${tokens.push(html) - 1}\u0001`
  const md = source
    .replace(/^﻿/, '')
    .replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '')
    .replace(/(!?)\[\[([^\]\n]+)\]\]/g, (_m, bang: string, inner: string) => keep(renderWiki(Boolean(bang), inner, opts)))
    // Cabeçalho de callout: "> [!tip] Título"
    .replace(/^(>\s*)\[!(\w+)\][+-]?[ \t]*(.*)$/gm, (_m, q: string, type: string, title: string) => `${q}\u0002${type.toLowerCase()}\u0002${title}`)
  const tree = parser.parse(md)
  const slice = (from: number, to: number) => md.slice(from, to)

  /** Conteúdo inline de um nó: texto entre os filhos + filhos convertidos. */
  const inline = (node: SyntaxNode, from = node.from, to = node.to): string => {
    let out = ''
    let pos = from
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.to <= from || c.from >= to) continue
      if (c.from > pos) out += inlineText(slice(pos, c.from), tokens)
      out += inlineNode(c)
      pos = c.to
    }
    if (pos < to) out += inlineText(slice(pos, to), tokens)
    return out
  }

  const marksInside = (node: SyntaxNode, mark: string) => {
    const first = node.firstChild
    const last = node.lastChild
    const start = first && first.name === mark ? first.to : node.from
    const end = last && last.name === mark && last !== first ? last.from : node.to
    return { start, end }
  }

  const inlineNode = (n: SyntaxNode): string => {
    switch (n.name) {
      case 'Emphasis': {
        const { start, end } = marksInside(n, 'EmphasisMark')
        return `<em>${inline(n, start, end)}</em>`
      }
      case 'StrongEmphasis': {
        const { start, end } = marksInside(n, 'EmphasisMark')
        return `<strong>${inline(n, start, end)}</strong>`
      }
      case 'Strikethrough': {
        const { start, end } = marksInside(n, 'StrikethroughMark')
        return `<del>${inline(n, start, end)}</del>`
      }
      case 'InlineCode': {
        const { start, end } = marksInside(n, 'CodeMark')
        return `<code>${esc(slice(start, end).replace(TOKEN, ""))}</code>`
      }
      case 'Link': {
        const url = n.getChild('URL')
        const marks = n.getChildren('LinkMark')
        const textEnd = marks[1]?.from ?? n.to
        const textStart = marks[0]?.to ?? n.from
        const href = url ? slice(url.from, url.to) : ''
        const label = inline(n, textStart, textEnd)
        return /^(https?:|mailto:)/i.test(href) ? `<a href="${esc(href)}">${label}</a>` : label
      }
      case 'Image': {
        const url = n.getChild('URL')
        const marks = n.getChildren('LinkMark')
        const alt = slice(marks[0]?.to ?? n.from, marks[1]?.from ?? n.to)
        const href = url ? slice(url.from, url.to) : ''
        const src = /^data:image\//.test(href) ? href : opts.image?.(decodeURI(href)) ?? null
        return src ? `<img src="${src}" alt="${esc(alt)}">` : `<em>[${esc(alt || href)}]</em>`
      }
      case 'URL':
      case 'Autolink': {
        const href = slice(n.from, n.to).replace(/^<|>$/g, '')
        return /^(https?:|mailto:)/i.test(href) ? `<a href="${esc(href)}">${esc(href)}</a>` : esc(href)
      }
      case 'HardBreak':
        return '<br>'
      case 'EmphasisMark':
      case 'CodeMark':
      case 'LinkMark':
      case 'StrikethroughMark':
        return ''
      case 'HTMLTag':
      case 'Comment':
      case 'QuoteMark':
        return ''
      case 'Escape':
        return esc(slice(n.from + 1, n.to))
      case 'Entity':
        return slice(n.from, n.to)
      default:
        return inline(n)
    }
  }

  const block = (n: SyntaxNode): string => {
    const name = n.name
    const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name)
    if (heading) {
      const mark = n.getChild('HeaderMark')
      const start = name.startsWith('ATX') && mark ? mark.to : n.from
      let end = n.to
      if (name.startsWith('Setext')) end = n.lastChild?.from ?? n.to
      const level = heading[1]
      return `<h${level}>${inline(n, start, end).trim()}</h${level}>\n`
    }
    switch (name) {
      case 'Paragraph':
        return `<p>${inline(n).trim()}</p>\n`
      case 'BulletList':
      case 'OrderedList': {
        const tag = name === 'BulletList' ? 'ul' : 'ol'
        let items = ''
        for (let li = n.firstChild; li; li = li.nextSibling) if (li.name === 'ListItem') items += listItem(li)
        return `<${tag}>${items}</${tag}>\n`
      }
      case 'Blockquote': {
        const inner = children(n).map(block).join('')
        // Callout do Obsidian (marcado antes da análise como \u0002tipo\u0002Título).
        const callout = /^<p>\u0002(\w+)\u0002([^\n<]*)\n?/.exec(inner)
        if (callout) {
          const body = inner.slice(callout[0].length).replace(/^/, '<p>').replace(/^<p><\/p>\n?/, '')
          const title = callout[2]!.trim() || callout[1]!
          return `<blockquote class="callout" data-type="${callout[1]}"><p class="callout-title"><strong>${title}</strong></p>${body}</blockquote>\n`
        }
        return `<blockquote>${inner}</blockquote>\n`
      }
      case 'FencedCode': {
        const info = n.getChild('CodeInfo')
        const text = n.getChild('CodeText')
        const lang = info ? slice(info.from, info.to).trim() : ''
        return `<pre${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${text ? esc(slice(text.from, text.to)) : ''}</code></pre>\n`
      }
      case 'CodeBlock':
        return `<pre><code>${esc(slice(n.from, n.to).replace(/^ {4}/gm, ''))}</code></pre>\n`
      case 'HorizontalRule':
        return '<hr>\n'
      case 'Table': {
        let html = '<table>'
        for (let r = n.firstChild; r; r = r.nextSibling) {
          if (r.name !== 'TableHeader' && r.name !== 'TableRow') continue
          const tag = r.name === 'TableHeader' ? 'th' : 'td'
          const cells = r.getChildren('TableCell').map((c) => `<${tag}>${inline(c).trim()}</${tag}>`)
          html += r.name === 'TableHeader' ? `<thead><tr>${cells.join('')}</tr></thead><tbody>` : `<tr>${cells.join('')}</tr>`
        }
        return `${html}</tbody></table>\n`
      }
      case 'HTMLBlock':
      case 'CommentBlock':
      case 'LinkReference':
        return ''
      default:
        return children(n).map(block).join('')
    }
  }

  const listItem = (li: SyntaxNode): string => {
    const task = li.getChild('Task')
    if (task) {
      const marker = task.getChild('TaskMarker')
      const done = marker ? /x/i.test(slice(marker.from, marker.to)) : false
      const text = inline(task, marker ? marker.to : task.from, task.to).trim()
      return `<li class="task"><span class="box">${done ? '☑' : '☐'}</span> ${done ? `<del>${text}</del>` : text}</li>`
    }
    let html = ''
    for (let c = li.firstChild; c; c = c.nextSibling) {
      if (c.name === 'ListMark') continue
      // Parágrafo único de item: sem <p> (lista compacta).
      html += c.name === 'Paragraph' ? inline(c).trim() : block(c)
    }
    return `<li>${html}</li>`
  }

  const children = (n: SyntaxNode) => {
    const out: SyntaxNode[] = []
    for (let c = n.firstChild; c; c = c.nextSibling) if (c.name !== 'QuoteMark') out.push(c)
    return out
  }

  return block(tree.topNode)
}

/** Folha de estilo de impressão comum aos PDFs exportados. */
export const PRINT_CSS = `
@page { size: A4; margin: 22mm 20mm 24mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: "Segoe UI", "Inter", system-ui, sans-serif; font-size: 11pt; line-height: 1.6; color: #1b1a20; margin: 0; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.2em 0 0.45em; break-after: avoid; color: #111; }
h1 { font-size: 22pt; } h2 { font-size: 17pt; } h3 { font-size: 14pt; } h4 { font-size: 12pt; }
p { margin: 0 0 0.7em; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 0.8em; padding-left: 1.4em; }
li { margin: 0.15em 0; }
li.task { list-style: none; margin-left: -1.2em; }
table { border-collapse: collapse; width: 100%; margin: 0.6em 0 1em; font-size: 10pt; }
tr { break-inside: avoid; }
td, th { border: 1px solid #c9c7cf; padding: 5px 8px; vertical-align: top; text-align: left; }
th { background: #f1f0f4; }
img { max-width: 100%; height: auto; break-inside: avoid; }
blockquote { margin: 0.8em 0; padding: 0.2em 0 0.2em 14px; border-left: 3px solid #b9b2f0; color: #444; }
blockquote.callout { padding: 10px 14px; border-radius: 6px; background: #f4f2ff; }
pre { background: #f6f5f8; border-radius: 6px; padding: 10px 12px; font-size: 9.5pt; white-space: pre-wrap; break-inside: avoid; }
code { font-family: "Cascadia Code", Consolas, monospace; font-size: 0.92em; }
mark { background: #fff3a3; }
.wikilink { color: #4b3fc4; }
a { color: #3d4fc4; text-decoration: none; }
hr { border: 0; border-top: 1px solid #ddd; margin: 1.4em 0; }
`
