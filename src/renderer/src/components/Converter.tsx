import { ArrowRight, Check, FolderOpen, TriangleAlert, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { extOf, fileName, flattenFiles, importFiles } from '../lib/attachments'
import { CONVERTIBLE_EXTS, type Conversion, conversionsFor } from '../lib/convert/registry'
import { fuzzyFilter } from '../lib/fuzzy'
import type { Progress } from '../lib/pdf-to-docx'
import { attachmentsFolder } from '../lib/settings'
import { useVault } from '../state/vault-store'
import { useWorkspace } from '../state/workspace-store'
import styles from './Converter.module.css'
import { categoryOf, iconOf } from './files/file-types'

/*
 * Conversor de arquivos: PDF, Word, notas, planilhas, apresentações e
 * imagens. Mostra todos os formatos de destino possíveis para o arquivo
 * escolhido, o andamento de cada etapa e o resultado. O original nunca é
 * alterado; nada é enviado para a internet.
 */

type Status = { kind: 'idle' } | { kind: 'working'; progress: Progress } | { kind: 'done'; paths: string[]; ms: number } | { kind: 'error'; message: string }

const EXT_LABEL: Record<string, string> = {
  pdf: 'PDF',
  docx: 'Documento do Word',
  md: 'Nota (Markdown)',
  txt: 'Texto',
  xlsx: 'Planilha',
  csv: 'CSV',
  pptx: 'Apresentação',
  png: 'Imagem PNG',
  jpg: 'Imagem JPG',
  jpeg: 'Imagem JPG',
  webp: 'Imagem WebP',
  bmp: 'Imagem BMP',
  gif: 'Imagem GIF',
  html: 'Página HTML',
}

export function Converter() {
  const initial = useWorkspace((s) => s.converterPath)
  const close = useWorkspace((s) => s.closeModal)
  const tree = useVault((s) => s.tree)
  const [source, setSource] = useState<string | null>(initial && CONVERTIBLE_EXTS.has(extOf(initial)) ? initial : null)
  const [target, setTarget] = useState<Conversion | null>(null)
  const [option, setOption] = useState<string | undefined>(undefined)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [query, setQuery] = useState('')
  const [dragging, setDragging] = useState(false)
  const signal = useRef({ cancelled: false })
  const inputRef = useRef<HTMLInputElement>(null)

  const candidates = useMemo(
    () => flattenFiles(tree).filter((f) => CONVERTIBLE_EXTS.has(extOf(f.path))),
    [tree],
  )
  const results = fuzzyFilter(candidates, query, (f) => f.path, 60)
  const options = source ? conversionsFor(source) : []
  const working = status.kind === 'working'

  // Primeiro destino já vem escolhido; troca de arquivo reinicia.
  useEffect(() => {
    const first = source ? conversionsFor(source)[0] ?? null : null
    setTarget(first)
    setOption(first?.options?.[0]?.id)
    setStatus({ kind: 'idle' })
  }, [source])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !working && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, working])

  const pickFiles = async (files: File[]) => {
    const file = files.find((f) => CONVERTIBLE_EXTS.has(extOf(f.name)))
    if (!file) return setStatus({ kind: 'error', message: `Formato não suportado. Aceitos: ${[...CONVERTIBLE_EXTS].map((e) => `.${e}`).join(', ')}.` })
    const { paths, errors } = await importFiles([file], attachmentsFolder())
    await useVault.getState().refreshTree()
    if (errors.length) return setStatus({ kind: 'error', message: errors[0]! })
    setSource(paths[0]!)
  }

  const convert = async () => {
    if (!source || !target) return
    signal.current = { cancelled: false }
    const started = performance.now()
    setStatus({ kind: 'working', progress: { done: 0, total: 1, label: 'Preparando' } })
    const dir = source.includes('/') ? source.slice(0, source.lastIndexOf('/')) : ''
    try {
      const paths = await target.run({
        path: source,
        option,
        signal: signal.current,
        bytes: () => window.opalite.files.readBinary(source),
        progress: (progress) => setStatus({ kind: 'working', progress }),
        save: async (name, bytes, subfolder) => {
          if (signal.current.cancelled) throw new Error('Conversão cancelada.')
          return window.opalite.files.importFile(subfolder ? (dir ? `${dir}/${subfolder}` : subfolder) : dir, name, bytes)
        },
      })
      await useVault.getState().refreshTree()
      setStatus({ kind: 'done', paths, ms: performance.now() - started })
    } catch (err) {
      await useVault.getState().refreshTree()
      setStatus({ kind: 'error', message: friendly((err as Error).message) })
    }
  }

  const pct = status.kind === 'working' ? Math.round((status.progress.done / Math.max(1, status.progress.total)) * 100) : 0
  const srcExt = source ? extOf(source) : ''
  const SrcIcon = source ? iconOf(source, categoryOf(source)) : null

  return (
    <div className={styles.backdrop} onMouseDown={() => !working && close()}>
      <div className={styles.dialog} role="dialog" aria-label="Conversor de arquivos" onMouseDown={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <div>
            <h2>Conversor de arquivos</h2>
            <p>PDF, Word, notas, planilhas, apresentações e imagens. Tudo no seu computador.</p>
          </div>
          <button className={styles.icon} onClick={close} disabled={working} aria-label="Fechar">
            <X size={16} strokeWidth={1.75} />
          </button>
        </header>

        {!source ? (
          <>
            <div
              className={styles.drop}
              data-own-drop
              data-active={dragging || undefined}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                void pickFiles([...e.dataTransfer.files])
              }}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
            >
              <Upload size={22} strokeWidth={1.6} />
              <strong>Arraste um arquivo aqui</strong>
              <span>PDF, DOCX, MD, TXT, XLSX, CSV, PPTX, PNG, JPG, WebP…</span>
              <input ref={inputRef} type="file" accept={[...CONVERTIBLE_EXTS].map((e) => `.${e}`).join(',')} hidden onChange={(e) => void pickFiles([...(e.target.files ?? [])])} />
            </div>
            {status.kind === 'error' && <p className={styles.error}>{status.message}</p>}
            <div className={styles.listHeader}>
              <span>Do cofre</span>
              <input placeholder="Buscar…" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
            </div>
            <div className={styles.list}>
              {results.length === 0 && <p className={styles.empty}>Nenhum arquivo conversível encontrado.</p>}
              {results.map(({ item }) => {
                const Icon = iconOf(item.path, categoryOf(item.path))
                return (
                  <button key={item.path} className={styles.item} onClick={() => setSource(item.path)}>
                    <span className={styles.fileIcon} data-cat={categoryOf(item.path)}>
                      <Icon size={15} strokeWidth={1.6} />
                    </span>
                    <span>{fileName(item.path)}</span>
                    <small>{item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : 'raiz'}</small>
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <>
            <div className={styles.flow}>
              <div className={styles.fileCard}>
                <span className={styles.fileIcon} data-cat={categoryOf(source)} data-large>
                  {SrcIcon && <SrcIcon size={20} strokeWidth={1.6} />}
                </span>
                <div>
                  <strong title={source}>{fileName(source)}</strong>
                  <span>{EXT_LABEL[srcExt] ?? srcExt.toUpperCase()}</span>
                </div>
              </div>
              <ArrowRight size={18} strokeWidth={1.75} className={styles.arrow} />
              <div className={styles.fileCard} data-target>
                <span className={styles.fileIcon} data-cat={target ? categoryOf(`x.${target.to}`) : 'other'} data-large>
                  <span className={styles.extBadge}>{target?.to.toUpperCase()}</span>
                </span>
                <div>
                  <strong>{target ? `${fileName(source).replace(/\.[^.]+$/, '')}.${target.to}` : '—'}</strong>
                  <span>{target ? EXT_LABEL[target.to] ?? target.to.toUpperCase() : ''}</span>
                </div>
              </div>
            </div>

            {status.kind !== 'done' && (
              <>
                <div className={styles.targets} role="radiogroup" aria-label="Converter para">
                  {options.map((c) => (
                    <button
                      key={c.id}
                      role="radio"
                      aria-checked={target?.id === c.id}
                      data-on={target?.id === c.id || undefined}
                      disabled={working}
                      onClick={() => {
                        setTarget(c)
                        setOption(c.options?.[0]?.id)
                        setStatus({ kind: 'idle' })
                      }}
                    >
                      <span className={styles.targetExt} data-cat={categoryOf(`x.${c.to}`)}>
                        {c.to.toUpperCase()}
                      </span>
                      <strong>{c.label}</strong>
                      <span>{c.description}</span>
                    </button>
                  ))}
                </div>
                {target?.options && (
                  <div className={styles.modes} role="radiogroup" aria-label="Modo">
                    {target.options.map((o) => (
                      <button key={o.id} role="radio" aria-checked={option === o.id} data-on={option === o.id || undefined} onClick={() => setOption(o.id)} disabled={working}>
                        <strong>{o.label}</strong>
                        <span>{o.description}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {status.kind === 'working' && (
              <div className={styles.progress} aria-live="polite">
                <div className={styles.bar}>
                  <span style={{ width: `${Math.max(pct, 4)}%` }} data-indeterminate={status.progress.total <= 1 || undefined} />
                </div>
                <span>
                  {status.progress.label}… {status.progress.total > 1 ? `${pct}%` : ''}
                </span>
              </div>
            )}
            {status.kind === 'error' && (
              <p className={styles.error}>
                <TriangleAlert size={14} /> {status.message}
              </p>
            )}

            {status.kind === 'done' && (
              <div className={styles.done}>
                <div className={styles.doneIcon}>
                  <Check size={18} strokeWidth={2.2} />
                </div>
                <div>
                  <strong>
                    {status.paths.length === 1 ? `Pronto: ${fileName(status.paths[0]!)}` : `Pronto: ${status.paths.length} arquivos`}
                  </strong>
                  <span>
                    Salvo em {status.paths[0]!.includes('/') ? status.paths[0]!.slice(0, status.paths[0]!.lastIndexOf('/')) : 'raiz do cofre'} · {(status.ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s
                  </span>
                </div>
                <div className={styles.doneActions}>
                  <button onClick={() => void useVault.getState().reveal(status.paths[0]!)}>
                    <FolderOpen size={14} strokeWidth={1.75} /> Mostrar
                  </button>
                  <button
                    className={styles.primary}
                    onClick={() => {
                      close()
                      void useVault.getState().openFile(status.paths[0]!, { newTab: true })
                    }}
                  >
                    Abrir
                  </button>
                </div>
              </div>
            )}

            <footer className={styles.footer}>
              <button
                onClick={() => {
                  if (working) signal.current.cancelled = true
                  else {
                    setSource(null)
                    setStatus({ kind: 'idle' })
                  }
                }}
              >
                {working ? 'Cancelar' : status.kind === 'done' ? 'Converter outro' : 'Trocar arquivo'}
              </button>
              {status.kind !== 'done' && (
                <button className={styles.primary} onClick={() => void convert()} disabled={working || !target}>
                  {working ? 'Convertendo…' : target ? `Converter para ${target.to.toUpperCase()}` : 'Converter'}
                </button>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  )
}

/** Mensagens de erro técnicas em português claro. */
function friendly(message: string): string {
  if (/cancelad/i.test(message)) return 'Conversão cancelada. Nenhum arquivo incompleto foi deixado para trás além do que já estava pronto.'
  if (/password|senha|encrypted/i.test(message)) return 'Este PDF está protegido por senha e não pode ser convertido.'
  if (/Invalid PDF|corrupt|inválido/i.test(message)) return 'O arquivo parece corrompido ou não é do formato esperado.'
  if (/grande demais|too large/i.test(message)) return message
  return `Não foi possível converter: ${message}`
}
