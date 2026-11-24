import { File, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, Folder, Presentation, ScrollText, type LucideIcon } from 'lucide-react'
import { extOf } from '../../lib/attachments'
import { CanvasGlyph } from '../ui/glyphs'

/*
 * Categorias de arquivo do gerenciador: dão o ícone, a cor do selo e os
 * filtros ("Documentos", "Planilhas"...). A cor vem de variáveis CSS
 * (--kind-*) para os temas poderem ajustá-las.
 */

export type Category = 'folder' | 'note' | 'canvas' | 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'image' | 'media' | 'archive' | 'other'

const BY_EXT: Record<string, Category> = {
  md: 'note',
  canvas: 'canvas',
  docx: 'document',
  doc: 'document',
  odt: 'document',
  rtf: 'document',
  txt: 'document',
  xlsx: 'spreadsheet',
  xls: 'spreadsheet',
  ods: 'spreadsheet',
  csv: 'spreadsheet',
  pptx: 'presentation',
  ppt: 'presentation',
  odp: 'presentation',
  pdf: 'pdf',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  avif: 'image',
  mp3: 'media',
  wav: 'media',
  ogg: 'media',
  m4a: 'media',
  flac: 'media',
  mp4: 'media',
  webm: 'media',
  mov: 'media',
  zip: 'archive',
}

export function categoryOf(path: string, isFolder = false): Category {
  if (isFolder) return 'folder'
  return BY_EXT[extOf(path)] ?? 'other'
}

export const CATEGORY_LABEL: Record<Category, string> = {
  folder: 'Pasta',
  note: 'Nota',
  canvas: 'Canvas',
  document: 'Documento',
  spreadsheet: 'Planilha',
  presentation: 'Apresentação',
  pdf: 'PDF',
  image: 'Imagem',
  media: 'Áudio/vídeo',
  archive: 'Compactado',
  other: 'Arquivo',
}

export function iconOf(path: string, cat: Category): LucideIcon | typeof CanvasGlyph {
  switch (cat) {
    case 'folder':
      return Folder
    case 'note':
      return FileText
    case 'canvas':
      return CanvasGlyph
    case 'document':
      return ScrollText
    case 'spreadsheet':
      return FileSpreadsheet
    case 'presentation':
      return Presentation
    case 'pdf':
      return FileText
    case 'image':
      return FileImage
    case 'media':
      return /\.(mp4|webm|mov)$/i.test(path) ? FileVideo : FileAudio
    case 'archive':
      return FileArchive
    default:
      return File
  }
}

/** Filtros do gerenciador (ordem de exibição). */
export const FILTERS: Array<{ id: 'all' | Category; label: string }> = [
  { id: 'all', label: 'Tudo' },
  { id: 'note', label: 'Notas' },
  { id: 'document', label: 'Documentos' },
  { id: 'spreadsheet', label: 'Planilhas' },
  { id: 'presentation', label: 'Apresentações' },
  { id: 'pdf', label: 'PDFs' },
  { id: 'image', label: 'Imagens' },
  { id: 'canvas', label: 'Canvas' },
  { id: 'other', label: 'Outros' },
]

/** "Outros" agrupa o que não tem filtro próprio. */
export function matchesFilter(cat: Category, filter: 'all' | Category): boolean {
  if (filter === 'all') return true
  if (filter === 'other') return cat === 'other' || cat === 'media' || cat === 'archive'
  return cat === filter
}
