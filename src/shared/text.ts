/**
 * Minúsculas e sem acentos: "Ação" e "acao" viram o mesmo texto.
 * Para texto já em forma NFC (o normal), o resultado tem o mesmo tamanho do
 * original, então as posições encontradas valem para destacar o texto original.
 */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}
