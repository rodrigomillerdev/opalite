import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VaultHistory } from './history'

let root = ''
let history: VaultHistory

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'opalite-history-'))
  history = new VaultHistory(() => root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('VaultHistory', () => {
  it('guarda e lê versões, mais recentes primeiro', async () => {
    const a = await history.snapshot('Docs/Relatório.docx', new Uint8Array([1, 2, 3]), 'antes de salvar')
    await new Promise((r) => setTimeout(r, 5))
    const b = await history.snapshot('Docs/Relatório.docx', new Uint8Array([4, 5]), 'antes de salvar')
    const list = await history.list('Docs/Relatório.docx')
    expect(list.map((v) => v.id)).toEqual([b.id, a.id])
    expect([...(await history.read('Docs/Relatório.docx', a.id))]).toEqual([1, 2, 3])
    expect(await history.lastTime('Docs/Relatório.docx')).toBe(b.time)
  })

  it('mantém no máximo 30 versões', async () => {
    for (let i = 0; i < 33; i++) await history.snapshot('n.md', `v${i}`, 'edição')
    const list = await history.list('n.md')
    expect(list).toHaveLength(30)
    expect(Buffer.from(await history.read('n.md', list[0]!.id)).toString()).toBe('v32')
  })

  it('acompanha o arquivo quando ele é renomeado', async () => {
    const v = await history.snapshot('a.md', 'texto', 'edição')
    await history.move('a.md', 'Pasta/b.md')
    expect(await history.list('a.md')).toEqual([])
    expect(Buffer.from(await history.read('Pasta/b.md', v.id)).toString()).toBe('texto')
  })

  it('rejeita ids e chaves inválidos', async () => {
    await expect(history.read('a.md', '../x')).rejects.toThrow()
    await expect(history.setState('../fora', 1)).rejects.toThrow()
  })

  it('guarda estado do cofre', async () => {
    expect(await history.getState('favorites')).toBeNull()
    await history.setState('favorites', ['a.md'])
    expect(await history.getState('favorites')).toEqual(['a.md'])
  })
})
