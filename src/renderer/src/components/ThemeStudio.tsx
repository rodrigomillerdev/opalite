import { Check, Copy, Download, Palette, Pencil, Plus, RotateCcw, Trash2, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { hexToRgb, parseColor, rgbToHex } from '../lib/color'
import {
  type CustomTheme,
  DEFAULT_CUSTOM,
  DEFAULT_GRADIENT,
  type SavedTheme,
  THEME_ELEMENTS,
  type ThemeGradient,
  customTokens,
  gradientCss,
  loadCustomTheme,
  loadSavedThemes,
  sanitizeCustomTheme,
  saveCustomTheme,
  storeSavedThemes,
} from '../lib/custom-theme'
import { notify } from '../lib/flushers'
import { THEMES, type ThemeId, applyTheme, loadTheme } from '../lib/theme'
import { useWorkspace } from '../state/workspace-store'
import styles from './ThemeStudio.module.css'

/*
 * Estúdio de temas: cores de cada parte da interface (HEX, RGB, HSL ou nome),
 * gradiente de 2 a 5 cores com direção e intensidade, cores do gráfico e
 * temas salvos (salvar, renomear, duplicar, excluir, exportar/importar).
 * O próprio app é a pré-visualização: tudo se aplica enquanto se edita.
 */

type Section = 'saved' | 'colors' | 'gradient'

const uid = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function ThemeStudio() {
  const close = useWorkspace((s) => s.closeModal)
  const [theme, setTheme] = useState<CustomTheme>(loadCustomTheme)
  const [saved, setSaved] = useState<SavedTheme[]>(loadSavedThemes)
  const [section, setSection] = useState<Section>('colors')
  const [renaming, setRenaming] = useState<string | null>(null)
  const frame = useRef(0)
  const [, force] = useState(0)

  const update = useCallback((next: CustomTheme) => {
    setTheme(next)
    saveCustomTheme(next)
    if (!frame.current) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0
        applyTheme('personalizado')
        force((n) => n + 1)
      })
    }
  }, [])

  // Abrir o estúdio já mostra o tema personalizado.
  useEffect(() => {
    if (loadTheme() !== 'personalizado') applyTheme('personalizado')
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const persist = (list: SavedTheme[]) => {
    setSaved(list)
    storeSavedThemes(list)
  }

  const saveAs = () => {
    const base = 'Meu tema'
    let n = 1
    while (saved.some((s) => s.name === (n === 1 ? base : `${base} ${n}`))) n++
    const item = { id: uid(), name: n === 1 ? base : `${base} ${n}`, theme: structuredClone(theme) }
    persist([...saved, item])
    setRenaming(item.id)
    setSection('saved')
  }

  const exportTheme = (item: SavedTheme | null) => {
    const data = JSON.stringify({ opaliteTheme: 1, name: item?.name ?? 'Tema personalizado', theme: item?.theme ?? theme }, null, 2)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    a.download = `${(item?.name ?? 'tema').replace(/[^\w\- ]+/g, '')}.opalite-theme.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const importTheme = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f || f.size > 200_000) return
      try {
        const json = JSON.parse(await f.text()) as { name?: string; theme?: unknown }
        if (!json.theme) throw new Error('arquivo sem tema')
        const item = { id: uid(), name: String(json.name ?? f.name).slice(0, 60), theme: sanitizeCustomTheme(json.theme) }
        persist([...saved, item])
        update(item.theme)
        notify(`Tema "${item.name}" importado.`, 'notice')
      } catch {
        notify('Este arquivo não é um tema do Opalite.', 'error')
      }
    }
    input.click()
  }

  const setOverride = (token: string, value: string | null) => {
    const overrides = { ...theme.overrides }
    if (value) overrides[token] = value
    else delete overrides[token]
    update({ ...theme, overrides })
  }

  const setGradient = (patch: Partial<ThemeGradient>) => update({ ...theme, gradient: { ...theme.gradient, ...patch } })

  const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
  const baseTokens = customTokens({ ...theme, gradient: { ...theme.gradient, enabled: false } }, systemDark)
  const current = (token: string) =>
    theme.overrides[token] ?? parseColor(baseTokens[token] ?? '') ?? parseColor(getComputedStyle(document.documentElement).getPropertyValue(token)) ?? '#808080'

  return (
    <div className={styles.backdrop} onMouseDown={close}>
      <div className={styles.dialog} role="dialog" aria-label="Estúdio de temas" onMouseDown={(e) => e.stopPropagation()}>
        <nav className={styles.nav}>
          <h2>
            <Palette size={15} /> Estúdio de temas
          </h2>
          {(
            [
              ['colors', 'Cores da interface'],
              ['gradient', 'Gradiente'],
              ['saved', 'Temas salvos'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} data-on={section === id || undefined} onClick={() => setSection(id)}>
              {label}
            </button>
          ))}
          <div className={styles.navFoot}>
            <button className={styles.primary} onClick={saveAs}>
              <Plus size={14} /> Salvar como tema
            </button>
            <button
              className={styles.ghost}
              onClick={() => {
                update(structuredClone(DEFAULT_CUSTOM))
                notify('Tema personalizado restaurado ao padrão.', 'notice')
              }}
            >
              <RotateCcw size={13} /> Restaurar padrão
            </button>
          </div>
        </nav>

        <div className={styles.content}>
          <header className={styles.header}>
            <h3>{section === 'colors' ? 'Cores da interface' : section === 'gradient' ? 'Gradiente' : 'Temas salvos'}</h3>
            <button className={styles.close} onClick={close} aria-label="Fechar">
              <X size={16} />
            </button>
          </header>

          {section === 'colors' &&
            THEME_ELEMENTS.map((group) => (
              <section key={group.group} className={styles.group}>
                <h4>{group.group}</h4>
                {group.items.map((item) => (
                  <ColorField key={item.token} label={item.label} value={current(item.token)} custom={Boolean(theme.overrides[item.token])} onChange={(v) => setOverride(item.token, v)} onReset={() => setOverride(item.token, null)} />
                ))}
              </section>
            ))}

          {section === 'gradient' && (
            <section className={styles.group}>
              <label className={styles.row}>
                <span>Usar gradiente no fundo da janela</span>
                <button role="switch" aria-checked={theme.gradient.enabled} className={styles.switch} data-on={theme.gradient.enabled || undefined} onClick={() => setGradient({ enabled: !theme.gradient.enabled })} />
              </label>
              <div className={styles.gradientPreview} style={{ background: gradientCss(theme.gradient) }}>
                {theme.gradient.kind === 'linear' && <span className={styles.arrow} style={{ transform: `rotate(${theme.gradient.angle - 90}deg)` }} />}
              </div>
              <div className={styles.stops}>
                {theme.gradient.stops.map((stop, i) => (
                  <div key={i} className={styles.stop}>
                    <ColorField
                      compact
                      label={`Cor ${i + 1}`}
                      value={stop}
                      custom
                      onChange={(v) => setGradient({ stops: theme.gradient.stops.map((s, j) => (j === i ? v : s)) })}
                      onReset={theme.gradient.stops.length > 2 ? () => setGradient({ stops: theme.gradient.stops.filter((_, j) => j !== i) }) : undefined}
                      resetLabel="Remover cor"
                    />
                  </div>
                ))}
                {theme.gradient.stops.length < 5 && (
                  <button className={styles.addStop} onClick={() => setGradient({ stops: [...theme.gradient.stops, theme.gradient.stops[theme.gradient.stops.length - 1] ?? '#ffffff'] })}>
                    <Plus size={13} /> Adicionar cor
                  </button>
                )}
              </div>
              <div className={styles.row}>
                <span>Tipo</span>
                <div className={styles.chips}>
                  {(['linear', 'radial'] as const).map((k) => (
                    <button key={k} data-on={theme.gradient.kind === k || undefined} onClick={() => setGradient({ kind: k })}>
                      {k === 'linear' ? 'Linear' : 'Radial'}
                    </button>
                  ))}
                </div>
              </div>
              {theme.gradient.kind === 'linear' && (
                <label className={styles.row}>
                  <span>Direção · {Math.round(theme.gradient.angle)}°</span>
                  <input type="range" min={0} max={359} value={theme.gradient.angle} onChange={(e) => setGradient({ angle: Number(e.target.value) })} />
                </label>
              )}
              <label className={styles.row}>
                <span>Intensidade · {Math.round(theme.gradient.intensity * 100)}%</span>
                <input type="range" min={0} max={1} step={0.01} value={theme.gradient.intensity} onChange={(e) => setGradient({ intensity: Number(e.target.value) })} />
              </label>
              <button className={styles.ghost} onClick={() => setGradient({ ...DEFAULT_GRADIENT, enabled: theme.gradient.enabled })}>
                <RotateCcw size={13} /> Gradiente padrão
              </button>
            </section>
          )}

          {section === 'saved' && (
            <section className={styles.group}>
              <div className={styles.savedTools}>
                <button className={styles.ghost} onClick={importTheme}>
                  <Upload size={13} /> Importar tema…
                </button>
                <button className={styles.ghost} onClick={() => exportTheme(null)}>
                  <Download size={13} /> Exportar o atual
                </button>
              </div>
              <h4>Temas prontos</h4>
              <div className={styles.presets}>
                {THEMES.filter((t) => t.id !== 'personalizado').map((t) => (
                  <button key={t.id} className={styles.preset} data-theme-id={t.id} onClick={() => applyTheme(t.id as ThemeId)}>
                    {t.label}
                  </button>
                ))}
              </div>
              <h4>Meus temas</h4>
              {saved.length === 0 && <p className={styles.muted}>Nenhum tema salvo. Ajuste as cores e use “Salvar como tema”.</p>}
              <ul className={styles.savedList}>
                {saved.map((item) => (
                  <li key={item.id} className={styles.savedItem}>
                    <span className={styles.savedSwatch} style={{ background: item.theme.gradient.enabled ? gradientCss(item.theme.gradient) : (item.theme.overrides['--accent'] ?? '#7c6cf0') }} />
                    {renaming === item.id ? (
                      <input
                        autoFocus
                        defaultValue={item.name}
                        className={styles.renameInput}
                        onBlur={(e) => {
                          persist(saved.map((s) => (s.id === item.id ? { ...s, name: e.target.value.trim().slice(0, 60) || s.name } : s)))
                          setRenaming(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                      />
                    ) : (
                      <span className={styles.savedName}>{item.name}</span>
                    )}
                    <span className={styles.savedActions}>
                      <button onClick={() => update(structuredClone(item.theme))} title="Aplicar">
                        <Check size={14} />
                      </button>
                      <button onClick={() => persist(saved.map((s) => (s.id === item.id ? { ...s, theme: structuredClone(theme) } : s)))} title="Atualizar com as cores atuais">
                        <RotateCcw size={14} />
                      </button>
                      <button onClick={() => setRenaming(item.id)} title="Renomear">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => persist([...saved, { ...structuredClone(item), id: uid(), name: `${item.name} (cópia)` }])} title="Duplicar">
                        <Copy size={14} />
                      </button>
                      <button onClick={() => exportTheme(item)} title="Exportar">
                        <Download size={14} />
                      </button>
                      <button className={styles.danger} onClick={() => persist(saved.filter((s) => s.id !== item.id))} title="Excluir">
                        <Trash2 size={14} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

/** Campo de cor: amostra (seletor do sistema), HEX/nome digitável e RGB. */
function ColorField({
  label,
  value,
  custom,
  compact,
  onChange,
  onReset,
  resetLabel = 'Voltar à cor do tema',
}: {
  label: string
  value: string
  custom: boolean
  compact?: boolean
  onChange(hex: string): void
  onReset?: () => void
  resetLabel?: string
}) {
  const [text, setText] = useState(value)
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    setText(value)
    setInvalid(false)
  }, [value])
  const [r, g, b] = hexToRgb(value)

  const commit = (t: string) => {
    const hex = parseColor(t)
    if (hex) {
      setInvalid(false)
      onChange(hex)
    } else setInvalid(true)
  }

  return (
    <div className={styles.color} data-compact={compact || undefined}>
      <span className={styles.colorLabel}>
        {label}
        {custom && !compact && <em>personalizada</em>}
      </span>
      <div className={styles.colorControls}>
        <label className={styles.swatch} style={{ background: value }} title="Escolher no seletor">
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label}: seletor`} />
        </label>
        <input
          className={styles.hex}
          data-invalid={invalid || undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (parseColor(e.target.value)) commit(e.target.value)
          }}
          onBlur={() => commit(text)}
          onKeyDown={(e) => e.key === 'Enter' && commit(text)}
          spellCheck={false}
          aria-label={`${label}: HEX, RGB, HSL ou nome`}
          title="HEX (#7c6cf0), rgb(124, 108, 240), hsl(248, 82%, 68%) ou nome (teal)"
        />
        {!compact && (
          <span className={styles.rgb}>
            {(['R', 'G', 'B'] as const).map((ch, i) => (
              <input
                key={ch}
                type="number"
                min={0}
                max={255}
                value={[r, g, b][i]}
                onChange={(e) => {
                  const v = [r, g, b]
                  v[i] = Number(e.target.value)
                  onChange(rgbToHex(v[0]!, v[1]!, v[2]!))
                }}
                aria-label={`${label}: ${ch}`}
                title={ch}
              />
            ))}
          </span>
        )}
        {onReset && (custom || compact) && (
          <button className={styles.reset} onClick={onReset} title={resetLabel} aria-label={resetLabel}>
            {compact ? <X size={13} /> : <RotateCcw size={13} />}
          </button>
        )}
      </div>
    </div>
  )
}
