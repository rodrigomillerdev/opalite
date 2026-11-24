/*
 * Registro de "salvadores": tudo o que guarda alterações pendentes (o editor
 * de notas, cada canvas aberto) se registra aqui. Antes de renomear, apagar,
 * trocar de cofre ou fechar a janela, `flushAll()` grava tudo de uma vez,
 * para nenhum salvamento atrasado escrever no caminho antigo.
 */

type Flusher = () => Promise<void>

const flushers = new Set<Flusher>()

export function registerFlusher(fn: Flusher): () => void {
  flushers.add(fn)
  return () => flushers.delete(fn)
}

export async function flushAll(): Promise<void> {
  await Promise.all([...flushers].map((fn) => fn().catch(() => undefined)))
}

/** Avisos vindos de fora do React (ex.: DocumentManager); o App define o destino. */
let noticeSink: (message: string, kind: 'notice' | 'error') => void = () => undefined

export function setNoticeSink(fn: typeof noticeSink): void {
  noticeSink = fn
}

export function notify(message: string, kind: 'notice' | 'error' = 'notice'): void {
  noticeSink(message, kind)
}
