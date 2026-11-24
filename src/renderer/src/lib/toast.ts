/*
 * Aviso flutuante curto ("Copiado para a área de transferência!"), ancorado
 * num elemento. Some sozinho; não rouba o foco nem bloqueia cliques.
 */

let current: HTMLElement | null = null

export function showToast(message: string, options: { anchor?: Element; kind?: 'success' | 'error'; ms?: number } = {}): void {
  current?.remove()
  const el = document.createElement('div')
  el.className = 'opal-toast'
  el.dataset['kind'] = options.kind ?? 'success'
  el.setAttribute('role', 'status')
  el.setAttribute('aria-live', 'polite')
  const icon = options.kind === 'error' ? '!' : '✓'
  el.innerHTML = `<span class="opal-toast-icon" aria-hidden="true">${icon}</span><span></span>`
  el.lastElementChild!.textContent = message
  document.body.appendChild(el)
  const rect = options.anchor?.getBoundingClientRect()
  if (rect) {
    const w = el.offsetWidth
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, rect.right - w))}px`
    el.style.top = `${Math.max(8, rect.top - el.offsetHeight - 8)}px`
  } else {
    el.style.left = `${(window.innerWidth - el.offsetWidth) / 2}px`
    el.style.bottom = '48px'
  }
  current = el
  setTimeout(() => {
    el.dataset['leaving'] = 'true'
    setTimeout(() => {
      el.remove()
      if (current === el) current = null
    }, 220)
  }, options.ms ?? 1600)
}
