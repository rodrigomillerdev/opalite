import { extOf } from '../attachments'
import type { Progress } from '../pdf-to-docx'

/*
 * Conversões de arquivo do Opalite. Cada entrada sabe de quais extensões
 * parte, para qual formato vai e como gravar o resultado. Nada sai do
 * computador: tudo roda no próprio app (e a impressão em PDF numa janela
 * invisível, sem JavaScript nem rede). O original nunca é alterado: os
 * resultados ganham nome novo ("Relatório 1.pdf" se já existir).
 */

export interface ConvertContext {
  path: string
  bytes(): Promise<Uint8Array>
  progress(p: Progress): void
  signal: { cancelled: boolean }
  /** Grava um arquivo ao lado do original (ou na subpasta) e devolve o caminho final. */
  save(name: string, bytes: Uint8Array, subfolder?: string): Promise<string>
  option?: string
}

export interface Conversion {
  id: string
  from: string[]
  to: string
  label: string
  description: string
  /** Opções mutuamente exclusivas (ex.: PDF -> DOCX texto/layout). */
  options?: Array<{ id: string; label: string; description: string }>
  run(ctx: ConvertContext): Promise<string[]>
}

const stem = (path: string) => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name
}

const text = (s: string) => new TextEncoder().encode(s)
const check = (signal: { cancelled: boolean }) => {
  if (signal.cancelled) throw new Error('Conversão cancelada.')
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif']
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif' }

function b64(bytes: Uint8Array): string {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(s)
}

const dataUrl = (bytes: Uint8Array, mime: string) => `data:${mime};base64,${b64(bytes)}`

function page(body: string, css: string, title: string): string {
  const safe = title.replace(/[<>&"]/g, '')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${safe}</title><style>${css}</style></head><body>${body}</body></html>`
}

/** Imagens do cofre citadas por ![[...]] numa nota, já como data: URL. */
async function vaultImages(md: string): Promise<(target: string) => string | null> {
  const { findFile } = await import('../attachments')
  const { useVault } = await import('../../state/vault-store')
  const tree = useVault.getState().tree
  const map = new Map<string, string>()
  const targets = [...md.matchAll(/!\[\[([^\]|\n]+)/g)].map((m) => m[1]!.trim())
  for (const t of targets) {
    const path = findFile(tree, t)
    const ext = path ? extOf(path) : ''
    if (!path || !MIME[ext]) continue
    try {
      map.set(t, dataUrl(await window.opalite.files.readBinary(path), MIME[ext]!))
    } catch {
      // imagem ilegível: fica como texto
    }
  }
  return (t) => map.get(t) ?? null
}

async function canvasFromImage(bytes: Uint8Array, mime: string): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }))
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return canvas
}

async function canvasBytes(canvas: HTMLCanvasElement, mime: string, quality = 0.92): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, mime, quality))
  if (!blob) throw new Error('Não foi possível gerar a imagem.')
  return new Uint8Array(await blob.arrayBuffer())
}

export const CONVERSIONS: Conversion[] = [
  // ------------------------------------------------------------ PDF
  {
    id: 'pdf-docx',
    from: ['pdf'],
    to: 'docx',
    label: 'Documento do Word',
    description: 'Para editar o conteúdo no Opalite ou no Word.',
    options: [
      { id: 'text', label: 'Texto editável', description: 'Recria títulos, parágrafos, listas e negrito.' },
      { id: 'layout', label: 'Layout fiel', description: 'Cada página como imagem, idêntica ao PDF. Bom para digitalizados.' },
    ],
    async run(ctx) {
      const { pdfToDocx } = await import('../pdf-to-docx')
      const docx = await pdfToDocx(await ctx.bytes(), { mode: ctx.option === 'layout' ? 'layout' : 'text', signal: ctx.signal, onProgress: ctx.progress })
      return [await ctx.save(`${stem(ctx.path)}.docx`, docx)]
    },
  },
  {
    id: 'pdf-md',
    from: ['pdf'],
    to: 'md',
    label: 'Nota (Markdown)',
    description: 'O texto do PDF vira uma nota do cofre, com títulos e listas.',
    async run(ctx) {
      const [{ openPdf }, { readPdfBlocks }] = await Promise.all([import('../pdf'), import('../pdf-to-docx')])
      const pdf = await openPdf(await ctx.bytes())
      try {
        const pages = await readPdfBlocks(pdf, ctx.progress, ctx.signal)
        let n = 1
        const md = pages
          .map((blocks) =>
            blocks
              .map((b) => {
                const t = b.runs.map((r) => (r.bold && b.type === 'paragraph' ? `**${r.text.trim()}**` : r.text)).join('').trim()
                if (b.type === 'heading1') return `# ${t}`
                if (b.type === 'heading2') return `## ${t}`
                if (b.type === 'heading3') return `### ${t}`
                if (b.type === 'bullet') return `- ${t.replace(/^[•▪◦·-]\s*/, '')}`
                if (b.type === 'numbered') return `${n++}. ${t.replace(/^\d+[.)]\s*/, '')}`
                n = 1
                return t
              })
              .join('\n\n'),
          )
          .join('\n\n---\n\n')
        if (!md.trim()) throw new Error('Este PDF não tem texto selecionável (talvez seja digitalizado). Experimente “Imagens das páginas”.')
        return [await ctx.save(`${stem(ctx.path)}.md`, text(`${md}\n`))]
      } finally {
        void pdf.destroy()
      }
    },
  },
  {
    id: 'pdf-txt',
    from: ['pdf'],
    to: 'txt',
    label: 'Texto simples',
    description: 'Só o texto, sem formatação.',
    async run(ctx) {
      const [{ openPdf }, { readPdfBlocks }] = await Promise.all([import('../pdf'), import('../pdf-to-docx')])
      const pdf = await openPdf(await ctx.bytes())
      try {
        const pages = await readPdfBlocks(pdf, ctx.progress, ctx.signal)
        const out = pages.map((blocks) => blocks.map((b) => b.runs.map((r) => r.text).join('').trim()).join('\n\n')).join('\n\n\f\n\n')
        return [await ctx.save(`${stem(ctx.path)}.txt`, text(out))]
      } finally {
        void pdf.destroy()
      }
    },
  },
  {
    id: 'pdf-png',
    from: ['pdf'],
    to: 'png',
    label: 'Imagens das páginas',
    description: 'Uma imagem PNG por página, numa pasta nova.',
    async run(ctx) {
      const { openPdf } = await import('../pdf')
      const pdf = await openPdf(await ctx.bytes())
      try {
        const out: string[] = []
        const folder = `${stem(ctx.path)} (páginas)`
        for (let i = 1; i <= pdf.numPages; i++) {
          check(ctx.signal)
          ctx.progress({ done: i - 1, total: pdf.numPages, label: `Desenhando página ${i} de ${pdf.numPages}` })
          const pg = await pdf.getPage(i)
          const viewport = pg.getViewport({ scale: 2 })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          const c2d = canvas.getContext('2d', { alpha: false })!
          c2d.fillStyle = '#fff'
          c2d.fillRect(0, 0, canvas.width, canvas.height)
          await pg.render({ canvasContext: c2d, viewport }).promise
          pg.cleanup()
          out.push(await ctx.save(`Página ${String(i).padStart(3, '0')}.png`, await canvasBytes(canvas, 'image/png'), folder))
        }
        return out
      } finally {
        void pdf.destroy()
      }
    },
  },

  // ------------------------------------------------------------ DOCX
  {
    id: 'docx-pdf',
    from: ['docx'],
    to: 'pdf',
    label: 'PDF (A4)',
    description: 'Texto, títulos, listas, tabelas e imagens preservados.',
    async run(ctx) {
      ctx.progress({ done: 0, total: 1, label: 'Gerando o PDF' })
      return [await window.opalite.convert.docxToPdf(ctx.path)]
    },
  },
  {
    id: 'docx-md',
    from: ['docx'],
    to: 'md',
    label: 'Nota (Markdown)',
    description: 'Vira uma nota do cofre; as imagens vão para uma pasta ao lado.',
    async run(ctx) {
      ctx.progress({ done: 0, total: 2, label: 'Lendo o documento' })
      const { html } = await window.opalite.convert.docxToHtml(ctx.path)
      const { htmlToMarkdown } = await import('./html-markdown')
      ctx.progress({ done: 1, total: 2, label: 'Escrevendo a nota' })
      const folder = `${stem(ctx.path)} (imagens)`
      const md = await htmlToMarkdown(html, async (url, i) => {
        check(ctx.signal)
        const m = /^data:image\/(png|jpe?g|gif|webp|bmp);base64,(.*)$/i.exec(url)
        if (!m) return null
        const bin = atob(m[2]!)
        const bytes = new Uint8Array(bin.length)
        for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k)
        return ctx.save(`imagem-${i}.${m[1]!.toLowerCase().replace('jpeg', 'jpg')}`, bytes, folder)
      })
      return [await ctx.save(`${stem(ctx.path)}.md`, text(md))]
    },
  },
  {
    id: 'docx-txt',
    from: ['docx'],
    to: 'txt',
    label: 'Texto simples',
    description: 'Só o texto, sem formatação.',
    async run(ctx) {
      const { html } = await window.opalite.convert.docxToHtml(ctx.path)
      const doc = new DOMParser().parseFromString(html.replace(/<\/(p|h\d|li|tr)>/gi, '</$1>\n'), 'text/html')
      return [await ctx.save(`${stem(ctx.path)}.txt`, text((doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n')))]
    },
  },

  // ------------------------------------------------------------ Markdown / texto
  {
    id: 'md-docx',
    from: ['md', 'txt'],
    to: 'docx',
    label: 'Documento do Word',
    description: 'Títulos, listas, tabelas, citações, código e imagens da nota.',
    async run(ctx) {
      const md = new TextDecoder().decode(await ctx.bytes())
      const [{ markdownToHtml }, { htmlToDocx }] = await Promise.all([import('./markdown-html'), import('../office/docx-html')])
      ctx.progress({ done: 0, total: 1, label: 'Montando o documento' })
      const html = extOf(ctx.path) === 'txt' ? md.split(/\n{2,}/).map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('') : markdownToHtml(md, { image: await vaultImages(md) })
      return [await ctx.save(`${stem(ctx.path)}.docx`, await htmlToDocx(html, { title: stem(ctx.path) }))]
    },
  },
  {
    id: 'md-pdf',
    from: ['md'],
    to: 'pdf',
    label: 'PDF (A4)',
    description: 'A nota formatada, pronta para imprimir ou enviar.',
    async run(ctx) {
      const md = new TextDecoder().decode(await ctx.bytes())
      const { markdownToHtml, PRINT_CSS } = await import('./markdown-html')
      ctx.progress({ done: 0, total: 1, label: 'Gerando o PDF' })
      const html = page(markdownToHtml(md, { image: await vaultImages(md) }), PRINT_CSS, stem(ctx.path))
      return [await ctx.save(`${stem(ctx.path)}.pdf`, await window.opalite.convert.htmlToPdf(html))]
    },
  },
  {
    id: 'md-html',
    from: ['md'],
    to: 'html',
    label: 'Página HTML',
    description: 'Arquivo único, com imagens embutidas, para abrir em qualquer navegador.',
    async run(ctx) {
      const md = new TextDecoder().decode(await ctx.bytes())
      const { markdownToHtml, PRINT_CSS } = await import('./markdown-html')
      const css = `${PRINT_CSS.replace(/@page[^}]*}/, '')} body { max-width: 760px; margin: 40px auto; padding: 0 20px; }`
      const html = page(`<h1>${stem(ctx.path).replace(/</g, '&lt;')}</h1>${markdownToHtml(md, { image: await vaultImages(md) })}`, css, stem(ctx.path))
      return [await ctx.save(`${stem(ctx.path)}.html`, text(html))]
    },
  },

  // ------------------------------------------------------------ planilhas
  {
    id: 'xlsx-csv',
    from: ['xlsx'],
    to: 'csv',
    label: 'CSV',
    description: 'Valores calculados, separados por ponto e vírgula (uma aba por arquivo).',
    async run(ctx) {
      const { readXlsx, writeCsv } = await import('../office/xlsx')
      const wb = readXlsx(await ctx.bytes())
      const out: string[] = []
      for (const [i, sheet] of wb.sheets.entries()) {
        check(ctx.signal)
        ctx.progress({ done: i, total: wb.sheets.length, label: `Aba ${sheet.name}` })
        const name = wb.sheets.length > 1 ? `${stem(ctx.path)} - ${sheet.name}.csv` : `${stem(ctx.path)}.csv`
        out.push(await ctx.save(name.replace(/[\\/:*?"<>|]/g, '-'), text(`﻿${writeCsv(sheet, wb)}`)))
      }
      return out
    },
  },
  {
    id: 'csv-xlsx',
    from: ['csv'],
    to: 'xlsx',
    label: 'Planilha (.xlsx)',
    description: 'Para usar fórmulas, formatação e várias abas.',
    async run(ctx) {
      const { readCsv, writeXlsx } = await import('../office/xlsx')
      const wb = readCsv(new TextDecoder().decode(await ctx.bytes()).replace(/^﻿/, ''))
      return [await ctx.save(`${stem(ctx.path)}.xlsx`, writeXlsx(wb))]
    },
  },
  {
    id: 'xlsx-pdf',
    from: ['xlsx', 'csv'],
    to: 'pdf',
    label: 'PDF',
    description: 'Cada aba como uma tabela, com os valores formatados.',
    async run(ctx) {
      const [{ readXlsx, readCsv }, { Calc, formatValue, key, usedRange }] = await Promise.all([import('../office/xlsx'), import('../office/workbook')])
      const raw = await ctx.bytes()
      const wb = extOf(ctx.path) === 'csv' ? readCsv(new TextDecoder().decode(raw).replace(/^﻿/, '')) : readXlsx(raw)
      const calc = new Calc(wb)
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      let body = ''
      wb.sheets.forEach((sheet, si) => {
        const { cols, rows } = usedRange(sheet)
        if (!cols || !rows) return
        body += `<h2>${esc(sheet.name)}</h2><table>`
        for (let r = 0; r < Math.min(rows, 5000); r++) {
          body += '<tr>'
          for (let c = 0; c < Math.min(cols, 60); c++) {
            const cell = sheet.cells.get(key(c, r))
            const v = calc.value(si, c, r)
            const s = cell?.s
            const style = [s?.b ? 'font-weight:700' : '', s?.i ? 'font-style:italic' : '', s?.color ? `color:${s.color}` : '', s?.fill ? `background:${s.fill}` : '', `text-align:${s?.align ?? (typeof v === 'number' ? 'right' : 'left')}`].filter(Boolean).join(';')
            body += `<td style="${style}">${esc(formatValue(v, s?.fmt))}</td>`
          }
          body += '</tr>'
        }
        body += '</table>'
      })
      const css = `@page { size: A4 landscape; margin: 14mm; } body { font-family: Calibri, "Segoe UI", sans-serif; font-size: 9pt; color: #1b1a20; } h2 { font-size: 13pt; margin: 0 0 8px; } h2:not(:first-child) { break-before: page; } table { border-collapse: collapse; } td { border: 1px solid #d0d0d8; padding: 3px 6px; white-space: nowrap; } html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }`
      ctx.progress({ done: 0, total: 1, label: 'Gerando o PDF' })
      return [await ctx.save(`${stem(ctx.path)}.pdf`, await window.opalite.convert.htmlToPdf(page(body || '<p>Planilha vazia.</p>', css, stem(ctx.path))))]
    },
  },

  // ------------------------------------------------------------ apresentações
  {
    id: 'pptx-pdf',
    from: ['pptx'],
    to: 'pdf',
    label: 'PDF (um slide por página)',
    description: 'Textos, formas, imagens e fundos de cada slide.',
    async run(ctx) {
      const [{ readPptx }, { parasToHtml, PT }, { radiusOf }] = await Promise.all([import('../office/pptx'), import('../office/slide-html'), import('../office/presentation')])
      const pres = readPptx(await ctx.bytes())
      ctx.progress({ done: 0, total: pres.slides.length, label: 'Montando os slides' })
      const slides = pres.slides
        .map((s) => {
          const els = s.elements
            .map((e) => {
              const r = radiusOf(e)
              const box = `left:${e.x}px;top:${e.y}px;width:${e.w}px;height:${Math.max(e.h, 1)}px;${e.rot ? `transform:rotate(${e.rot}deg);` : ''}${e.opacity !== undefined && e.opacity < 1 ? `opacity:${e.opacity};` : ''}${r ? `border-radius:${r}px;` : ''}`
              const border = e.stroke ? `border:${((e.strokeWidth ?? (e.type === 'shape' ? 1.5 : 1)) * PT).toFixed(2)}px solid ${e.stroke};` : ''
              if (e.type === 'image') return `<img class="el" style="${box}${border}" src="${dataUrl(e.data, e.mime)}">`
              const valign = e.valign ?? (e.type === 'shape' ? 'middle' : 'top')
              const fill = e.type === 'shape' ? '' : `${e.fill ? `background:${e.fill};` : ''}${border}`
              const shape =
                e.type === 'shape' && e.shape !== 'line'
                  ? `background:${e.fill ?? 'transparent'};${border}${e.shape === 'ellipse' ? 'border-radius:50%;' : ''}${e.shape === 'triangle' ? 'clip-path:polygon(50% 0,100% 100%,0 100%);' : ''}${e.shape === 'arrow' ? 'clip-path:polygon(0 30%,65% 30%,65% 0,100% 50%,65% 100%,65% 70%,0 70%);' : ''}`
                  : ''
              return `<div class="el text v-${valign}" style="${box}${fill}${shape}">${parasToHtml(e.paras)}</div>`
            })
            .join('')
          return `<section class="slide" style="background:${s.background}">${els}</section>`
        })
        .join('')
      const css = `@page { margin: 0; } * { box-sizing: border-box; margin: 0; } html { -webkit-print-color-adjust: exact; print-color-adjust: exact; } body { font-family: Calibri, Carlito, "Segoe UI", sans-serif; color: #1f2430; } .slide { position: relative; width: ${pres.width}px; height: ${pres.height}px; overflow: hidden; break-after: page; } .el { position: absolute; } img.el { object-fit: fill; } .text { display: flex; flex-direction: column; padding: 7px 10px; line-height: 1.2; font-size: 24px; overflow: hidden; } .v-middle { justify-content: center; } .v-bottom { justify-content: flex-end; } .text ul, .text ol { padding-left: 1.2em; } .text ol { padding-left: 1.5em; } img.el { box-sizing: border-box; }`
      ctx.progress({ done: pres.slides.length, total: pres.slides.length, label: 'Gerando o PDF' })
      // Página do tamanho do slide (960×540 px = 10 × 5,625 polegadas).
      const pdf = await window.opalite.convert.htmlToPdf(page(slides, css, stem(ctx.path)), { width: Math.round((pres.width / 96) * 25400), height: Math.round((pres.height / 96) * 25400) })
      return [await ctx.save(`${stem(ctx.path)}.pdf`, pdf)]
    },
  },

  // ------------------------------------------------------------ imagens
  ...(['png', 'jpg', 'webp'] as const).map(
    (to): Conversion => ({
      id: `image-${to}`,
      from: IMAGE_EXTS.filter((e) => e !== to && !(to === 'jpg' && e === 'jpeg')),
      to,
      label: to === 'png' ? 'PNG (sem perda)' : to === 'jpg' ? 'JPG (menor, para fotos)' : 'WebP (moderno e leve)',
      description: to === 'png' ? 'Mantém a transparência.' : to === 'jpg' ? 'Fundo transparente vira branco.' : 'Boa qualidade com arquivo pequeno.',
      async run(ctx) {
        const ext = extOf(ctx.path)
        const canvas = await canvasFromImage(await ctx.bytes(), MIME[ext] ?? 'image/png')
        if (to === 'jpg') {
          const flat = document.createElement('canvas')
          flat.width = canvas.width
          flat.height = canvas.height
          const c = flat.getContext('2d')!
          c.fillStyle = '#ffffff'
          c.fillRect(0, 0, flat.width, flat.height)
          c.drawImage(canvas, 0, 0)
          return [await ctx.save(`${stem(ctx.path)}.jpg`, await canvasBytes(flat, 'image/jpeg', 0.9))]
        }
        return [await ctx.save(`${stem(ctx.path)}.${to}`, await canvasBytes(canvas, to === 'png' ? 'image/png' : 'image/webp', 0.9))]
      },
    }),
  ),
  {
    id: 'image-pdf',
    from: IMAGE_EXTS,
    to: 'pdf',
    label: 'PDF',
    description: 'A imagem centralizada numa página A4.',
    async run(ctx) {
      const ext = extOf(ctx.path)
      const html = page(`<img src="${dataUrl(await ctx.bytes(), MIME[ext] ?? 'image/png')}">`, '@page { size: A4; margin: 12mm; } body { margin: 0; display: flex; align-items: center; justify-content: center; height: 270mm; } img { max-width: 100%; max-height: 100%; object-fit: contain; }', stem(ctx.path))
      return [await ctx.save(`${stem(ctx.path)}.pdf`, await window.opalite.convert.htmlToPdf(html))]
    },
  },
]

export function conversionsFor(path: string): Conversion[] {
  const ext = extOf(path)
  return CONVERSIONS.filter((c) => c.from.includes(ext))
}

export const CONVERTIBLE_EXTS = new Set(CONVERSIONS.flatMap((c) => c.from))
