import { normalizeText } from '../../../shared/text'

export interface FuzzyMatch {
  score: number
  /** Posições do texto que casaram, para destacar na lista. */
  indices: number[]
}

const WORD_BREAK = /[\s/\\\-_.()[\]]/

/**
 * Busca aproximada usada na paleta de comandos e na troca rápida.
 * Cada palavra da consulta precisa aparecer no texto, em ordem, mas não
 * necessariamente junta ("nnt" acha "Nova nota"). A pontuação favorece:
 * trechos contínuos, início de palavras e início do texto.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const tokens = normalizeText(query).split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { score: 0, indices: [] }
  const hay = normalizeText(text)
  let score = 0
  const indices = new Set<number>()

  for (const token of tokens) {
    const result = matchToken(token, hay)
    if (!result) return null
    score += result.score
    for (const i of result.indices) indices.add(i)
  }
  // Textos mais curtos ganham um pouco, para "Nota" vencer "Notas antigas".
  score -= hay.length * 0.05
  return { score, indices: [...indices].sort((a, b) => a - b) }
}

function matchToken(token: string, hay: string): FuzzyMatch | null {
  // 1. Trecho contínuo: o melhor caso. Prefere ocorrência em início de palavra.
  let best = -1
  for (let at = hay.indexOf(token); at !== -1; at = hay.indexOf(token, at + 1)) {
    if (at === 0 || WORD_BREAK.test(hay[at - 1]!)) {
      best = at
      break
    }
    if (best === -1) best = at
  }
  if (best !== -1) {
    const wordStart = best === 0 || WORD_BREAK.test(hay[best - 1]!)
    const score = token.length * 10 + (best === 0 ? 30 : 0) + (wordStart ? 15 : 0)
    return { score, indices: Array.from({ length: token.length }, (_, k) => best + k) }
  }

  // 2. Subsequência: letras em ordem, com saltos.
  const indices: number[] = []
  let score = 0
  let pos = 0
  for (const ch of token) {
    // Prefere a próxima ocorrência que comece uma palavra.
    let found = -1
    for (let i = pos; i < hay.length; i++) {
      if (hay[i] !== ch) continue
      if (found === -1) found = i
      if (i === 0 || WORD_BREAK.test(hay[i - 1]!)) {
        found = i
        break
      }
    }
    if (found === -1) return null
    const prev = indices[indices.length - 1]
    score += 4
    if (prev !== undefined && found === prev + 1) score += 5
    if (found === 0 || WORD_BREAK.test(hay[found - 1]!)) score += 6
    if (prev !== undefined) score -= Math.min(found - prev - 1, 10) * 0.5
    indices.push(found)
    pos = found + 1
  }
  return { score, indices }
}

/** Ordena itens pela pontuação, descartando os que não casam. */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => string,
  limit = 100,
): Array<{ item: T; match: FuzzyMatch }> {
  if (!query.trim()) return items.slice(0, limit).map((item) => ({ item, match: { score: 0, indices: [] } }))
  const out: Array<{ item: T; match: FuzzyMatch }> = []
  for (const item of items) {
    const match = fuzzyMatch(query, getText(item))
    if (match) out.push({ item, match })
  }
  return out.sort((a, b) => b.match.score - a.match.score).slice(0, limit)
}
