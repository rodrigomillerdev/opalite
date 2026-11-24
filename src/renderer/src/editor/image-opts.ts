/*
 * Opções de uma imagem incorporada, escritas no próprio link (compatível com
 * a sintaxe de tamanho do Obsidian): ![[foto.png|legenda|center|400x300]].
 */

/** Opções escritas no link da imagem: ![[foto.png|legenda|center|400x300]]. */
export interface ImageOpts {
  alt: string | null
  align: 'left' | 'center' | 'right' | null
  width: number | null
  height: number | null
}

export function parseImageOpts(raw: string): ImageOpts {
  const opts: ImageOpts = { alt: null, align: null, width: null, height: null }
  for (const part of raw.split('|').map((s) => s.trim()).filter(Boolean)) {
    const size = /^(\d{1,4})(?:x(\d{1,4}))?$/.exec(part)
    if (size) {
      opts.width = Number(size[1])
      opts.height = size[2] ? Number(size[2]) : null
    } else if (part === 'left' || part === 'center' || part === 'right') opts.align = part
    else opts.alt = part
  }
  return opts
}

export function formatImageLink(target: string, o: ImageOpts): string {
  const parts = [target]
  if (o.alt) parts.push(o.alt)
  if (o.align) parts.push(o.align)
  if (o.width) parts.push(o.height ? `${Math.round(o.width)}x${Math.round(o.height)}` : String(Math.round(o.width)))
  return `![[${parts.join('|')}]]`
}
