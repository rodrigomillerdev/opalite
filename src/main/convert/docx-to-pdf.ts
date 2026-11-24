import { BrowserWindow } from 'electron'
import mammoth from 'mammoth'

/*
 * DOCX -> PDF sem programas externos:
 * 1. o mammoth (JavaScript puro) converte o .docx em HTML semântico
 *    (títulos, listas, tabelas, negrito, imagens embutidas);
 * 2. uma janela invisível do Chromium, com JavaScript DESLIGADO, carrega esse
 *    HTML com uma folha de estilo de impressão;
 * 3. o próprio Chromium gera o PDF (printToPDF), em A4.
 * Fórmulas complexas, cabeçalhos/rodapés e caixas de texto do Word não são
 * reproduzidos com exatidão; texto, estrutura, tabelas e imagens sim.
 */

const PRINT_CSS = `
@page { size: A4; margin: 22mm 20mm 24mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: "Segoe UI", "Inter", system-ui, sans-serif; font-size: 11pt; line-height: 1.55; color: #1b1a20; margin: 0; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.2em 0 0.45em; break-after: avoid; color: #111; }
h1 { font-size: 22pt; } h2 { font-size: 17pt; } h3 { font-size: 14pt; } h4 { font-size: 12pt; }
p { margin: 0 0 0.7em; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 0.8em; padding-left: 1.4em; }
li { margin: 0.15em 0; }
table { border-collapse: collapse; width: 100%; margin: 0.6em 0 1em; break-inside: auto; font-size: 10pt; }
tr { break-inside: avoid; }
td, th { border: 1px solid #c9c7cf; padding: 5px 8px; vertical-align: top; }
th { background: #f1f0f4; text-align: left; }
img { max-width: 100%; height: auto; break-inside: avoid; }
blockquote { margin: 0.6em 0; padding-left: 12px; border-left: 3px solid #c9c7cf; color: #444; }
a { color: #3d4fc4; text-decoration: none; }
`

export async function docxToPdf(docx: Uint8Array): Promise<Uint8Array> {
  const { value: html } = await mammoth.convertToHtml(
    { buffer: Buffer.from(docx) },
    {
      // Mantém os títulos do Word como h1..h6 (o mapeamento padrão já cobre os estilos comuns).
      includeDefaultStyleMap: true,
    },
  )
  const page = `<!doctype html><html><head><meta charset="utf-8"><style>${PRINT_CSS}</style></head><body>${html || '<p></p>'}</body></html>`
  return printHtml(page)
}

export interface PrintOptions {
  /** Tamanho da página em mícrons (padrão A4). */
  width?: number
  height?: number
}

/**
 * Imprime uma página HTML completa em PDF numa janela invisível: JavaScript
 * desligado e qualquer acesso à rede bloqueado (só o próprio HTML e imagens
 * embutidas em data: URL).
 */
export async function printHtml(page: string, options: PrintOptions = {}): Promise<Uint8Array> {
  if (page.length > 200 * 1024 * 1024) throw new Error('Documento grande demais para converter.')
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      javascript: false, // conteúdo do documento nunca executa código
      sandbox: true,
      // Sessão separada e só em memória: o bloqueio de rede abaixo não afeta o app.
      partition: 'opalite-convert',
      contextIsolation: true,
      nodeIntegration: false,
      images: true,
    },
  })
  try {
    // Bloqueia qualquer acesso à rede (imagens externas, links): só o próprio HTML.
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_d, cb) => cb({ cancel: true }))
    await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(page).toString('base64')}`)
    const custom = options.width && options.height
    const pdf = await win.webContents.printToPDF({
      pageSize: custom ? { width: options.width! / 25400, height: options.height! / 25400 } : 'A4',
      printBackground: true,
      preferCSSPageSize: !custom,
      margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 },
      displayHeaderFooter: false,
    })
    return new Uint8Array(pdf)
  } finally {
    win.destroy()
  }
}

/** HTML para a pré-visualização de .docx dentro do app (mesma conversão, sem imprimir). */
export async function docxToHtml(docx: Uint8Array): Promise<{ html: string; warnings: string[] }> {
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(docx) })
  // Defesa extra: nada de scripts nem links "javascript:" vindos do documento.
  const html = result.value.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/href="\s*javascript:[^"]*"/gi, 'href="#"')
  return { html, warnings: result.messages.filter((m) => m.type === 'warning').map((m) => m.message) }
}
