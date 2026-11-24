/*
 * Leitor de XML mínimo para os arquivos do Office (OOXML). Os arquivos .xlsx
 * e .pptx são zips de XML bem-formado; este parser cobre o que eles usam:
 * elementos, atributos, texto, entidades, CDATA, comentários e instruções.
 * Funciona sem DOM (também nos testes, em Node).
 */

export interface XmlNode {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  /** Texto direto deste elemento (concatenado). */
  text: string
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITIES[code] ?? m
  })
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Caracteres de controle são proibidos no XML 1.0 (exceto tab/LF/CR).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

const ATTR = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g

export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  let i = 0
  const n = xml.length
  while (i < n) {
    const lt = xml.indexOf('<', i)
    if (lt === -1) break
    if (lt > i) {
      const top = stack[stack.length - 1]!
      top.text += decodeEntities(xml.slice(i, lt))
    }
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4)
      i = end === -1 ? n : end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9)
      stack[stack.length - 1]!.text += xml.slice(lt + 9, end === -1 ? n : end)
      i = end === -1 ? n : end + 3
      continue
    }
    if (xml[lt + 1] === '?' || xml[lt + 1] === '!') {
      const end = xml.indexOf('>', lt)
      i = end === -1 ? n : end + 1
      continue
    }
    const gt = findTagEnd(xml, lt)
    const raw = xml.slice(lt + 1, gt)
    i = gt + 1
    if (raw[0] === '/') {
      // Fecha até o elemento correspondente (tolerante a XML levemente torto).
      const name = raw.slice(1).trim()
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s]!.name === name) {
          stack.length = s
          break
        }
      }
      continue
    }
    const selfClosing = raw.endsWith('/')
    const body = selfClosing ? raw.slice(0, -1) : raw
    const space = body.search(/\s/)
    const name = space === -1 ? body : body.slice(0, space)
    const attrs: Record<string, string> = {}
    if (space !== -1) {
      ATTR.lastIndex = 0
      let m: RegExpExecArray | null
      const rest = body.slice(space)
      while ((m = ATTR.exec(rest))) attrs[m[1]!] = decodeEntities(m[3] ?? m[4] ?? '')
    }
    const node: XmlNode = { name, attrs, children: [], text: '' }
    stack[stack.length - 1]!.children.push(node)
    if (!selfClosing) stack.push(node)
  }
  return root
}

/** Fim da tag, ignorando ">" dentro de valores de atributos. */
function findTagEnd(xml: string, from: number): number {
  let quote = ''
  for (let i = from + 1; i < xml.length; i++) {
    const c = xml[i]
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '>') return i
  }
  return xml.length - 1
}

/** Nome sem prefixo de namespace ("a:t" -> "t"). */
export const local = (name: string) => name.slice(name.indexOf(':') + 1)

export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((c) => local(c.name) === name)
}

export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((c) => local(c.name) === name) : []
}

/** Busca em profundidade (primeiro descendente com o nome). */
export function find(node: XmlNode | undefined, name: string): XmlNode | undefined {
  if (!node) return undefined
  for (const c of node.children) {
    if (local(c.name) === name) return c
    const deep = find(c, name)
    if (deep) return deep
  }
  return undefined
}

export function findAll(node: XmlNode | undefined, name: string, out: XmlNode[] = []): XmlNode[] {
  if (!node) return out
  for (const c of node.children) {
    if (local(c.name) === name) out.push(c)
    findAll(c, name, out)
  }
  return out
}

/** Todo o texto dos descendentes (ex.: conteúdo de <a:t> dentro de um parágrafo). */
export function textOf(node: XmlNode | undefined, tag = 't'): string {
  if (!node) return ''
  return findAll(node, tag)
    .map((t) => t.text)
    .join('')
}
