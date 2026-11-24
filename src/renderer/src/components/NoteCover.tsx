import { attachmentsFolder } from '../lib/settings'
import { ImageUp, Move, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { documents } from '../editor/document-manager'
import { blobUrl, fileName, flattenFiles, importFiles } from '../lib/attachments'
import { COLORS, GRADIENTS, parseCover } from '../lib/covers'
import { useEditorStatus } from '../state/editor-status'
import { useVault } from '../state/vault-store'
import styles from './NoteCover.module.css'

/*
 * Capa da nota (como no Notion). Fica sobre o topo do editor e sobe junto
 * com o texto ao rolar. Ao passar o mouse: trocar, reposicionar e remover.
 */

export const COVER_HEIGHT = 220

export function NoteCover({ hostRef }: { hostRef: React.RefObject<HTMLDivElement | null> }) {
  const banner = useEditorStatus((s) => s.frontmatter['banner'])
  const bannerY = useEditorStatus((s) => s.frontmatter['banner_y'])
  const activePath = useVault((s) => s.activePath)
  const cover = useMemo(() => parseCover(banner), [banner])
  const [url, setUrl] = useState<string | null>(null)
  const [scroll, setScroll] = useState(0)
  const [picker, setPicker] = useState(false)
  const [reposition, setReposition] = useState<number | null>(null)
  const tree = useVault((s) => s.tree)

  const imagePath = useMemo(() => {
    if (cover?.kind !== 'image') return null
    const all = flattenFiles(tree)
    return all.find((f) => f.path === cover.path)?.path ?? all.find((f) => fileName(f.path) === fileName(cover.path))?.path ?? null
  }, [cover, tree])

  useEffect(() => {
    let alive = true
    setUrl(null)
    if (imagePath) void blobUrl(imagePath).then((u) => alive && setUrl(u)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [imagePath])

  // Reserva o espaço da capa no editor e acompanha a rolagem.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.style.setProperty('--cover-h', cover ? `${COVER_HEIGHT}px` : '0px')
    setScroll(documents.editorView?.scrollDOM.scrollTop ?? 0)
    const off = documents.onScroll(setScroll)
    return () => {
      off()
    }
  }, [cover, hostRef, activePath])

  const y = reposition ?? (Number.isFinite(Number(bannerY)) ? Number(bannerY) : 50)

  return (
    <>
      {cover && scroll < COVER_HEIGHT && (
        <div className={styles.cover} style={{ height: COVER_HEIGHT, transform: `translateY(${-scroll}px)` }} data-repositioning={reposition !== null || undefined}>
          {cover.kind === 'css' ? (
            <div className={styles.fill} style={{ background: cover.css }} />
          ) : url ? (
            <img
              className={styles.image}
              src={url}
              alt=""
              draggable={false}
              style={{ objectPosition: `50% ${y}%` }}
              onPointerDown={(e) => {
                if (reposition === null) return
                const target = e.currentTarget
                target.setPointerCapture(e.pointerId)
                const startY = e.clientY
                const start = reposition
                const move = (ev: PointerEvent) => setReposition(Math.max(0, Math.min(100, start - ((ev.clientY - startY) / COVER_HEIGHT) * 100)))
                const up = () => {
                  target.removeEventListener('pointermove', move)
                  target.removeEventListener('pointerup', up)
                }
                target.addEventListener('pointermove', move)
                target.addEventListener('pointerup', up)
              }}
            />
          ) : (
            <div className={styles.fill} data-missing>
              {imagePath === null ? `Imagem não encontrada: ${cover.path}` : ''}
            </div>
          )}

          <div className={styles.controls}>
            {reposition !== null ? (
              <>
                <span className={styles.hint}>Arraste a imagem para ajustar</span>
                <button
                  onClick={() => {
                    documents.updateFrontmatter({ banner_y: String(Math.round(reposition)) })
                    setReposition(null)
                  }}
                >
                  Salvar posição
                </button>
                <button onClick={() => setReposition(null)}>Cancelar</button>
              </>
            ) : (
              <>
                <button onClick={() => setPicker(true)}>
                  <ImageUp size={13} strokeWidth={1.75} /> Trocar capa
                </button>
                {cover.kind === 'image' && url && (
                  <button onClick={() => setReposition(y)}>
                    <Move size={13} strokeWidth={1.75} /> Reposicionar
                  </button>
                )}
                <button onClick={() => documents.updateFrontmatter({ banner: null, banner_y: null })} aria-label="Remover capa" title="Remover capa">
                  <Trash2 size={13} strokeWidth={1.75} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {picker && <CoverPicker onClose={() => setPicker(false)} />}
    </>
  )
}

type PickerTab = 'gallery' | 'vault' | 'upload'

export function CoverPicker({ onClose }: { onClose(): void }) {
  const [tab, setTab] = useState<PickerTab>('gallery')
  const tree = useVault((s) => s.tree)
  const images = useMemo(() => flattenFiles(tree).filter((f) => f.ext === 'image'), [tree])
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const choose = (value: string) => {
    documents.updateFrontmatter({ banner: value, banner_y: null })
    onClose()
  }

  const upload = async (files: File[]) => {
    const image = files.find((f) => f.type.startsWith('image/'))
    if (!image) return useVault.setState({ error: 'Escolha um arquivo de imagem.' })
    const { paths, errors } = await importFiles([image], attachmentsFolder())
    await useVault.getState().refreshTree()
    if (errors.length) return useVault.setState({ error: errors[0]! })
    choose(paths[0]!)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.pickerBackdrop} onMouseDown={onClose}>
      <div className={styles.picker} role="dialog" aria-label="Escolher capa" onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.tabs} role="tablist">
          {(
            [
              ['gallery', 'Galeria'],
              ['vault', 'Do cofre'],
              ['upload', 'Enviar'],
            ] as Array<[PickerTab, string]>
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} data-on={tab === id || undefined} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'gallery' && (
          <div className={styles.section}>
            <h4>Gradientes</h4>
            <div className={styles.grid}>
              {GRADIENTS.map((g) => (
                <button key={g.id} className={styles.tile} style={{ background: g.css }} title={g.label} aria-label={g.label} onClick={() => choose(`gradient:${g.id}`)} />
              ))}
            </div>
            <h4>Cores</h4>
            <div className={styles.grid}>
              {COLORS.map((c) => (
                <button key={c} className={styles.tile} style={{ background: c }} title={c} aria-label={`Cor ${c}`} onClick={() => choose(`color:${c}`)} />
              ))}
            </div>
          </div>
        )}

        {tab === 'vault' && (
          <div className={styles.section}>
            {images.length === 0 ? (
              <p className={styles.empty}>Nenhuma imagem no cofre. Use "Enviar" ou arraste imagens para a árvore de arquivos.</p>
            ) : (
              <div className={styles.grid} data-images>
                {images.map((img) => (
                  <VaultImage key={img.path} path={img.path} onPick={() => choose(img.path)} />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'upload' && (
          <div
            className={styles.upload}
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
              void upload([...e.dataTransfer.files])
            }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            <Upload size={20} strokeWidth={1.6} />
            <strong>Arraste uma imagem ou clique para escolher</strong>
            <span>Ela será guardada em "{attachmentsFolder()}" no cofre.</span>
            <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => void upload([...(e.target.files ?? [])])} />
          </div>
        )}
      </div>
    </div>
  )
}

function VaultImage({ path, onPick }: { path: string; onPick(): void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void blobUrl(path).then((u) => alive && setUrl(u)).catch(() => undefined)
    return () => {
      alive = false
    }
  }, [path])
  return (
    <button className={styles.tile} title={path} aria-label={fileName(path)} onClick={onPick} style={url ? { backgroundImage: `url("${url}")` } : undefined} data-image />
  )
}
