// Gera a versão para Windows em dist/Opalite <versão>/ (e o .zip ao lado),
// sem ferramentas nativas extras: usa o próprio Electron do projeto.
// Uso: npm run package:win   (roda o build antes)
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const root = path.join(__dirname, '..')
const pkg = require(path.join(root, 'package.json'))
const out = path.join(root, 'dist', `Opalite ${pkg.version}`)
const app = path.join(out, 'Opalite')
const electronDist = path.join(root, 'node_modules', 'electron', 'dist')

if (!fs.existsSync(path.join(root, 'out', 'main', 'index.js'))) throw new Error('Build não encontrado. Rode "npm run build" antes.')
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(app, { recursive: true })

// 1. Runtime do Electron, renomeado para Opalite.exe; só os idiomas pt-BR e en-US.
fs.cpSync(electronDist, app, { recursive: true })
fs.renameSync(path.join(app, 'electron.exe'), path.join(app, 'Opalite.exe'))
fs.rmSync(path.join(app, 'resources', 'default_app.asar'), { force: true })
for (const f of fs.readdirSync(path.join(app, 'locales'))) if (!['pt-BR.pak', 'en-US.pak'].includes(f)) fs.rmSync(path.join(app, 'locales', f))

// 2. O app: build + ícones + licença. O processo principal já embute as bibliotecas.
const res = path.join(app, 'resources', 'app')
fs.mkdirSync(res, { recursive: true })
fs.cpSync(path.join(root, 'out'), path.join(res, 'out'), { recursive: true })
fs.cpSync(path.join(root, 'assets'), path.join(res, 'assets'), { recursive: true })
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(res, 'LICENSE'))
fs.writeFileSync(
  path.join(res, 'package.json'),
  JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, main: 'out/main/index.js', license: pkg.license }, null, 2),
)

// 3. Instalador por usuário, desinstalador e LEIA-ME.
for (const f of fs.readdirSync(path.join(__dirname, 'windows', 'pacote'))) fs.copyFileSync(path.join(__dirname, 'windows', 'pacote', f), path.join(out, f))

// 4. .zip (via PowerShell, já presente no Windows).
const zip = `${out} - Windows.zip`
fs.rmSync(zip, { force: true })
execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${out}' -DestinationPath '${zip}' -CompressionLevel Optimal`], { stdio: 'inherit' })
console.log(`Pronto: ${zip}`)
