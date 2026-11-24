#!/bin/sh
# Remove o Opalite instalado por instalar.sh. As notas NÃO são apagadas.
set -eu

data="${XDG_DATA_HOME:-$HOME/.local/share}"

pkill -x opalite 2>/dev/null && sleep 1 || true
rm -rf "$data/opalite"
rm -f "$data/applications/opalite.desktop"
[ "$(readlink "$HOME/.local/bin/opalite" 2>/dev/null)" = "$data/opalite/opalite" ] && rm -f "$HOME/.local/bin/opalite"
rm -f "$data"/icons/hicolor/*/apps/opalite.png

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$data/applications" || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t "$data/icons/hicolor" 2>/dev/null || true

echo "Opalite removido. As suas notas continuam nas pastas onde você as guardou."
echo "(As preferências do app ficam em ~/.config/Opalite; apague essa pasta se quiser.)"
