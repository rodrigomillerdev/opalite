import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { FormulaError, evaluate, toFileFormula } from './formula'
import { Calc, formatValue, key, newWorkbook, parseInput, shiftFormula } from './workbook'
import { readCsv, readXlsx, writeCsv, writeXlsx } from './xlsx'
import { parseXml, textOf } from './xml'

function sheetWith(values: Record<string, string>) {
  const wb = newWorkbook()
  const sheet = wb.sheets[0]!
  for (const [a, text] of Object.entries(values)) {
    const m = /^([A-Z]+)(\d+)$/.exec(a)!
    const col = m[1]!.charCodeAt(0) - 65
    const row = Number(m[2]) - 1
    const p = parseInput(text)
    sheet.cells.set(key(col, row), { v: p.v, ...(p.f ? { f: p.f } : {}) })
  }
  const calc = new Calc(wb)
  return { wb, at: (a: string) => {
    const m = /^([A-Z]+)(\d+)$/.exec(a)!
    return calc.value(0, m[1]!.charCodeAt(0) - 65, Number(m[2]) - 1)
  } }
}

describe('fórmulas', () => {
  it('aritmética, precedência e porcentagem', () => {
    const ctx = { value: () => null }
    expect(evaluate('1+2*3', ctx)).toBe(7)
    expect(evaluate('(1+2)*3', ctx)).toBe(9)
    expect(evaluate('2^3^1', ctx)).toBe(8)
    expect(evaluate('50%*10', ctx)).toBe(5)
    expect(evaluate('-2+5', ctx)).toBe(3)
    expect(evaluate('"a"&"b"&1', ctx)).toBe('ab1')
    expect((evaluate('1/0', ctx) as FormulaError).code).toBe('#DIV/0!')
  })

  it('funções em português com ";" e vírgula decimal', () => {
    const { at } = sheetWith({ A1: '10', A2: '20', A3: '30', B1: '=SOMA(A1:A3)', B2: '=MÉDIA(A1:A3)', B3: '=SE(A1>5;"alto";"baixo")', B4: '=ARRED(10/3;2)', B5: '=SOMA(1,5;2)' })
    expect(at('B1')).toBe(60)
    expect(at('B2')).toBe(20)
    expect(at('B3')).toBe('alto')
    expect(at('B4')).toBe(3.33)
    expect(at('B5')).toBe(3.5)
  })

  it('funções em inglês com ","', () => {
    const { at } = sheetWith({ A1: '1', A2: '2', A3: 'x', B1: '=SUM(A1,A2)', B2: '=COUNT(A1:A3)', B3: '=COUNTA(A1:A3)', B4: '=MAX(A1:A3)' })
    expect(at('B1')).toBe(3)
    expect(at('B2')).toBe(2)
    expect(at('B3')).toBe(3)
    expect(at('B4')).toBe(2)
  })

  it('SOMASE, CONT.SE e PROCV', () => {
    const { at } = sheetWith({
      A1: 'maçã', B1: '3',
      A2: 'pera', B2: '5',
      A3: 'maçã', B3: '7',
      C1: '=SOMASE(A1:A3;"maçã";B1:B3)',
      C2: '=CONT.SE(B1:B3;">4")',
      C3: '=PROCV("pera";A1:B3;2;FALSO)',
      C4: '=PROCV("uva";A1:B3;2;FALSO)',
    })
    expect(at('C1')).toBe(10)
    expect(at('C2')).toBe(2)
    expect(at('C3')).toBe(5)
    expect((at('C4') as FormulaError).code).toBe('#N/A')
  })

  it('detecta referência circular', () => {
    const { at } = sheetWith({ A1: '=B1+1', B1: '=A1+1' })
    expect((at('A1') as FormulaError).code).toBe('#CICLO!')
  })

  it('nome de função desconhecido vira #NAME?', () => {
    const { at } = sheetWith({ A1: '=NAOEXISTE(1)' })
    expect((at('A1') as FormulaError).code).toBe('#NAME?')
  })

  it('grava em inglês com ","', () => {
    expect(toFileFormula('SOMA(A1;A2)+SE(B1>0;"a;b";0)')).toBe('SUM(A1,A2)+IF(B1>0,"a;b",0)')
  })

  it('desloca referências relativas ao copiar', () => {
    expect(shiftFormula('A1+$B$2+C$3*$D4', 1, 2)).toBe('B3+$B$2+D$3*$D6')
    expect(shiftFormula('SUM(A1:A3)', 0, 1)).toBe('SUM(A2:A4)')
    expect(shiftFormula('A1', -1, 0)).toBe('#REF!')
  })
})

describe('entrada e formatação pt-BR', () => {
  it('interpreta números, moeda, porcentagem e datas', () => {
    expect(parseInput('1.234,5').v).toBe(1234.5)
    expect(parseInput('12,5').v).toBe(12.5)
    expect(parseInput('R$ 10,00')).toMatchObject({ v: 10, fmt: 'currency' })
    expect(parseInput('15%')).toMatchObject({ v: 0.15, fmt: 'percent' })
    expect(parseInput('01/01/2026')).toMatchObject({ fmt: 'date' })
    expect(parseInput('texto').v).toBe('texto')
  })

  it('formata valores', () => {
    expect(formatValue(1234.5, 'currency')).toBe('R$ 1.234,50')
    expect(formatValue(0.155, 'percent')).toBe('15,50%')
    expect(formatValue(46023, 'date')).toBe('01/01/2026')
    expect(formatValue(2.5)).toBe('2,5')
  })
})

describe('xlsx', () => {
  it('ida e volta mantém valores, fórmulas, estilos e abas', () => {
    const wb = newWorkbook()
    const s = wb.sheets[0]!
    s.name = 'Vendas & Custos'
    s.cells.set(key(0, 0), { v: 'Produto', s: { b: true, fill: '#ffeeaa' } })
    s.cells.set(key(1, 0), { v: 'Preço', s: { b: true, align: 'right' } })
    s.cells.set(key(0, 1), { v: 'Café <forte>' })
    s.cells.set(key(1, 1), { v: 12.5, s: { fmt: 'currency' } })
    s.cells.set(key(1, 2), { v: null, f: 'SOMA(B2;B2)' })
    s.cols[0] = 180
    wb.sheets.push({ name: 'Notas', cells: new Map([[key(0, 0), { v: true }]]), cols: {}, rows: { 0: 40 } })

    const bytes = writeXlsx(wb)
    const files = unzipSync(bytes)
    expect(strFromU8(files['xl/worksheets/sheet1.xml']!)).toContain('<f>SUM(B2,B2)</f><v>25</v>')

    const back = readXlsx(bytes)
    expect(back.sheets.map((x) => x.name)).toEqual(['Vendas & Custos', 'Notas'])
    const b = back.sheets[0]!
    expect(b.cells.get(key(0, 0))).toMatchObject({ v: 'Produto', s: { b: true, fill: '#ffeeaa' } })
    expect(b.cells.get(key(1, 0))?.s?.align).toBe('right')
    expect(b.cells.get(key(0, 1))?.v).toBe('Café <forte>')
    expect(b.cells.get(key(1, 1))).toMatchObject({ v: 12.5, s: { fmt: 'currency' } })
    expect(b.cells.get(key(1, 2))?.f).toBe('SUM(B2,B2)')
    expect(Math.abs(b.cols[0]! - 180)).toBeLessThanOrEqual(1)
    expect(back.sheets[1]!.cells.get(key(0, 0))?.v).toBe(true)
    expect(back.sheets[1]!.rows[0]).toBe(40)
  })

  it('rejeita arquivo que não é xlsx', () => {
    expect(() => readXlsx(new Uint8Array([1, 2, 3]))).toThrow()
  })
})

describe('csv', () => {
  it('lê ";" com vírgula decimal e aspas', () => {
    const wb = readCsv('Nome;Valor\n"Silva; J.";12,5\n')
    const s = wb.sheets[0]!
    expect(s.cells.get(key(0, 1))?.v).toBe('Silva; J.')
    expect(s.cells.get(key(1, 1))?.v).toBe(12.5)
    expect(writeCsv(s, wb)).toBe('Nome;Valor\r\n"Silva; J.";12,5\r\n')
  })
})

describe('xml', () => {
  it('entidades, CDATA e atributos com ">"', () => {
    const doc = parseXml('<?xml version="1.0"?><a x="1 &gt; 0"><t>A &amp; B</t><t><![CDATA[<c>]]></t></a>')
    const a = doc.children[0]!
    expect(a.attrs['x']).toBe('1 > 0')
    expect(textOf(a)).toBe('A & B<c>')
  })
})

describe('pptx', () => {
  it('ida e volta mantém slides, textos, formas, imagens e fundo', async () => {
    const { writePptx, readPptx } = await import('./pptx')
    const { newPresentation, contentSlide } = await import('./presentation')
    const p = newPresentation()
    p.slides[0]!.background = '#102030'
    const s = contentSlide('Resultados & metas')
    s.elements.push({ id: 'x', type: 'shape', shape: 'ellipse', x: 600, y: 300, w: 120, h: 80, fill: '#ff8800', paras: [{ runs: [{ text: 'OK', b: true, size: 14 }] }] })
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
    s.elements.push({ id: 'i', type: 'image', x: 10, y: 20, w: 100, h: 50, data: png, mime: 'image/png' })
    p.slides.push(s)

    const back = readPptx(writePptx(p))
    expect(back.slides).toHaveLength(2)
    expect(back.slides[0]!.background).toBe('#102030')
    const title = back.slides[0]!.elements[0]!
    expect(title.type).toBe('text')
    if (title.type === 'text') {
      expect(title.paras[0]!.align).toBe('center')
      expect(title.paras[0]!.runs[0]).toMatchObject({ text: 'Título da apresentação', b: true, size: 40 })
      expect(Math.round(title.x)).toBe(80)
    }
    const els = back.slides[1]!.elements
    const body = els[1]!
    if (body.type === 'text') expect(body.paras.map((x) => x.bullet)).toEqual([true, true])
    const shape = els.find((e) => e.type === 'shape')!
    expect(shape).toMatchObject({ shape: 'ellipse', fill: '#ff8800' })
    const img = els.find((e) => e.type === 'image')!
    if (img.type === 'image') expect([...img.data]).toEqual([...png])
    expect(back.slides[1]!.elements[0]!.type === 'text' && back.slides[1]!.elements[0]!.paras[0]!.runs[0]!.text).toBe('Resultados & metas')
  })
  it('ida e volta mantém fonte, tachado, espaçamentos, numeração, borda, cantos, opacidade e rotação', async () => {
    const { writePptx, readPptx } = await import('./pptx')
    const { newPresentation, layoutSlide } = await import('./presentation')
    const p = newPresentation()
    const s = layoutSlide('twoColumns', '#14161c')
    s.elements.push({
      id: 't',
      type: 'text',
      x: 100,
      y: 100,
      w: 300,
      h: 120,
      valign: 'middle',
      stroke: '#ff0000',
      strokeWidth: 2,
      radius: 12,
      opacity: 0.5,
      rot: 30,
      fill: '#eeeeee',
      paras: [
        { numbered: true, lineHeight: 1.5, runs: [{ text: 'Um', font: 'Georgia', s: true, spacing: 2, size: 20 }] },
        { numbered: true, runs: [{ text: 'Dois', size: 20 }] },
      ],
    })
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
    s.elements.push({ id: 'i', type: 'image', x: 500, y: 300, w: 200, h: 100, radius: 20, opacity: 0.75, stroke: '#00ff00', strokeWidth: 3, data: png, mime: 'image/png' })
    s.elements.push({ id: 'r', type: 'shape', shape: 'rect', x: 10, y: 10, w: 100, h: 50, radius: 10, fill: '#123456', paras: [{ runs: [{ text: '' }] }] })
    p.slides.push(s)

    const back = readPptx(writePptx(p)).slides[1]!
    expect(back.background).toBe('#14161c')
    const t = back.elements.find((e) => e.type === 'text' && e.paras[0]?.runs[0]?.text === 'Um')!
    expect(t).toMatchObject({ valign: 'middle', stroke: '#ff0000', strokeWidth: 2, opacity: 0.5, rot: 30, fill: '#eeeeee' })
    expect(Math.round(t.radius!)).toBe(12)
    if (t.type === 'text') {
      expect(t.paras.map((x) => x.numbered)).toEqual([true, true])
      expect(t.paras[0]!.lineHeight).toBe(1.5)
      expect(t.paras[0]!.runs[0]).toMatchObject({ font: 'Georgia', s: true, spacing: 2 })
    }
    const img = back.elements.find((e) => e.type === 'image')!
    expect(img).toMatchObject({ opacity: 0.75, stroke: '#00ff00', strokeWidth: 3 })
    expect(Math.round(img.radius!)).toBe(20)
    const rect = back.elements.find((e) => e.type === 'shape')!
    expect(Math.round(rect.radius!)).toBe(10)
    // Duas colunas: título e dois blocos de marcadores, com texto claro no fundo escuro.
    const cols = back.elements.filter((e) => e.type === 'text' && e.paras[0]?.bullet)
    expect(cols).toHaveLength(2)
    if (cols[0]!.type === 'text') expect(cols[0]!.paras[0]!.runs[0]!.color).toBe('#f2f1ee')
  })
})
