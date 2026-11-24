// Gera os ícones do app a partir de assets/brand/opalite-icon-source.jpg
// (a arte original, quadrada, sobre fundo preto):
//   assets/brand/opalite.ico           (Windows: barra de tarefas, atalhos; 16 a 256 px)
//   assets/brand/opalite-512.png       (janela no macOS/Linux)
//   assets/brand/opalite-256.png
//   assets/brand/linux/<N>x<N>.png     (tema de ícones "hicolor" do Linux; 16 a 512 px)
//   src/renderer/src/assets/opalite-mark.png  (só a pedra, fundo transparente:
//                                       logo da tela inicial e do menu lateral)
// Uso: npm run brand:icons   (roda dentro do Electron, sem bibliotecas nativas)
//
// A arte é recortada no centro (a pedra ocupa pouco da imagem original) e
// desenhada num quadrado de cantos arredondados com margem transparente,
// no mesmo formato do ícone anterior.
//
// Formato do .ico: tamanhos até 128 px em bitmap clássico (BMP 32 bits com
// transparência), que todas as partes do Windows leem; só o de 256 px em PNG,
// como a Microsoft recomenda. Ícones só-PNG às vezes aparecem em branco na
// área de trabalho.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const sourcePath = path.join(root, 'assets', 'brand', 'opalite-icon-source.jpg')
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
// Recorte da arte original (fração do lado, centralizado) e geometria do quadrado,
// em unidades de um ícone de 256 px: margem 8, cantos com raio 58.
const CROP = 0.8
const MARGIN = 8 / 256
const RADIUS = 58 / 256
// Marca (só a pedra): centro e lado do recorte na arte original, e tamanho final.
const MARK_CENTER = [0.503, 0.495]
const MARK_CROP = 0.66
const MARK_SIZE = 256

/** Imagem de ícone em formato BMP (DIB): cabeçalho + pixels BGRA de baixo para cima + máscara AND. */
function bmpEntry(size, rgba) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0) // tamanho do cabeçalho
  header.writeInt32LE(size, 4) // largura
  header.writeInt32LE(size * 2, 8) // altura (cor + máscara)
  header.writeUInt16LE(1, 12) // planos
  header.writeUInt16LE(32, 14) // bits por pixel
  header.writeUInt32LE(0, 16) // sem compressão
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = ((size - 1 - y) * size + x) * 4 // linhas de baixo para cima
      const dst = (y * size + x) * 4
      pixels[dst] = rgba[src + 2] // B
      pixels[dst + 1] = rgba[src + 1] // G
      pixels[dst + 2] = rgba[src] // R
      pixels[dst + 3] = rgba[src + 3] // A
    }
  }
  // Máscara AND (1 bit por pixel, linhas alinhadas a 32 bits); zerada: o canal alfa manda.
  const maskRow = Math.ceil(size / 32) * 4
  const mask = Buffer.alloc(maskRow * size)
  return Buffer.concat([header, pixels, mask])
}

function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // tipo: ícone
  header.writeUInt16LE(images.length, 4)
  const entries = []
  let offset = 6 + 16 * images.length
  for (const { size, data } of images) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0) // 0 significa 256
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt16LE(1, 4) // planos
    e.writeUInt16LE(32, 6) // bits por pixel
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
}

app.whenReady().then(async () => {
  const source = fs.readFileSync(sourcePath).toString('base64')
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  await win.loadURL('data:text/html,<html><body></body></html>')

  // Desenha a arte num canvas do tamanho pedido; devolve PNG e os pixels RGBA (base64).
  const render = (size) =>
    win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const size = ${size}
        const c = document.createElement('canvas')
        c.width = c.height = size
        const ctx = c.getContext('2d')
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        const m = Math.round(size * ${MARGIN})
        const side = size - 2 * m
        // Quadrado de cantos arredondados (com a margem transparente ao redor).
        ctx.beginPath()
        ctx.roundRect(m, m, side, side, side * ${RADIUS / (1 - 2 * MARGIN)})
        ctx.save()
        ctx.clip()
        // Reduz em etapas (metade por vez): evita serrilhado nos tamanhos pequenos.
        const crop = img.width * ${CROP}
        let src = document.createElement('canvas')
        src.width = src.height = crop
        src.getContext('2d').drawImage(img, (img.width - crop) / 2, (img.height - crop) / 2, crop, crop, 0, 0, crop, crop)
        while (src.width / 2 >= side) {
          const half = document.createElement('canvas')
          half.width = half.height = Math.round(src.width / 2)
          const hctx = half.getContext('2d')
          hctx.imageSmoothingQuality = 'high'
          hctx.drawImage(src, 0, 0, half.width, half.height)
          src = half
        }
        ctx.drawImage(src, m, m, side, side)
        ctx.restore()
        // Contorno sutil, para o ícone não sumir em painéis escuros.
        if (size >= 32) {
          ctx.lineWidth = Math.max(1, size / 256)
          ctx.strokeStyle = 'rgba(255,255,255,0.10)'
          ctx.stroke()
        }
        const raw = ctx.getImageData(0, 0, size, size).data
        let bin = ''
        for (let i = 0; i < raw.length; i += 8192) bin += String.fromCharCode.apply(null, raw.subarray(i, i + 8192))
        resolve({ png: c.toDataURL('image/png').split(',')[1], rgba: btoa(bin) })
      }
      img.onerror = () => reject(new Error('Imagem do ícone inválida'))
      img.src = 'data:image/jpeg;base64,${source}'
    })`)

  const images = []
  let png256
  for (const size of SIZES) {
    const { png, rgba } = await render(size)
    if (size >= 256) {
      png256 = Buffer.from(png, 'base64')
      images.push({ size, data: png256 })
    } else {
      images.push({ size, data: bmpEntry(size, Buffer.from(rgba, 'base64')) })
    }
  }
  const outDir = path.join(root, 'assets', 'brand')
  fs.writeFileSync(path.join(outDir, 'opalite.ico'), buildIco(images))
  fs.writeFileSync(path.join(outDir, 'opalite-512.png'), Buffer.from((await render(512)).png, 'base64'))
  fs.writeFileSync(path.join(outDir, 'opalite-256.png'), png256)
  const linuxDir = path.join(outDir, 'linux')
  fs.mkdirSync(linuxDir, { recursive: true })
  for (const size of LINUX_SIZES) fs.writeFileSync(path.join(linuxDir, `${size}x${size}.png`), Buffer.from((await render(size)).png, 'base64'))
  // Marca do app: a arte foi feita com luz sobre preto, então o preto vira
  // transparência (alfa = canal mais claro) e as cores são "despremultiplicadas".
  // Assim a pedra brilha igual sobre qualquer fundo de tema.
  const mark = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const out = ${MARK_SIZE}
      const c = document.createElement('canvas')
      c.width = c.height = out
      const ctx = c.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      const side = img.width * ${MARK_CROP}
      const sx = img.width * ${MARK_CENTER[0]} - side / 2
      const sy = img.height * ${MARK_CENTER[1]} - side / 2
      ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out)
      const data = ctx.getImageData(0, 0, out, out)
      const d = data.data
      for (let i = 0; i < d.length; i += 4) {
        const m = Math.max(d[i], d[i + 1], d[i + 2])
        const a = Math.max(0, Math.min(1, (m - 10) / 235))
        if (a === 0) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; continue }
        const k = 255 / Math.max(m, 1)
        d[i] = Math.min(255, d[i] * k)
        d[i + 1] = Math.min(255, d[i + 1] * k)
        d[i + 2] = Math.min(255, d[i + 2] * k)
        d[i + 3] = Math.round(a * 255)
      }
      ctx.putImageData(data, 0, 0)
      resolve(c.toDataURL('image/png').split(',')[1])
    }
    img.onerror = () => reject(new Error('Imagem do ícone inválida'))
    img.src = 'data:image/jpeg;base64,${source}'
  })`)
  const markDir = path.join(root, 'src', 'renderer', 'src', 'assets')
  fs.mkdirSync(markDir, { recursive: true })
  fs.writeFileSync(path.join(markDir, 'opalite-mark.png'), Buffer.from(mark, 'base64'))
  console.log(`Ícones gerados em ${outDir} (Windows: ${SIZES.join(', ')} px; Linux: ${LINUX_SIZES.join(', ')} px)`)
  app.exit(0)
})
