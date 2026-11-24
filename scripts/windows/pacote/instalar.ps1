param(
  [string]$Destino = (Join-Path $env:LOCALAPPDATA 'Programs\Opalite'),
  [string]$PastaAtalhos = '',
  [switch]$Desinstalar
)
# Instalador do Opalite (por usuário, não precisa de administrador).
# - Copia o app para %LOCALAPPDATA%\Programs\Opalite
# - Cria atalhos na Área de trabalho e no Menu Iniciar
# - Desinstalar remove o app e os atalhos; as notas (cofres) nunca são apagadas.
$ErrorActionPreference = 'Stop'
$origem = Join-Path $PSScriptRoot 'Opalite'
$appId = 'Opalite.Notes'

if ($PastaAtalhos) {
  $atalhos = @((Join-Path $PastaAtalhos 'Opalite.lnk'))
} else {
  $atalhos = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Opalite.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'Opalite.lnk')
  )
}

if ($Desinstalar) {
  Get-Process Opalite -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$Destino*" } | Stop-Process -Force
  foreach ($a in $atalhos) { if (Test-Path $a) { Remove-Item $a -Force; Write-Output "Atalho removido: $a" } }
  if (Test-Path $Destino) { Remove-Item $Destino -Recurse -Force; Write-Output "App removido: $Destino" }
  Write-Output 'Opalite desinstalado. Suas notas continuam nas pastas onde você as guardou.'
  return
}

if (-not (Test-Path (Join-Path $origem 'Opalite.exe'))) { throw 'Pasta "Opalite" não encontrada ao lado deste instalador. Extraia o .zip inteiro antes de instalar.' }

# Fecha uma versão anterior aberta, para poder substituir os arquivos.
Get-Process Opalite -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$Destino*" } | Stop-Process -Force
if (Test-Path $Destino) { Remove-Item $Destino -Recurse -Force }
New-Item -ItemType Directory -Force (Split-Path $Destino) | Out-Null
Write-Output 'Copiando o Opalite...'
Copy-Item $origem $Destino -Recurse

$exe = Join-Path $Destino 'Opalite.exe'
$icone = Join-Path $Destino 'resources\app\assets\brand\opalite.ico'

# Grava o AppUserModelID no atalho, igual ao da janela (agrupa certo na barra de tarefas).
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
    SHGetPropertyStoreFromParsingName(lnk, IntPtr.Zero, 2, ref iid, out store);
    PROPERTYKEY key = new PROPERTYKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
    PROPVARIANT v = new PROPVARIANT { vt = 31, p = Marshal.StringToCoTaskMemUni(id) };
    try { store.SetValue(ref key, ref v); store.Commit(); } finally { Marshal.FreeCoTaskMem(v.p); Marshal.ReleaseComObject(store); }
  }
  [DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, uint f, IntPtr a, IntPtr b);
}
"@

$shell = New-Object -ComObject WScript.Shell
foreach ($lnk in $atalhos) {
  New-Item -ItemType Directory -Force (Split-Path $lnk) | Out-Null
  if (Test-Path $lnk) { Remove-Item $lnk -Force }
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = $exe
  $s.WorkingDirectory = $Destino
  $s.IconLocation = "$icone,0"
  $s.Description = 'Opalite: notas, documentos e ideias em um só lugar'
  $s.Save()
  try { [OpaliteLink]::SetAppId($lnk, $appId) } catch { }
  Write-Output "Atalho criado: $lnk"
}
[OpaliteLink]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
Write-Output ''
Write-Output "Pronto! O Opalite foi instalado em $Destino"
