import type { SVGProps } from 'react'

/*
 * Ícones próprios do Opalite, desenhados na mesma gramática do Lucide
 * (grade 24×24, traço arredondado, cor do texto) para conviverem com ele
 * sem parecer outra família. Usados nos conceitos que são do Opalite:
 * o cofre (a pedra do logo), o gráfico de microesferas e o canvas.
 */

interface GlyphProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  size?: number
  strokeWidth?: number
}

function Glyph({ size = 16, strokeWidth = 1.6, children, className, ...rest }: GlyphProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lucide ${className ?? ''}`}
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

/**
 * Cofre: o cristal do logo só em contorno, no padrão Lucide: silhueta de
 * oito lados com o topo inclinado para a direita, sem arestas nem sombra
 * por dentro.
 */
export function GemGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M12.7 1.5 18.1 5.9 19.9 12.7 19.1 17.4 12.9 22.5 8.2 20.1 3.8 12.9 5.4 6.2Z" />
    </Glyph>
  )
}

/** Gráfico: três microesferas ligadas. */
export function GraphGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="6" cy="7" r="2.5" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="13" cy="17.5" r="3" />
      <path d="M8.4 7.6 16 6.3M7.3 9.2l3.9 5.9M17.2 7.9l-2.6 7.1" />
    </Glyph>
  )
}

/** Canvas: dois cartões ligados por uma curva. */
export function CanvasGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="4" width="8" height="6" rx="1.5" />
      <rect x="13" y="14" width="8" height="6" rx="1.5" />
      <path d="M11 7h2.5a3.5 3.5 0 0 1 3.5 3.5V14" />
    </Glyph>
  )
}
