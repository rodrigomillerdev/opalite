import { FileSpreadsheet, Presentation, ScrollText } from 'lucide-react'

/*
 * Documentos novos criados pelo Opalite. Os geradores ficam em import()
 * dinâmico: só carregam quando alguém cria ou abre um arquivo desses.
 */

export const NEW_FILE_KINDS = [
  { id: 'document', label: 'Documento', ext: 'docx', icon: ScrollText, name: 'Documento sem título' },
  { id: 'spreadsheet', label: 'Planilha', ext: 'xlsx', icon: FileSpreadsheet, name: 'Planilha sem título' },
  { id: 'presentation', label: 'Apresentação', ext: 'pptx', icon: Presentation, name: 'Apresentação sem título' },
] as const

export async function blankOffice(kind: string): Promise<Uint8Array> {
  if (kind === 'document') {
    const { htmlToDocx } = await import('../../lib/office/docx-html')
    return htmlToDocx('<p></p>')
  }
  if (kind === 'spreadsheet') {
    const [{ writeXlsx }, { newWorkbook }] = await Promise.all([import('../../lib/office/xlsx'), import('../../lib/office/workbook')])
    return writeXlsx(newWorkbook())
  }
  if (kind === 'presentation') {
    const [{ writePptx }, { newPresentation }] = await Promise.all([import('../../lib/office/pptx'), import('../../lib/office/presentation')])
    return writePptx(newPresentation())
  }
  throw new Error(`Tipo de arquivo desconhecido: ${kind}`)
}

/** Cria o arquivo na pasta e devolve o caminho final (nunca sobrescreve). */
export async function createOfficeFile(kind: string, dir: string): Promise<string> {
  const spec = NEW_FILE_KINDS.find((k) => k.id === kind)
  if (!spec) throw new Error(`Tipo de arquivo desconhecido: ${kind}`)
  const bytes = await blankOffice(kind)
  return window.opalite.files.importFile(dir, `${spec.name}.${spec.ext}`, bytes)
}
