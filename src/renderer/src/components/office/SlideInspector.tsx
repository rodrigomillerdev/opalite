import { AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, RotateCcw } from 'lucide-react'
import { type Slide, type SlideEl, canRound, radiusOf } from '../../lib/office/presentation'
import { ColorField } from './ColorPicker'
import styles from './PresentationEditor.module.css'

/*
 * Painel "Formatar" à direita do slide. Sem nada selecionado mostra o fundo
 * do slide (com "aplicar a todos"); com elementos selecionados mostra
 * preenchimento, borda, cantos, opacidade, rotação e, para textos, o
 * alinhamento vertical e o espaçamento entre letras. Os valores exibidos são
 * os do primeiro elemento selecionado; as mudanças valem para todos.
 */

const BACKGROUNDS = ['#ffffff', '#f4f2ee', '#e8eefc', '#fdf0e6', '#1f2430', '#14161c', '#2b2350', '#0f3d3e']

export function SlideInspector({
  slide,
  selected,
  onEdit,
  onBackground,
  onTextColor,
}: {
  slide: Slide
  selected: SlideEl[]
  /** Aplica uma alteração a todos os selecionados (o editor agrupa o desfazer). */
  onEdit(mut: (el: SlideEl) => void): void
  onBackground(color: string, all: boolean): void
  onTextColor(color: string): void
}) {
  const el = selected[0]

  if (!el) {
    return (
      <aside className={styles.inspector} aria-label="Formatar slide">
        <h3>Slide</h3>
        <Field label="Cor de fundo">
          <ColorInput label="Cor de fundo" value={slide.background} onChange={(c) => onBackground(c, false)} />
        </Field>
        <div className={styles.swatches}>
          {BACKGROUNDS.map((c) => (
            <button key={c} className={styles.swatchBtn} data-on={slide.background.toLowerCase() === c || undefined} style={{ background: c }} onClick={() => onBackground(c, false)} title={c} aria-label={`Fundo ${c}`} />
          ))}
        </div>
        <button className={styles.wideBtn} onClick={() => onBackground(slide.background, true)}>
          Aplicar fundo a todos os slides
        </button>
        <p className={styles.inspectorHint}>Clique num elemento do slide para ajustar borda, opacidade e rotação.</p>
      </aside>
    )
  }

  const isLine = el.type === 'shape' && el.shape === 'line'
  const hasFill = el.type !== 'image' && !isLine
  const hasText = el.type !== 'image' && !isLine
  const stroke = el.stroke ?? (isLine ? '#1f2430' : undefined)
  const strokeW = el.stroke || isLine ? (el.strokeWidth ?? (el.type === 'shape' ? 1.5 : 1)) : 0
  const maxRadius = Math.floor(Math.min(el.w, el.h) / 2)
  const run0 = el.type !== 'image' ? el.paras[0]?.runs[0] : undefined

  return (
    <aside className={styles.inspector} aria-label="Formatar elemento">
      <h3>{selected.length > 1 ? `${selected.length} elementos` : el.type === 'image' ? 'Imagem' : el.type === 'text' ? 'Caixa de texto' : isLine ? 'Linha' : 'Forma'}</h3>

      {hasFill && (
        <Field label="Preenchimento">
          <ColorInput label="Preenchimento" value={el.fill} empty="Nenhum" onChange={(c) => onEdit((x) => x.type !== 'image' && (x.fill = c))} />
          {el.fill && (
            <button className={styles.linkBtn} onClick={() => onEdit((x) => x.type !== 'image' && delete x.fill)}>
              Remover
            </button>
          )}
        </Field>
      )}

      <h4>{isLine ? 'Traço' : 'Borda'}</h4>
      <Field label="Cor">
        <ColorInput
          value={stroke}
          empty="Nenhuma"
          onChange={(c) =>
            onEdit((x) => {
              x.stroke = c
              if (!x.strokeWidth) x.strokeWidth = x.type === 'shape' ? 1.5 : 1
            })
          }
        />
      </Field>
      <Slider
        label="Espessura"
        min={0}
        max={16}
        step={0.5}
        value={strokeW}
        unit=" pt"
        onChange={(v) =>
          onEdit((x) => {
            const line = x.type === 'shape' && x.shape === 'line'
            if (v <= 0 && !line) {
              delete x.stroke
              delete x.strokeWidth
            } else {
              x.strokeWidth = Math.max(line ? 0.5 : 0, v)
              x.stroke ??= '#1f2430'
            }
          })
        }
      />
      {canRound(el) && <Slider label="Arredondamento" min={0} max={Math.max(1, maxRadius)} step={1} value={Math.round(radiusOf(el))} unit=" px" onChange={(v) => onEdit((x) => canRound(x) && (x.radius = v))} />}

      <h4>Efeitos</h4>
      <Slider label="Opacidade" min={5} max={100} step={1} value={Math.round((el.opacity ?? 1) * 100)} unit="%" onChange={(v) => onEdit((x) => (v >= 100 ? delete x.opacity : (x.opacity = v / 100)))} />
      <Slider
        label="Rotação"
        min={-180}
        max={180}
        step={1}
        value={Math.round(el.rot ?? 0)}
        unit="°"
        onChange={(v) => onEdit((x) => (v === 0 ? delete x.rot : (x.rot = v)))}
        extra={
          el.rot ? (
            <button className={styles.iconBtn} onClick={() => onEdit((x) => delete x.rot)} title="Sem rotação" aria-label="Sem rotação">
              <RotateCcw size={13} />
            </button>
          ) : null
        }
      />

      {hasText && (
        <>
          <h4>Texto</h4>
          <Field label="Cor do texto">
            <ColorInput label="Cor do texto" value={run0?.color ?? '#1f2430'} onChange={onTextColor} />
          </Field>
          <Field label="Alinhamento vertical">
            <span className={styles.segment}>
              {(
                [
                  ['top', AlignVerticalJustifyStart, 'Topo'],
                  ['middle', AlignVerticalJustifyCenter, 'Meio'],
                  ['bottom', AlignVerticalJustifyEnd, 'Base'],
                ] as const
              ).map(([v, Icon, label]) => (
                <button
                  key={v}
                  data-on={(el.valign ?? (el.type === 'shape' ? 'middle' : 'top')) === v || undefined}
                  onClick={() => onEdit((x) => x.type !== 'image' && (x.valign = v))}
                  title={label}
                  aria-label={label}
                >
                  <Icon size={14} />
                </button>
              ))}
            </span>
          </Field>
          <Slider
            label="Espaço entre letras"
            min={-3}
            max={12}
            step={0.5}
            value={run0?.spacing ?? 0}
            unit=" pt"
            onChange={(v) => onEdit((x) => x.type !== 'image' && x.paras.forEach((p) => (p.runs = p.runs.map((r) => ({ ...r, spacing: v || undefined })))))}
          />
        </>
      )}

      <h4>Posição</h4>
      <div className={styles.grid2}>
        <NumberField label="X" value={el.x} onChange={(v) => onEdit((x) => (x.x = v))} />
        <NumberField label="Y" value={el.y} onChange={(v) => onEdit((x) => (x.y = v))} />
        <NumberField label="Largura" value={el.w} min={10} onChange={(v) => onEdit((x) => (x.w = v))} />
        {!isLine && <NumberField label="Altura" value={el.h} min={10} onChange={(v) => onEdit((x) => (x.h = v))} />}
      </div>
    </aside>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldBody}>{children}</span>
    </div>
  )
}

function ColorInput({ value, empty, label, onChange }: { value: string | undefined; empty?: string; label?: string; onChange(c: string): void }) {
  return <ColorField value={value} empty={empty} label={label ?? 'Cor'} onChange={onChange} />
}

function Slider({ label, min, max, step, value, unit, onChange, extra }: { label: string; min: number; max: number; step: number; value: number; unit: string; onChange(v: number): void; extra?: React.ReactNode }) {
  return (
    <div className={styles.slider}>
      <span className={styles.fieldLabel}>
        {label}
        <span className={styles.sliderValue}>
          {extra}
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={Number(value.toFixed(2))}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)))
            }}
            aria-label={label}
          />
          {unit.trim()}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={Math.max(min, Math.min(max, value))} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </div>
  )
}

function NumberField({ label, value, min, onChange }: { label: string; value: number; min?: number; onChange(v: number): void }) {
  return (
    <label className={styles.numberField}>
      <span>{label}</span>
      <input
        type="number"
        value={Math.round(value)}
        min={min}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (e.target.value !== '' && Number.isFinite(v)) onChange(min !== undefined ? Math.max(min, v) : v)
        }}
      />
    </label>
  )
}
