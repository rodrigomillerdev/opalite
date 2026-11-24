import { describe, expect, it } from 'vitest'
import { markdownToHtml } from './markdown-html'

describe('markdown -> html (exportação)', () => {
  const html = markdownToHtml(
    '---\ntags: [x]\n---\n# Título\n\nTexto **forte**, *ênfase*, ~~fora~~, `x<y`, ==marca== e [[Nota|apelido]] e [[Outra#Seção]].\n\n- a\n  - b\n- [x] feito\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n> [!tip] Dica\n> corpo\n\n![[foto.png|center|200]]\n\n<script>alert(1)</script>\n',
    { image: (t) => (t === 'foto.png' ? 'data:image/png;base64,AAAA' : null) },
  )
  it('estrutura e formatação', () => {
    expect(html).toContain('<h1>Título</h1>')
    expect(html).toContain('<strong>forte</strong>')
    expect(html).toContain('<em>ênfase</em>')
    expect(html).toContain('<del>fora</del>')
    expect(html).toContain('<code>x&lt;y</code>')
    expect(html).toContain('<mark>marca</mark>')
    expect(html).toContain('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>')
    expect(html).toMatch(/<ul><li>a<ul><li>b<\/li><\/ul>\s*<\/li><li class="task">/)
  })
  it('sintaxe do Obsidian', () => {
    expect(html).toContain('<span class="wikilink">apelido</span>')
    expect(html).toContain('<span class="wikilink">Outra › Seção</span>')
    expect(html).toContain('<blockquote class="callout" data-type="tip"><p class="callout-title"><strong>Dica</strong></p>')
    expect(html).toContain('<span style="display:block;text-align:center"><img src="data:image/png;base64,AAAA" alt="foto.png" width="200"></span>')
  })
  it('remove frontmatter e HTML bruto', () => {
    expect(html).not.toContain('tags:')
    expect(html).not.toContain('<script>')
  })
})
