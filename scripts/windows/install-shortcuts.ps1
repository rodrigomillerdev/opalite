# Cria (ou recria) os atalhos do Opalite na Área de trabalho e no Menu Iniciar.
# Uso: npm run desktop:shortcuts   (gera o build antes)
#
# - O atalho abre o build do projeto (out/) com o Electron do próprio projeto.
# - O ícone é copiado com o hash no nome para o cache de ícones do Windows
#   sempre pegar a versão nova.
# - Os atalhos antigos são APAGADOS e recriados (atualizar no lugar pode deixar
#   a área de trabalho mostrando uma folha em branco).
# - A identidade do app (AppUserModelID) é gravada no atalho, igual à da janela,
#   para "Fixar na barra de tarefas" agrupar e reabrir corretamente.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$appId = 'Opalite.Notes'
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path (Join-Path $root 'out\main\index.js'))) { throw 'Build não encontrado. Rode "npm run build" antes.' }
if (-not (Test-Path $electron)) { throw 'Electron não encontrado. Rode "npm install" antes.' }

$source = Join-Path $root 'assets\brand\opalite.ico'
$iconDir = Join-Path $env:LOCALAPPDATA 'Opalite'
New-Item -ItemType Directory -Force $iconDir | Out-Null
$hash = (Get-FileHash $source -Algorithm SHA256).Hash.Substring(0, 8).ToLower()
$icon = Join-Path $iconDir "opalite-$hash.ico"
if (-not (Test-Path $icon)) {
  Get-ChildItem $iconDir -Filter '*.ico' -ErrorAction SilentlyContinue | Remove-Item -Force
  Copy-Item $source $icon
}

# Grava o AppUserModelID no atalho (propriedade System.AppUserModel.ID).
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class OpaliteLink {
  [StructLayout(LayoutKind.Sequential, Pack = 4)] public struct PROPERTYKEY { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit)] public struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    void GetCount(out uint c); void GetAt(uint i, out PROPERTYKEY k); void GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
    void SetValue(ref PROPERTYKEY k, ref PROPVARIANT v); void Commit();
  }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHGetPropertyStoreFromParsingName(string path, IntPtr bc, int flags, ref Guid riid, out IPropertyStore store);
  public static void SetAppId(string lnk, string id) {
    Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
    IPropertyStore store;
    SHGetPropertyStoreFromParsingName(lnk, IntPtr.Zero, 2 /* GPS_READWRITE */, ref iid, out store);
    PROPERTYKEY key = new PROPERTYKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
    PROPVARIANT v = new PROPVARIANT { vt = 31 /* VT_LPWSTR */, p = Marshal.StringToCoTaskMemUni(id) };
    try { store.SetValue(ref key, ref v); store.Commit(); } finally { Marshal.FreeCoTaskMem(v.p); Marshal.ReleaseComObject(store); }
  }
  [DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, uint f, IntPtr a, IntPtr b);
}
"@

$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Opalite.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Opalite.lnk')
)
$shell = New-Object -ComObject WScript.Shell
foreach ($lnk in $targets) {
  if (Test-Path $lnk) { Remove-Item $lnk -Force }
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = $electron
  $s.Arguments = "`"$root`""
  $s.WorkingDirectory = $root
  $s.IconLocation = "$icon,0"
  $s.Description = 'Opalite: notas em Markdown com conexões'
  $s.Save()
  try { [OpaliteLink]::SetAppId($lnk, $appId) } catch { Write-Output "aviso: AppUserModelID não gravado em $lnk ($($_.Exception.Message))" }
  Write-Output "Atalho: $lnk"
}

# Atualiza o cache de ícones e avisa o Explorador da mudança.
& "$env:SystemRoot\System32\ie4uinit.exe" -show
[OpaliteLink]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Output "Ícone: $icon"
