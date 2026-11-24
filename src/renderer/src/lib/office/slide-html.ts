import { type Para, type Run, fontCss } from './presentation'

/* Parágrafos de slide -> HTML (usado no editor, nas miniaturas e na exportação para PDF). */

export const PT = 4 / 3

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const attr = (s: string) => esc(s).replace(/"/g, '&quot;')

function runHtml(r: Run): string {
  const css = [
    r.b ? 'font-weight:700' : '',
    r.i ? 'font-style:italic' : '',
    r.u || r.s ? `text-decoration:${[r.u && 'underline', r.s && 'line-through'].filter(Boolean).join(' ')}` : '',
    r.size ? `font-size:${(r.size * PT).toFixed(1)}px` : '',
    r.color ? `color:${r.color}` : '',
    r.font ? `font-family:${fontCss(r.font)}` : '',
    r.spacing ? `letter-spacing:${(r.spacing * PT).toFixed(2)}px` : '',
  ]
    .filter(Boolean)
    .join(';')
  const text = esc(r.text).replace(/\n/g, '<br>')
  return css ? `<span style="${attr(css)}">${text}</span>` : text
}

const listOf = (p: Para) => (p.numbered ? 'ol' : p.bullet ? 'ul' : null)

export function parasToHtml(paras: Para[]): string {
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  for (const p of paras) {
    const css = [p.align && p.align !== 'left' ? `text-align:${p.align}` : '', p.lineHeight ? `line-height:${p.lineHeight}` : ''].filter(Boolean).join(';')
    const style = css ? ` style="${css}"` : ''
    const body = p.runs.map(runHtml).join('') || '<br>'
    const kind = listOf(p)
    if (kind !== list) {
      if (list) out.push(`</${list}>`)
      if (kind) out.push(`<${kind}>`)
      list = kind
    }
    out.push(kind ? `<li${style}>${body}</li>` : `<div${style}>${body}</div>`)
  }
  if (list) out.push(`</${list}>`)
  return out.join('') || '<div><br></div>'
}
