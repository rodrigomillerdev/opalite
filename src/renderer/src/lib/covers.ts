/*
 * Capas de nota. No arquivo fica só um texto no frontmatter:
 *   banner: gradient:opala      (gradiente da galeria)
 *   banner: color:#2b3a55       (cor sólida)
 *   banner: Anexos/praia.jpg    (imagem do cofre)
 *   banner_y: 40                (posição vertical da imagem, 0 a 100)
 */

export interface CoverPreset {
  id: string
  label: string
  css: string
}

export const GRADIENTS: CoverPreset[] = [
  { id: 'opala', label: 'Opala', css: 'linear-gradient(115deg, #7cb2ff 0%, #78dcc0 32%, #b39bff 64%, #ffb48a 100%)' },
  { id: 'opala-negra', label: 'Opala negra', css: 'radial-gradient(120% 140% at 15% 20%, #3b4f8f 0%, transparent 45%), radial-gradient(90% 120% at 85% 30%, #1f6b5e 0%, transparent 50%), radial-gradient(80% 120% at 55% 100%, #6b3f8f 0%, transparent 55%), #0e0e14' },
  { id: 'opala-fogo', label: 'Opala de fogo', css: 'linear-gradient(120deg, #ff6f91 0%, #ff8a5c 35%, #ffc66b 70%, #8fd6a8 100%)' },
  { id: 'aurora', label: 'Aurora', css: 'linear-gradient(160deg, #0b1d33 0%, #11464f 40%, #3fc59a 75%, #b6f0c8 100%)' },
  { id: 'crepusculo', label: 'Crepúsculo', css: 'linear-gradient(180deg, #2a1b3d 0%, #6b3a6e 45%, #e0726a 80%, #f6b58c 100%)' },
  { id: 'oceano', label: 'Oceano', css: 'linear-gradient(135deg, #0f2a4a 0%, #1e5f8c 50%, #5fb3d9 100%)' },
  { id: 'floresta', label: 'Floresta', css: 'linear-gradient(135deg, #12261b 0%, #2e5a3b 50%, #8cbf7a 100%)' },
  { id: 'lavanda', label: 'Lavanda', css: 'linear-gradient(135deg, #e9e2ff 0%, #c9b8f5 50%, #9d8ae6 100%)' },
  { id: 'areia', label: 'Areia', css: 'linear-gradient(135deg, #f4ead8 0%, #e3cfa8 55%, #c9a978 100%)' },
  { id: 'neblina', label: 'Neblina', css: 'linear-gradient(180deg, #e8ecf1 0%, #c3cbd6 100%)' },
  { id: 'grafite', label: 'Grafite', css: 'linear-gradient(135deg, #1c1d22 0%, #3a3c45 100%)' },
  { id: 'menta', label: 'Menta', css: 'linear-gradient(135deg, #d8f5ea 0%, #8fe0c3 55%, #4fb79a 100%)' },
]

export const COLORS = ['#2b3a55', '#3d2b55', '#552b3a', '#55402b', '#2b5540', '#1c1d22', '#e9e4da', '#d7e3ee']

export type Cover = { kind: 'css'; css: string } | { kind: 'image'; path: string }

/** Interpreta o valor de `banner:` do frontmatter. */
export function parseCover(value: unknown): Cover | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const v = value.trim()
  if (v.startsWith('gradient:')) {
    const preset = GRADIENTS.find((g) => g.id === v.slice(9))
    return preset ? { kind: 'css', css: preset.css } : null
  }
  if (v.startsWith('color:')) {
    const color = v.slice(6)
    return /^#[0-9a-f]{3,8}$/i.test(color) ? { kind: 'css', css: color } : null
  }
  // Também aceita [[imagem.png]] (formato comum em outros apps).
  return { kind: 'image', path: v.replace(/^!?\[\[|\]\]$/g, '') }
}

export function randomGradient(): string {
  return `gradient:${GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)]!.id}`
}
