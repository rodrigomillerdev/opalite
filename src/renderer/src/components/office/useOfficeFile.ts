import { useCallback, useEffect, useRef, useState } from 'react'
import { registerFlusher, notify } from '../../lib/flushers'

/*
 * Ciclo de vida comum aos editores de documento, planilha e apresentação:
 * lê o arquivo, avisa quando há alterações, salva sozinho depois de uma
 * pausa (e com Ctrl+S), e grava o que estiver pendente antes de fechar a
 * aba, renomear ou sair do app. A versão anterior vai para o histórico
 * (o processo principal guarda uma cópia antes de sobrescrever).
 */

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

interface Options<T> {
  path: string
  /** Converte bytes do arquivo no modelo do editor. */
  load(bytes: Uint8Array): Promise<T> | T
  /** Converte o modelo atual em bytes para gravar. */
  save(model: T): Promise<Uint8Array> | Uint8Array
  /** Pausa antes do salvamento automático (ms). */
  delay?: number
}

export function useOfficeFile<T>({ path, load, save, delay = 1500 }: Options<T>) {
  const [model, setModel] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<SaveState>('saved')
  const current = useRef<T | null>(null)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  const saveRef = useRef(save)
  saveRef.current = save

  useEffect(() => {
    let alive = true
    setModel(null)
    setError(null)
    setState('saved')
    dirty.current = false
    window.opalite.files
      .readBinary(path)
      .then((bytes) => load(bytes))
      .then((m) => {
        if (!alive) return
        current.current = m
        setModel(m)
      })
      .catch((err: Error) => alive && setError(err.message))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (inFlight.current) await inFlight.current
    if (!dirty.current || !current.current) return
    dirty.current = false
    setState('saving')
    const task = (async () => {
      try {
        const bytes = await saveRef.current(current.current!)
        await window.opalite.files.writeBinary(path, bytes)
        if (!dirty.current) setState('saved')
      } catch (err) {
        dirty.current = true
        setState('error')
        notify(`Não foi possível salvar: ${err instanceof Error ? err.message : String(err)}`, 'error')
      }
    })()
    inFlight.current = task
    await task
    inFlight.current = null
  }, [path])

  /** O editor chama a cada alteração (com o modelo novo). */
  const change = useCallback(
    (next: T) => {
      current.current = next
      dirty.current = true
      setState('dirty')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), delay)
    },
    [flush, delay],
  )

  // Salva ao fechar a aba/app e quando outro fluxo pede (renomear, trocar de cofre).
  useEffect(() => {
    const off = registerFlusher(flush)
    return () => {
      off()
      void flush()
    }
  }, [flush])

  // Ctrl+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void flush()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [flush])

  return { model, setModel, error, state, change, flush, current }
}

export const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'Salvo',
  dirty: 'Alterações não salvas',
  saving: 'Salvando…',
  error: 'Erro ao salvar',
}
