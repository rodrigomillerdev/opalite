import { AlignmentType, Document, HeadingLevel, ImageRun, LevelFormat, Packer, Paragraph, TextRun } from 'docx'
import { type Block, type TextPiece, bodySizeOf, groupLines, linesToBlocks } from './pdf-layout'
import { openPdf } from './pdf'

/*
 * PDF -> DOCX, tudo no próprio app (pdf.js lê, a biblioteca "docx" escreve):
 * - "texto": recria títulos, parágrafos, listas e negrito como texto editável;
 * - "layout": cada página vira uma imagem de alta resolução no Word, idêntica
 *   ao PDF, mas sem texto editável.
 */

export type PdfToDocxMode = 'text' | 'layout'

export interface Progress {
  done: number
  total: number
  label: string
}

interface Options {
  mode: PdfToDocxMode
  onProgress(p: Progress): void
  signal?: { cancelled: boolean }
}

const PT_TO_TWIP = 20
const PX_PER_PT = 96 / 72

function cancelled(signal?: { cancelled: boolean }) {
  if (signal?.cancelled) throw new Error('Conversão cancelada.')
}

export async function pdfToDocx(bytes: Uint8Array, { mode, onProgress, signal }: Options): Promise<Uint8Array> {
  const pdf = await openPdf(bytes)
  try {
    const total = pdf.numPages
    if (mode === 'layout') return await layoutDocx(pdf, total, onProgress, signal)

    // 1) Lê o texto posicionado; 2) estrutura comparando com o corpo do documento.
    const pagesBlocks = await readPdfBlocks(pdf, onProgress, signal)
    const children: Paragraph[] = []
    pagesBlocks.forEach((blocks, index) => blocks.forEach((block, i) => children.push(toParagraph(block, index > 0 && i === 0))))
    if (!children.length) children.push(new Paragraph({ children: [new TextRun({ text: 'Este PDF não tem texto selecionável (talvez seja digitalizado). Use o modo "Layout fiel".', italics: true })] }))

    onProgress({ done: total, total, label: 'Gerando o documento' })
    const doc = new Document({
      creator: 'Opalite',
      styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
      numbering: {
        config: [
          {
            reference: 'opal-numbered',
            levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
          },
        ],
      },
      sections: [{ properties: {}, children }],
    })
    return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer())
  } finally {
    void pdf.destroy()
  }
}

/** Blocos (títulos, parágrafos, listas) de cada página de um PDF aberto. */
export async function readPdfBlocks(pdf: Awaited<ReturnType<typeof openPdf>>, onProgress: (p: Progress) => void, signal?: { cancelled: boolean }): Promise<Block[][]> {
  const total = pdf.numPages
  const pages: TextPiece[][] = []
  for (let i = 1; i <= total; i++) {
    cancelled(signal)
    onProgress({ done: i - 1, total, label: `Lendo página ${i} de ${total}` })
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    // A lista de operações carrega as fontes, de onde vem o nome (para saber se é negrito).
    await page.getOperatorList()
    const pieces: TextPiece[] = []
    for (const item of content.items) {
      if (!('str' in item) || !item.str) continue
      const [, , c, d, e, f] = item.transform as number[]
      let bold = false
      try {
        const font = page.commonObjs.get(item.fontName) as { name?: string } | undefined
        bold = /bold|black|heavy|semibold/i.test(font?.name ?? '')
      } catch {
        // fonte ainda não resolvida: assume normal
      }
      pieces.push({ str: item.str, x: e!, y: f!, width: item.width, size: Math.hypot(c!, d!) || item.height || 11, bold })
    }
    pages.push(pieces)
    page.cleanup()
  }
  const body = bodySizeOf(pages)
  return pages.map((pieces) => linesToBlocks(groupLines(pieces), body))
}

function toParagraph(block: Block, pageBreakBefore: boolean): Paragraph {
  const children = block.runs.map((r) => new TextRun({ text: r.text, bold: r.bold }))
  const heading =
    block.type === 'heading1' ? HeadingLevel.HEADING_1 : block.type === 'heading2' ? HeadingLevel.HEADING_2 : block.type === 'heading3' ? HeadingLevel.HEADING_3 : undefined
  return new Paragraph({
    children,
    pageBreakBefore,
    ...(heading ? { heading } : {}),
    ...(block.type === 'bullet' ? { bullet: { level: 0 } } : {}),
    ...(block.type === 'numbered' ? { numbering: { reference: 'opal-numbered', level: 0 } } : {}),
    spacing: { after: block.type === 'paragraph' ? 160 : 80 },
  })
}

async function layoutDocx(
  pdf: Awaited<ReturnType<typeof openPdf>>,
  total: number,
  onProgress: (p: Progress) => void,
  signal?: { cancelled: boolean },
): Promise<Uint8Array> {
  const sections = []
  for (let i = 1; i <= total; i++) {
    cancelled(signal)
    onProgress({ done: i - 1, total, label: `Desenhando página ${i} de ${total}` })
    const page = await pdf.getPage(i)
    const base = page.getViewport({ scale: 1 })
    // 2x: nítido na tela e na impressão sem deixar o arquivo enorme.
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d', { alpha: false })!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar imagem.'))), 'image/png'))
    page.cleanup()
    sections.push({
      properties: {
        page: {
          size: { width: Math.round(base.width * PT_TO_TWIP), height: Math.round(base.height * PT_TO_TWIP) },
          margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0 },
        },
      },
      children: [
        new Paragraph({
          children: [
            new ImageRun({
              type: 'png',
              data: new Uint8Array(await png.arrayBuffer()),
              // Um pouco menor que a página para o Word não empurrar a imagem para a próxima.
              transformation: { width: Math.floor(base.width * PX_PER_PT) - 2, height: Math.floor(base.height * PX_PER_PT) - 2 },
            }),
          ],
        }),
      ],
    })
  }
  onProgress({ done: total, total, label: 'Gerando o documento' })
  const doc = new Document({ creator: 'Opalite', sections })
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer())
}
