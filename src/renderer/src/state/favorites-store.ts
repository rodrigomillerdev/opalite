import { create } from 'zustand'
import { useVault } from './vault-store'

/*
 * Favoritos: notas, pastas e arquivos marcados com estrela. Ficam no próprio
 * cofre (`.opalite/state/favorites.json`), então acompanham a pasta.
 * Renomear ou mover um item atualiza o favorito; apagar remove.
 */

interface FavoritesState {
  paths: string[]
  isFavorite(path: string): boolean
  toggle(path: string): void
}

const KEY = 'favorites'

const save = (paths: string[]) => void window.opalite.state.set(KEY, paths).catch(() => {})

export const useFavorites = create<FavoritesState>((set, get) => ({
  paths: [],
  isFavorite: (path) => get().paths.includes(path),
  toggle(path) {
    const paths = get().paths.includes(path) ? get().paths.filter((p) => p !== path) : [...get().paths, path]
    set({ paths })
    save(paths)
  },
}))

const within = (p: string, base: string) => p === base || p.startsWith(`${base}/`)

// Carrega ao abrir/trocar de cofre.
let loadedFor: string | null = null
useVault.subscribe((s) => {
  const root = s.vault?.root ?? null
  if (root === loadedFor) return
  loadedFor = root
  useFavorites.setState({ paths: [] })
  if (!root) return
  void window.opalite.state
    .get(KEY)
    .then((v) => {
      if (loadedFor === root && Array.isArray(v)) useFavorites.setState({ paths: v.filter((p): p is string => typeof p === 'string') })
    })
    .catch(() => {})
})

// Renomear/mover/apagar (eventos disparados pelo vault-store).
window.addEventListener('opalite:moved', (e) => {
  const { from, to } = (e as CustomEvent<{ from: string; to: string }>).detail
  const { paths } = useFavorites.getState()
  if (!paths.some((p) => within(p, from))) return
  const next = paths.map((p) => (within(p, from) ? to + p.slice(from.length) : p))
  useFavorites.setState({ paths: next })
  save(next)
})

window.addEventListener('opalite:deleted', (e) => {
  const { path } = (e as CustomEvent<{ path: string }>).detail
  const { paths } = useFavorites.getState()
  if (!paths.some((p) => within(p, path))) return
  const next = paths.filter((p) => !within(p, path))
  useFavorites.setState({ paths: next })
  save(next)
})
