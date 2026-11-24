#!/bin/sh
# Instala o Opalite só para o usuário atual, sem administrador:
#   app      -> ~/.local/share/opalite
#   comando  -> ~/.local/bin/opalite
#   lançador -> ~/.local/share/applications/opalite.desktop
#   ícones   -> ~/.local/share/icons/hicolor/<N>x<N>/apps/opalite.png
set -eu

here=$(cd "$(dirname "$0")" && pwd)
src="$here/Opalite"
data="${XDG_DATA_HOME:-$HOME/.local/share}"
dest="$data/opalite"
bin="$HOME/.local/bin"

if [ ! -x "$src/opalite" ]; then
  echo "Não encontrei $src/opalite. Extraia o arquivo .tar.gz inteiro antes de instalar." >&2
  exit 1
fi

# Fecha uma instância aberta para poder substituir os arquivos.
pkill -x opalite 2>/dev/null && sleep 1 || true

echo "Copiando o Opalite para $dest ..."
rm -rf "$dest.novo"
cp -a "$src" "$dest.novo"
rm -rf "$dest"
mv "$dest.novo" "$dest"

mkdir -p "$bin"
ln -sf "$dest/opalite" "$bin/opalite"

for f in "$dest"/resources/app/assets/brand/linux/*x*.png; do
  size=$(basename "$f" .png)
  mkdir -p "$data/icons/hicolor/$size/apps"
  cp "$f" "$data/icons/hicolor/$size/apps/opalite.png"
done

mkdir -p "$data/applications"
sed "s|@EXEC@|\"$dest/opalite\"|" "$here/opalite.desktop" > "$data/applications/opalite.desktop"
chmod 644 "$data/applications/opalite.desktop"

# Avisa o sistema (quando as ferramentas existem) para o ícone aparecer já.
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$data/applications" || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t "$data/icons/hicolor" 2>/dev/null || true

echo
echo "Pronto! O Opalite está no menu de aplicativos."
echo "Também dá para abrir pelo terminal com: opalite"

# Sem "user namespaces" o Chromium não consegue criar a sua área isolada
# (sandbox) e o app não abre. Nesse caso, o pacote .deb resolve.
if command -v unshare >/dev/null 2>&1 && ! unshare -Ur true 2>/dev/null; then
  echo
  echo "ATENÇÃO: este sistema bloqueia a área isolada (sandbox) do Chromium para"
  echo "programas instalados sem administrador, e o Opalite pode não abrir."
  echo "Se isso acontecer, use o pacote .deb (Ubuntu, Debian, Pop!_OS, Mint...)."
fi
