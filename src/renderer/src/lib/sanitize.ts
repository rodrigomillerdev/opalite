/*
 * Saneador de HTML para conteúdo vindo de arquivos (pré-visualização de DOCX).
 * Usa o parser do próprio navegador (DOMParser, que não executa scripts) e
 * mantém só uma lista de tags e atributos seguros.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'a', 'img', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'blockquote',
  'pre', 'code', 'span', 'div', 'hr',
])
const ALLOWED_ATTRS: Record<string, string[]> = { a: ['href'], img: ['src', 'alt'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] }

export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      const tag = child.tagName.toLowerCase()
      if (!ALLOWED_TAGS.has(tag)) {
        // Tags perigosas somem com o conteúdo; as desconhecidas mantêm o texto.
        if (['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'svg', 'math'].includes(tag)) child.remove()
        else child.replaceWith(...child.childNodes)
        continue
      }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase()
        const value = attr.value.trim()
        const allowed = ALLOWED_ATTRS[tag]?.includes(name) ?? false
        const safe =
          name === 'href' ? /^(https?:|#)/i.test(value) : name === 'src' ? /^data:image\/(png|jpe?g|gif|webp|bmp);/i.test(value) : true
        if (!allowed || !safe) child.removeAttribute(attr.name)
      }
      walk(child)
    }
  }
  walk(doc.body)
  return doc.body.innerHTML
}

/*
 * Variante do editor de documentos: além das tags seguras, mantém a
 * formatação visual (cores, tamanho e família da fonte, alinhamento,
 * recuo e tamanho de imagens) filtrando cada propriedade de estilo.
 */
const RICH_TAGS = new Set([...ALLOWED_TAGS, 'font', 'mark', 'del', 'strike', 'caption', 'colgroup', 'col'])
const STYLE_PROPS = new Set([
  'color', 'background-color', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line',
  'text-align', 'margin-left', 'padding-left', 'width', 'height', 'vertical-align',
])
const SAFE_VALUE = /^[#(),.%\w\s"'-]+$/

function cleanStyle(style: string): string {
  return style
    .split(';')
    .map((decl) => {
      const i = decl.indexOf(':')
      if (i < 0) return ''
      const prop = decl.slice(0, i).trim().toLowerCase()
      const value = decl.slice(i + 1).trim()
      if (!STYLE_PROPS.has(prop) || !SAFE_VALUE.test(value) || /url\s*\(|expression/i.test(value)) return ''
      return `${prop}: ${value}`
    })
    .filter(Boolean)
    .join('; ')
}

export function sanitizeRichHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      const tag = child.tagName.toLowerCase()
      if (!RICH_TAGS.has(tag)) {
        if (['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'svg', 'math', 'input', 'button', 'textarea', 'select'].includes(tag)) child.remove()
        else child.replaceWith(...child.childNodes)
        continue
      }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase()
        const value = attr.value.trim()
        let keep = false
        if (name === 'style') {
          const clean = cleanStyle(value)
          if (clean) child.setAttribute('style', clean)
          keep = Boolean(clean)
        } else if (name === 'href') keep = tag === 'a' && /^(https?:|mailto:|#)/i.test(value)
        else if (name === 'src') keep = tag === 'img' && /^data:image\/(png|jpe?g|gif|webp|bmp);/i.test(value)
        else if (name === 'alt' || name === 'colspan' || name === 'rowspan') keep = true
        else if ((name === 'width' || name === 'height') && /^\d+$/.test(value)) keep = tag === 'img' || tag === 'col' || tag === 'td'
        else if (tag === 'font' && (name === 'color' || name === 'face')) keep = SAFE_VALUE.test(value)
        else if (name === 'data-page-break') keep = true
        if (!keep) child.removeAttribute(attr.name)
      }
      walk(child)
    }
  }
  walk(doc.body)
  return doc.body.innerHTML
}
