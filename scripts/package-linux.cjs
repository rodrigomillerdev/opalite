// Gera a versão para Linux em dist/, sem ferramentas extras além das do sistema:
//   dist/opalite-<versão>-linux-<arch>/          pasta pronta (app + instalador por usuário)
//   dist/opalite-<versão>-linux-<arch>.tar.gz    a mesma pasta compactada
//   dist/opalite_<versão>_<arch>.deb             pacote para Debian/Ubuntu/Pop!_OS/Mint (se houver dpkg-deb)
// Uso: npm run package:linux   (roda o build antes; precisa ser executado no Linux)
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

if (process.platform !== 'linux') throw new Error('Gere o pacote para Linux a partir de um Linux (o Electron baixado é o do sistema atual).')

const root = path.join(__dirname, '..')
const pkg = require(path.join(root, 'package.json'))
const arch = { x64: 'x64', arm64: 'arm64' }[process.arch]
const debArch = { x64: 'amd64', arm64: 'arm64' }[process.arch]
if (!arch) throw new Error(`Arquitetura não suportada: ${process.arch}`)

const dist = path.join(root, 'dist')
const name = `opalite-${pkg.version}-linux-${arch}`
const out = path.join(dist, name)
const app = path.join(out, 'Opalite')
const electronDist = path.join(root, 'node_modules', 'electron', 'dist')
const brand = path.join(root, 'assets', 'brand')

if (!fs.existsSync(path.join(root, 'out', 'main', 'index.js'))) throw new Error('Build não encontrado. Rode "npm run build" antes.')
if (!fs.existsSync(path.join(electronDist, 'electron'))) throw new Error('Electron para Linux não encontrado em node_modules. Rode "npm install" no Linux.')
if (!fs.existsSync(path.join(brand, 'linux'))) throw new Error('Ícones do Linux não encontrados. Rode "npm run brand:icons".')
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(app, { recursive: true })

// 1. Runtime do Electron, renomeado para "opalite"; só os idiomas pt-BR e en-US.
fs.cpSync(electronDist, app, { recursive: true, verbatimSymlinks: true })
fs.renameSync(path.join(app, 'electron'), path.join(app, 'opalite'))
fs.rmSync(path.join(app, 'resources', 'default_app.asar'), { force: true })
for (const f of fs.readdirSync(path.join(app, 'locales'))) if (!['pt-BR.pak', 'en-US.pak'].includes(f)) fs.rmSync(path.join(app, 'locales', f))

// 2. O app: build + ícones + licença. O processo principal já embute as bibliotecas.
//    O .ico (Windows) e a arte original não são usados no Linux.
const res = path.join(app, 'resources', 'app')
fs.mkdirSync(res, { recursive: true })
fs.cpSync(path.join(root, 'out'), path.join(res, 'out'), { recursive: true })
fs.cpSync(path.join(root, 'assets'), path.join(res, 'assets'), {
  recursive: true,
  filter: (src) => !/\.ico$|opalite-icon-source\./.test(src),
})
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(res, 'LICENSE'))
fs.writeFileSync(
  path.join(res, 'package.json'),
  JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, main: 'out/main/index.js', license: pkg.license }, null, 2),
)

// 3. Instalador por usuário, desinstalador, lançador e LEIA-ME.
const pacote = path.join(__dirname, 'linux', 'pacote')
const fill = (text) =>
  text
    .replaceAll('@VERSION@', pkg.version)
    .replaceAll('@DEBARCH@', debArch)
    .replaceAll('@UNDERLINE@', '='.repeat(`OPALITE ${pkg.version} para Linux`.length))
for (const f of fs.readdirSync(pacote)) {
  fs.writeFileSync(path.join(out, f), fill(fs.readFileSync(path.join(pacote, f), 'utf8')))
  fs.chmodSync(path.join(out, f), f.endsWith('.sh') ? 0o755 : 0o644)
}
const desktop = fs.readFileSync(path.join(__dirname, 'linux', 'opalite.desktop'), 'utf8')
fs.writeFileSync(path.join(out, 'opalite.desktop'), desktop)
// Permissões previsíveis (755/644), independentes do umask e de como o código foi extraído:
// nada gravável por outros usuários.
normalizeModes(out)

// 4. .tar.gz (preserva as permissões de execução, ao contrário do .zip).
const tarball = path.join(dist, `${name}.tar.gz`)
fs.rmSync(tarball, { force: true })
execFileSync('tar', ['-czf', tarball, '-C', dist, '--owner=0', '--group=0', name], { stdio: 'inherit' })
console.log(`Pronto: ${tarball}`)

// 5. .deb: app em /opt/opalite, comando /usr/bin/opalite, lançador e ícones do sistema.
if (!hasCommand('dpkg-deb')) {
  console.log('dpkg-deb não encontrado: pacote .deb não gerado.')
} else {
  const stage = path.join(dist, `deb-${name}`)
  fs.rmSync(stage, { recursive: true, force: true })
  const opt = path.join(stage, 'opt', 'opalite')
  fs.mkdirSync(path.dirname(opt), { recursive: true })
  fs.cpSync(app, opt, { recursive: true, verbatimSymlinks: true })

  fs.mkdirSync(path.join(stage, 'usr', 'bin'), { recursive: true })
  fs.symlinkSync('/opt/opalite/opalite', path.join(stage, 'usr', 'bin', 'opalite'))

  const apps = path.join(stage, 'usr', 'share', 'applications')
  fs.mkdirSync(apps, { recursive: true })
  fs.writeFileSync(path.join(apps, 'opalite.desktop'), desktop.replace('@EXEC@', '/opt/opalite/opalite'))

  for (const f of fs.readdirSync(path.join(brand, 'linux'))) {
    const dir = path.join(stage, 'usr', 'share', 'icons', 'hicolor', path.basename(f, '.png'), 'apps')
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(path.join(brand, 'linux', f), path.join(dir, 'opalite.png'))
  }

  const doc = path.join(stage, 'usr', 'share', 'doc', 'opalite')
  fs.mkdirSync(doc, { recursive: true })
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(doc, 'copyright'))

  normalizeModes(stage)
  const debian = path.join(stage, 'DEBIAN')
  fs.mkdirSync(debian, { recursive: true })
  const sizeKb = Math.ceil(dirSize(stage) / 1024)
  fs.writeFileSync(
    path.join(debian, 'control'),
    [
      'Package: opalite',
      `Version: ${pkg.version}`,
      'Section: editors',
      'Priority: optional',
      `Architecture: ${debArch}`,
      `Installed-Size: ${sizeKb}`,
      'Depends: libgtk-3-0t64 | libgtk-3-0, libnss3, libnotify4, libxss1, libxtst6, xdg-utils, libatspi2.0-0t64 | libatspi2.0-0, libuuid1, libsecret-1-0, libgbm1, libasound2t64 | libasound2',
      'Maintainer: Opalite',
      `Description: ${pkg.description}`,
      ' Editor de notas em Markdown com documentos, planilhas e apresentações.',
      ' As notas são arquivos comuns, guardados numa pasta escolhida por você.',
      '',
    ].join('\n'),
  )
  // A área isolada (sandbox) do Chromium precisa do auxiliar com setuid root
  // quando o sistema não permite "user namespaces" sem privilégios.
  writeScript(
    path.join(debian, 'postinst'),
    `#!/bin/sh
set -e
if [ "$1" = "configure" ]; then
  chown root:root /opt/opalite/chrome-sandbox
  chmod 4755 /opt/opalite/chrome-sandbox
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
  command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true
fi
exit 0
`,
  )
  writeScript(
    path.join(debian, 'postrm'),
    `#!/bin/sh
set -e
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true
exit 0
`,
  )

  const deb = path.join(dist, `opalite_${pkg.version}_${debArch}.deb`)
  fs.rmSync(deb, { force: true })
  execFileSync('dpkg-deb', ['--root-owner-group', '-Zxz', '--build', stage, deb], { stdio: 'inherit' })
  fs.rmSync(stage, { recursive: true, force: true })
  console.log(`Pronto: ${deb}`)
}

function hasCommand(cmd) {
  try {
    execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function normalizeModes(dir) {
  fs.chmodSync(dir, 0o755)
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) normalizeModes(p)
    else if (entry.isFile()) fs.chmodSync(p, fs.statSync(p).mode & 0o111 ? 0o755 : 0o644)
  }
}

function writeScript(file, text) {
  fs.writeFileSync(file, text)
  fs.chmodSync(file, 0o755)
}

function dirSize(dir) {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) total += dirSize(p)
    else if (entry.isFile()) total += fs.statSync(p).size
  }
  return total
}
