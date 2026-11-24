@echo off
chcp 65001 >nul
echo Instalando o Opalite...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1"
if errorlevel 1 (echo. & echo Algo deu errado. Veja a mensagem acima.) else (start "" "%LOCALAPPDATA%\Programs\Opalite\Opalite.exe")
echo.
pause
