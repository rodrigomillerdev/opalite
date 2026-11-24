import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TreeNode } from '../../shared/types'
import { VaultService } from './vault-service'

// Estes testes usam uma pasta temporária real: assim exercitamos o mesmo
// código de disco que o app usa, sem tocar em nenhum cofre de verdade.

let dir: string
let service: VaultService
const trash = vi.fn(async (abs: string) => {
  await rm(abs, { recursive: true, force: true })
})

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'opalite-test-'))
  service = new VaultService({ trash })
  await service.open(dir)
  trash.mockClear()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function names(nodes: TreeNode[]): string[] {
  return nodes.map((n) => n.name)
}

describe('tree', () => {
  it('lista pastas antes de arquivos, em ordem natural, com notas e anexos conhecidos', async () => {
    await mkdir(path.join(dir, 'Projetos'))
    await mkdir(path.join(dir, '.git'))
    await writeFile(path.join(dir, 'Aula 10.md'), '')
    await writeFile(path.join(dir, 'Aula 2.md'), '')
    await writeFile(path.join(dir, 'imagem.png'), '')
    await writeFile(path.join(dir, 'Projetos', 'Ideia.md'), '')

    const tree = await service.tree()
    expect(names(tree)).toEqual(['Projetos', 'Aula 2.md', 'Aula 10.md', 'imagem.png'])
    const folder = tree[0]
    expect(folder?.kind === 'folder' && folder.children.map((c) => c.path)).toEqual([
      'Projetos/Ideia.md',
    ])
  })

  it('expõe o título da nota sem a extensão', async () => {
    await writeFile(path.join(dir, 'Diário.md'), '')
    const [file] = await service.tree()
    expect(file).toMatchObject({ kind: 'file', title: 'Diário', path: 'Diário.md' })
  })
})

describe('read / write', () => {
  it('grava e lê o mesmo conteúdo, criando pastas intermediárias', async () => {
    await service.write('A/B/Nota.md', '# Olá\n\nconteúdo com acentuação')
    const file = await service.read('A/B/Nota.md')
    expect(file.content).toBe('# Olá\n\nconteúdo com acentuação')
    expect(file.path).toBe('A/B/Nota.md')
  })

  it('não deixa arquivos temporários para trás', async () => {
    await service.write('Nota.md', 'v1')
    await service.write('Nota.md', 'v2')
    expect(await readdir(dir)).toEqual(['Nota.md'])
    expect(await readFile(path.join(dir, 'Nota.md'), 'utf8')).toBe('v2')
  })

  it('recusa arquivos que não são notas', async () => {
    await expect(service.read('segredo.txt')).rejects.toThrow(/\.md e \.canvas/)
    await expect(service.write('script.js', 'x')).rejects.toThrow(/\.md/)
  })

  it('recusa caminhos fora do cofre', async () => {
    await expect(service.read('../fora.md')).rejects.toThrow(/sai do cofre/)
    await expect(service.write('../../fora.md', 'x')).rejects.toThrow(/sai do cofre/)
  })
})

describe('createNote / createFolder', () => {
  it('adiciona .md e numera nomes repetidos', async () => {
    expect(await service.createNote('Ideias')).toBe('Ideias.md')
    expect(await service.createNote('Ideias.md')).toBe('Ideias 1.md')
    expect(await service.createNote('Ideias')).toBe('Ideias 2.md')
  })

  it('limpa nomes inválidos', async () => {
    expect(await service.createNote('Pasta/Reunião: pauta?')).toBe('Pasta/Reunião pauta.md')
  })

  it('cria pastas com nome único', async () => {
    expect(await service.createFolder('Projetos')).toBe('Projetos')
    expect(await service.createFolder('Projetos')).toBe('Projetos 1')
  })
})

describe('canvas', () => {
  it('cria, lê e grava arquivos .canvas e mostra na árvore', async () => {
    const path = await service.createCanvas('Mapas/Ideias')
    expect(path).toBe('Mapas/Ideias.canvas')
    expect(JSON.parse((await service.read(path)).content)).toEqual({ nodes: [], edges: [] })
    await service.write(path, '{"nodes":[],"edges":[]}')
    const [folder] = await service.tree()
    expect(folder?.kind === 'folder' && folder.children[0]).toMatchObject({ title: 'Ideias', ext: 'canvas' })
  })

  it('mantém a extensão .canvas ao renomear', async () => {
    await service.createCanvas('Mapa')
    expect(await service.rename('Mapa.canvas', 'Quadro')).toBe('Quadro.canvas')
  })
})

describe('anexos', () => {
  it('importa bytes com nome único e lista na árvore com o tipo certo', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70])
    expect(await service.importFile('Anexos', 'Relatório final.pdf', bytes)).toBe('Anexos/Relatório final.pdf')
    expect(await service.importFile('Anexos', 'Relatório final.pdf', bytes)).toBe('Anexos/Relatório final 1.pdf')
    await service.importFile('', 'foto.PNG', bytes)
    const tree = await service.tree()
    const anexos = tree.find((n) => n.name === 'Anexos')
    expect(anexos?.kind === 'folder' && anexos.children.map((c) => c.kind === 'file' && c.ext)).toEqual(['pdf', 'pdf'])
    expect(tree.find((n) => n.name === 'foto.PNG')).toMatchObject({ ext: 'image', title: 'foto.PNG' })
    expect([...(await service.readBinary('Anexos/Relatório final.pdf'))]).toEqual([37, 80, 68, 70])
  })

  it('recusa executáveis e scripts', async () => {
    await expect(service.importFile('', 'virus.exe', new Uint8Array([1]))).rejects.toThrow(/não permitido/)
    await expect(service.importFile('', 'script.ps1', new Uint8Array([1]))).rejects.toThrow(/não permitido/)
  })

  it('renomear mantém a extensão do anexo', async () => {
    await service.importFile('', 'praia.jpg', new Uint8Array([1]))
    expect(await service.rename('praia.jpg', 'Férias')).toBe('Férias.jpg')
  })
})

describe('rename', () => {
  it('renomeia mantendo a extensão .md', async () => {
    await service.createNote('Velho.md', 'texto')
    expect(await service.rename('Velho.md', 'Novo')).toBe('Novo.md')
    expect((await service.read('Novo.md')).content).toBe('texto')
  })

  it('nunca sobrescreve um arquivo existente', async () => {
    await service.createNote('A.md', 'a')
    await service.createNote('B.md', 'b')
    await expect(service.rename('A.md', 'B.md')).rejects.toThrow(/Já existe/)
    expect((await service.read('B.md')).content).toBe('b')
  })

  it('permite mudar só maiúsculas/minúsculas', async () => {
    await service.createNote('nota.md', 'x')
    expect(await service.rename('nota.md', 'Nota.md')).toBe('Nota.md')
    expect(names(await service.tree())).toEqual(['Nota.md'])
  })

  it('move pastas inteiras, mas não para dentro delas mesmas', async () => {
    await service.createNote('P/Filho.md')
    expect(await service.rename('P', 'Q')).toBe('Q')
    expect((await service.read('Q/Filho.md')).path).toBe('Q/Filho.md')
    await expect(service.rename('Q', 'Q/Dentro')).rejects.toThrow(/dentro dela mesma/)
  })
})

describe('trash', () => {
  it('delega para a lixeira com o caminho absoluto', async () => {
    await service.createNote('Lixo.md')
    await service.trash('Lixo.md')
    expect(trash).toHaveBeenCalledWith(path.join(await service.absolutePath(''), 'Lixo.md'))
  })

  it('não permite apagar a raiz do cofre', async () => {
    await expect(service.trash('')).rejects.toThrow()
    expect(trash).not.toHaveBeenCalled()
  })
})

describe('sem cofre aberto', () => {
  it('falha com mensagem clara', async () => {
    service.close()
    await expect(service.tree()).rejects.toThrow('Nenhum cofre aberto.')
  })
})
