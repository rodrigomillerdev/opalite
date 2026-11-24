// Tipos compartilhados entre o processo principal (Node) e a interface (React).
// Convenção: todo caminho que cruza a ponte IPC é RELATIVO à raiz do cofre e
// usa "/" como separador, em qualquer sistema operacional. Ex.: "Projetos/Ideias.md".
// Só o processo principal conhece caminhos absolutos do disco.

export interface VaultInfo {
  /** Caminho absoluto da pasta do cofre. */
  root: string
  /** Nome exibido (nome da pasta). */
  name: string
}

export type FileKind = 'md' | 'canvas' | 'pdf' | 'docx' | 'image' | 'file'

export interface TreeFolder {
  kind: 'folder'
  path: string
  name: string
  children: TreeNode[]
}

export interface TreeFile {
  kind: 'file'
  path: string
  /** Nome do arquivo com extensão, ex.: "Ideias.md". */
  name: string
  /** Nome sem a extensão, usado como título. */
  title: string
  /** Tipo do arquivo: nota, canvas ou anexo. */
  ext: FileKind
}

export type TreeNode = TreeFolder | TreeFile

export interface FileContent {
  path: string
  content: string
  mtimeMs: number
}

export type VaultEventType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export interface VaultEvent {
  type: VaultEventType
  path: string
}

export type EntryKind = 'file' | 'file-convertible' | 'folder' | 'root'
export type EntryMenuAction =
  | 'new-note'
  | 'new-folder'
  | 'rename'
  | 'reveal'
  | 'trash'
  | 'duplicate'
  | 'copy-link'
  | 'search-in-folder'
  | 'convert'
  | 'open-external'
export type PickMode = 'open' | 'create'

/** Ações nativas de edição que o Electron executa sozinho. */
export type MenuRole = 'cut' | 'copy' | 'paste' | 'pasteAndMatchStyle' | 'selectAll'

/** Descrição de um item de menu de contexto montado pela interface. */
export interface MenuSpecItem {
  id?: string
  label?: string
  type?: 'separator'
  accelerator?: string
  role?: MenuRole
  enabled?: boolean
  submenu?: MenuSpecItem[]
}

// ------------------------------------------------------------------ índice

export interface NoteSummary {
  path: string
  title: string
  aliases: string[]
  tags: string[]
  /** Propriedades simples do frontmatter, convertidas em texto (usadas pelas bases). */
  properties: Record<string, string>
}

export interface TagCount {
  tag: string
  count: number
}

export type GraphNodeKind = 'note' | 'canvas' | 'unresolved' | 'tag'

export interface GraphNode {
  /** Caminho do arquivo, "tag:nome" ou "?:nome" (nota ainda não criada). */
  id: string
  label: string
  kind: GraphNodeKind
  /** Pasta de primeiro nível (para colorir por grupo). */
  folder: string
  tags: string[]
}

export interface GraphEdge {
  source: string
  target: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface Mention {
  line: number
  text: string
  from: number
  to: number
}

export interface MentionGroup {
  path: string
  title: string
  mentions: Mention[]
}

export interface Backlinks {
  linked: MentionGroup[]
  unlinked: MentionGroup[]
}

export interface SearchMatch {
  line: number
  text: string
  ranges: Array<[number, number]>
}

export interface SearchResult {
  path: string
  title: string
  score: number
  matches: SearchMatch[]
}

export interface VersionInfo {
  id: string
  time: number
  size: number
  reason: string
}

/** Envelope das respostas IPC: erros viram dados, não exceções serializadas. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** API exposta pelo preload em `window.opalite`. É tudo que a interface pode fazer. */
export interface OpaliteApi {
  vault: {
    pick(mode: PickMode): Promise<VaultInfo | null>
    openRecent(root: string): Promise<VaultInfo>
    close(): Promise<void>
    current(): Promise<VaultInfo | null>
    recent(): Promise<VaultInfo[]>
    tree(): Promise<TreeNode[]>
    onEvents(listener: (events: VaultEvent[]) => void): () => void
  }
  files: {
    read(path: string): Promise<FileContent>
    write(path: string, content: string): Promise<{ mtimeMs: number }>
    createNote(path: string, content?: string): Promise<string>
    createFolder(path: string): Promise<string>
    /** Cria um arquivo .canvas vazio e devolve o caminho final. */
    createCanvas(path: string): Promise<string>
    rename(from: string, to: string): Promise<string>
    /** Pede confirmação e move para a lixeira do sistema. Retorna false se cancelado. */
    trash(path: string): Promise<boolean>
    reveal(path: string): Promise<void>
    /** Lê um arquivo do cofre como bytes (PDF, imagens, DOCX...). */
    readBinary(path: string): Promise<Uint8Array>
    /** Grava um arquivo novo na pasta `dir` (nunca sobrescreve) e devolve o caminho final. */
    importFile(dir: string, name: string, bytes: Uint8Array): Promise<string>
    /** Abre um anexo no aplicativo padrão do sistema. */
    openExternal(path: string): Promise<void>
    /** Sobrescreve um documento/planilha/apresentação; a versão anterior vai para o histórico. */
    writeBinary(path: string, bytes: Uint8Array): Promise<{ mtimeMs: number }>
    /** Tamanho (bytes) e data de modificação de cada caminho. */
    stats(paths: string[]): Promise<Record<string, { size: number; mtimeMs: number }>>
  }
  history: {
    list(path: string): Promise<VersionInfo[]>
    read(path: string, id: string): Promise<Uint8Array>
    /** Volta o arquivo para a versão escolhida (a atual também fica guardada). */
    restore(path: string, id: string): Promise<void>
  }
  state: {
    /** Dados do cofre em `.opalite/state/<chave>.json` (favoritos etc.). */
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
  }
  convert: {
    /** Converte um .docx do cofre em PDF ao lado do original. Devolve o caminho do PDF. */
    docxToPdf(path: string): Promise<string>
    docxToHtml(path: string): Promise<{ html: string; warnings: string[] }>
    /** Imprime uma página HTML completa em PDF (sem JavaScript nem rede). Tamanho em mícrons; padrão A4. */
    htmlToPdf(html: string, page?: { width: number; height: number }): Promise<Uint8Array>
  }
  index: {
    notes(): Promise<NoteSummary[]>
    tags(): Promise<TagCount[]>
    graph(): Promise<GraphData>
    headings(path: string): Promise<string[]>
    /** `unlinked: false` pula as menções soltas (bem mais rápido). */
    backlinks(path: string, options?: { unlinked?: boolean }): Promise<Backlinks>
    search(query: string): Promise<SearchResult[]>
    /** Converte uma menção solta em [[link]] dentro da nota de origem. */
    linkMention(source: string, from: number, to: number, target: string): Promise<void>
    /** Avisa quando o índice muda (gravação, renomeação, mudança externa). */
    onChanged(listener: () => void): () => void
  }
  ui: {
    /** Mostra um menu de contexto nativo e devolve o id escolhido (ou null). */
    contextMenu(items: MenuSpecItem[]): Promise<string | null>
    entryMenu(kind: EntryKind): Promise<EntryMenuAction | null>
    toggleFullscreen(): Promise<void>
    /** Botões de janela desenhados pelo app (Windows/Linux). */
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    /** Fecha a janela pelo caminho normal (salva a nota aberta antes). */
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    /** Avisa quando a janela é maximizada ou restaurada. */
    onMaximized(listener: (maximized: boolean) => void): () => void
    /** Zoom da interface: +1 / -1 passo, 0 = padrão. Devolve o fator atual. */
    zoom(step: 1 | -1 | 0): Promise<number>
    /** Palavra errada sob o clique direito e sugestões do dicionário. */
    spelling(): Promise<{ word: string; suggestions: string[] } | null>
    replaceMisspelling(word: string): Promise<void>
    addToDictionary(word: string): Promise<void>
    /** Ações de edição do sistema (recortar, copiar, colar...). */
    edit(action: MenuRole): Promise<void>
    /** Avisa quando a janela entra ou sai da tela cheia. */
    onFullscreen(listener: (fullscreen: boolean) => void): () => void
  }
  app: {
    /** Chamado pelo main antes de fechar a janela, para salvar o que estiver pendente. */
    onBeforeClose(listener: () => void): () => void
    closeReady(): void
  }
}
