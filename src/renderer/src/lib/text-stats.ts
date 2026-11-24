// Palavras = sequências de letras/números (qualquer alfabeto, com acentos),
// permitindo hífen e apóstrofo internos: "guarda-chuva" e "d'água" contam 1.
const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu

export function countWords(text: string): number {
  let count = 0
  for (const _ of text.matchAll(WORD)) count++
  return count
}

export function countChars(text: string): number {
  // Array.from conta emojis e caracteres compostos como 1, não 2.
  return Array.from(text).length
}
