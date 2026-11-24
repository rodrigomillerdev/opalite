import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/*
 * PDF com o pdf.js (Mozilla, JavaScript puro). A decodificação roda num
 * Web Worker para não travar a interface; as páginas são desenhadas em
 * <canvas> e guardadas como ImageBitmap para reaproveitar nas animações.
 */

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type { PDFDocumentProxy, PDFPageProxy }

export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({
    data: bytes,
    // A CSP do app não permite eval: o pdf.js usa o caminho seguro para fontes.
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise
}

/** Tamanho da página em pontos (1/72 pol), já considerando rotação. */
export async function pageSize(doc: PDFDocumentProxy, index: number): Promise<{ width: number; height: number }> {
  const page = await doc.getPage(index + 1)
  const vp = page.getViewport({ scale: 1 })
  return { width: vp.width, height: vp.height }
}

/** Desenha uma página na largura (em pixels de tela) pedida e devolve um bitmap. */
export async function renderPage(doc: PDFDocumentProxy, index: number, cssWidth: number): Promise<ImageBitmap> {
  const page = await doc.getPage(index + 1)
  const base = page.getViewport({ scale: 1 })
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
  const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d', { alpha: false })!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise
  page.cleanup()
  return createImageBitmap(canvas)
}

/**
 * Cache de páginas desenhadas, por largura. Evita redesenhar ao virar a
 * página de volta e permite pré-desenhar as próximas.
 */
export class PageCache {
  private bitmaps = new Map<string, Promise<ImageBitmap>>()
  private bytes = new Map<string, number>()
  private total = 0
  constructor(
    private readonly doc: PDFDocumentProxy,
    /** Memória máxima das páginas desenhadas (bitmaps RGBA). */
    private readonly budget = 160 * 1024 * 1024,
  ) {}

  /** Larguras em faixas de 24 px: redimensionar a janela não cria uma versão por pixel. */
  static band(width: number): number {
    return Math.max(24, Math.ceil(width / 24) * 24)
  }

  get(index: number, cssWidth: number): Promise<ImageBitmap> {
    const width = PageCache.band(cssWidth)
    const key = `${index}@${width}`
    let hit = this.bitmaps.get(key)
    if (hit) {
      this.bitmaps.delete(key)
      this.bitmaps.set(key, hit)
      return hit
    }
    hit = renderPage(this.doc, index, width)
    this.bitmaps.set(key, hit)
    void hit
      .then((b) => {
        const size = b.width * b.height * 4
        this.bytes.set(key, size)
        this.total += size
        this.evict(key)
      })
      .catch(() => this.bitmaps.delete(key))
    return hit
  }

  private evict(keep: string): void {
    for (const key of this.bitmaps.keys()) {
      if (this.total <= this.budget) break
      if (key === keep) continue
      const size = this.bytes.get(key)
      if (size === undefined) continue // ainda desenhando
      void this.bitmaps.get(key)?.then((b) => b.close()).catch(() => undefined)
      this.bitmaps.delete(key)
      this.bytes.delete(key)
      this.total -= size
    }
  }

  clear(): void {
    for (const b of this.bitmaps.values()) void b.then((x) => x.close()).catch(() => undefined)
    this.bitmaps.clear()
    this.bytes.clear()
    this.total = 0
  }
}
