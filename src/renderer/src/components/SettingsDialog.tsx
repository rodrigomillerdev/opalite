import { Brush, FolderTree, Info, Keyboard, PenLine, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { COMMANDS, formatHotkey } from '../lib/commands'
import { type AppSettings, type DailySettings, dailyNoteSettings, getSettings, saveDailyNoteSettings, updateSettings } from '../lib/settings'
import { THEMES, type ThemeId, applyTheme, loadTheme } from '../lib/theme'
import { useVault } from '../state/vault-store'
import { useWorkspace } from '../state/workspace-store'
import { Keys } from './Prompt'
import styles from './SettingsDialog.module.css'

type Section = 'appearance' | 'editor' | 'files' | 'shortcuts' | 'about'

const SECTIONS: Array<{ id: Section; label: string; icon: typeof Brush }> = [
  { id: 'appearance', label: 'Aparência', icon: Brush },
  { id: 'editor', label: 'Editor', icon: PenLine },
  { id: 'files', label: 'Arquivos e pastas', icon: FolderTree },
  { id: 'shortcuts', label: 'Atalhos', icon: Keyboard },
  { id: 'about', label: 'Sobre', icon: Info },
]

/** Configurações (Ctrl+,): tudo se aplica na hora, sem botão "salvar". */
export function SettingsDialog() {
  const close = useWorkspace((s) => s.closeModal)
  const [section, setSection] = useState<Section>('appearance')
  const [s, setS] = useState<AppSettings>(getSettings)
  const [daily, setDaily] = useState<DailySettings>(dailyNoteSettings)
  const [theme, setTheme] = useState<ThemeId>(loadTheme)
  const vault = useVault((st) => st.vault)

  const set = (patch: Partial<AppSettings>) => setS(updateSettings(patch))
  const setD = (patch: Partial<DailySettings>) => {
    saveDailyNoteSettings(patch)
    setDaily(dailyNoteSettings())
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div className={styles.backdrop} onMouseDown={close}>
      <div className={styles.dialog} role="dialog" aria-label="Configurações" onMouseDown={(e) => e.stopPropagation()}>
        <nav className={styles.nav} aria-label="Seções">
          <h2>Configurações</h2>
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button key={id} data-on={section === id || undefined} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>

        <div className={styles.content}>
          <header className={styles.header}>
            <h3>{SECTIONS.find((x) => x.id === section)!.label}</h3>
            <button className={styles.close} onClick={close} aria-label="Fechar">
              <X size={16} />
            </button>
          </header>

          {section === 'appearance' && (
            <div className={styles.rows}>
              <Row title="Tema" hint="Os três temas de opala ou o seu tema personalizado.">
                <div className={styles.chips}>
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      data-on={theme === t.id || undefined}
                      onClick={() => {
                        applyTheme(t.id)
                        setTheme(t.id)
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </Row>
              <Row title="Tema personalizado" hint="Cores, textura e intensidade.">
                <button className={styles.button} onClick={() => useWorkspace.getState().openModal('theme')}>
                  Editar cores…
                </button>
              </Row>
              <Row title="Estúdio de temas" hint="Cor de cada parte da interface, gradientes e temas salvos.">
                <button className={styles.button} onClick={() => useWorkspace.getState().openModal('studio')}>
                  Abrir estúdio…
                </button>
              </Row>
              <Row title="Reduzir animações" hint="Desliga as transições da interface.">
                <Switch value={s.reduceMotion} onChange={(v) => set({ reduceMotion: v })} />
              </Row>
            </div>
          )}

          {section === 'editor' && (
            <div className={styles.rows}>
              <Row title="Tamanho do texto" hint={`${s.editorFontSize} px`}>
                <input type="range" min={13} max={24} step={1} value={s.editorFontSize} onChange={(e) => set({ editorFontSize: Number(e.target.value) })} aria-label="Tamanho do texto" />
              </Row>
              <Row title="Altura da linha" hint={s.lineHeight.toFixed(2).replace('.', ',')}>
                <input type="range" min={1.4} max={2.1} step={0.02} value={s.lineHeight} onChange={(e) => set({ lineHeight: Number(e.target.value) })} aria-label="Altura da linha" />
              </Row>
              <Row title="Largura da linha" hint="Linhas mais curtas são mais confortáveis para ler.">
                <div className={styles.chips}>
                  {(
                    [
                      [640, 'Estreita'],
                      [720, 'Confortável'],
                      [880, 'Larga'],
                      [0, 'Total'],
                    ] as const
                  ).map(([w, label]) => (
                    <button key={w} data-on={s.lineWidth === w || undefined} onClick={() => set({ lineWidth: w })}>
                      {label}
                    </button>
                  ))}
                </div>
              </Row>
              <Row title="Fonte do texto">
                <div className={styles.chips}>
                  {(
                    [
                      ['sans', 'Sem serifa'],
                      ['serif', 'Com serifa'],
                      ['mono', 'Monoespaçada'],
                    ] as const
                  ).map(([f, label]) => (
                    <button key={f} data-on={s.textFont === f || undefined} onClick={() => set({ textFont: f })}>
                      {label}
                    </button>
                  ))}
                </div>
              </Row>
              <Row title="Corretor ortográfico" hint="Português e inglês, pelo dicionário do sistema.">
                <Switch value={s.spellcheck} onChange={(v) => set({ spellcheck: v })} />
              </Row>
            </div>
          )}

          {section === 'files' && (
            <div className={styles.rows}>
              <Row title="Pasta de anexos" hint="Para onde vão os arquivos soltos na nota.">
                <TextField value={s.attachmentsFolder} placeholder="Anexos" onCommit={(v) => set({ attachmentsFolder: v || 'Anexos' })} />
              </Row>
              <Row title="Novas notas" hint="Onde criar notas com Ctrl+N.">
                <div className={styles.chips}>
                  <button data-on={s.newNoteLocation === 'current' || undefined} onClick={() => set({ newNoteLocation: 'current' })}>
                    Pasta da nota atual
                  </button>
                  <button data-on={s.newNoteLocation === 'root' || undefined} onClick={() => set({ newNoteLocation: 'root' })}>
                    Raiz do cofre
                  </button>
                </div>
              </Row>
              <Row title="Pasta das notas diárias" hint="Vazio = raiz do cofre.">
                <TextField value={daily.folder} placeholder="(raiz)" onCommit={(v) => setD({ folder: v })} />
              </Row>
              <Row title="Formato da nota diária" hint="AAAA = YYYY, MM, DD, dddd (dia da semana).">
                <TextField value={daily.format} placeholder="YYYY-MM-DD" onCommit={(v) => setD({ format: v || 'YYYY-MM-DD' })} />
              </Row>
              <Row title="Modelo da nota diária" hint="Caminho de uma nota usada como modelo (opcional).">
                <TextField value={daily.template} placeholder="Modelos/Diária.md" onCommit={(v) => setD({ template: v })} />
              </Row>
              <Row title="Pasta de modelos" hint="Notas usadas em “Inserir modelo”.">
                <TextField value={daily.templatesFolder} placeholder="Modelos" onCommit={(v) => setD({ templatesFolder: v || 'Modelos' })} />
              </Row>
            </div>
          )}

          {section === 'shortcuts' && (
            <ul className={styles.shortcuts}>
              {COMMANDS.filter((c) => c.hotkey || c.editorKey)
                .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
                .map((c) => (
                  <li key={c.id}>
                    <span>{c.name}</span>
                    <Keys keys={formatHotkey((c.hotkey ?? c.editorKey)!)} />
                  </li>
                ))}
            </ul>
          )}

          {section === 'about' && (
            <div className={styles.about}>
              <p>
                <strong>Opalite</strong> 0.1.0 — notas em Markdown, guardadas numa pasta sua.
              </p>
              {vault && (
                <p>
                  Cofre atual: <code>{vault.root}</code>
                </p>
              )}
              <p>Licença MIT. Seus arquivos nunca saem do computador sem você pedir.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.label}>
        <span>{title}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className={styles.control}>{children}</div>
    </div>
  )
}

function Switch({ value, onChange }: { value: boolean; onChange(v: boolean): void }) {
  return <button role="switch" aria-checked={value} className={styles.switch} data-on={value || undefined} onClick={() => onChange(!value)} />
}

function TextField({ value, placeholder, onCommit }: { value: string; placeholder?: string; onCommit(v: string): void }) {
  const [text, setText] = useState(value)
  return (
    <input
      className={styles.input}
      value={text}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() !== value && onCommit(text.trim())}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}
