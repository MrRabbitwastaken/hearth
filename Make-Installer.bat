@echo off
setlocal
title Making the Hearth installer
cd /d "%~dp0"

echo.
echo   ==============================================
echo     Hearth - making your installer
echo   ==============================================
echo.
echo   This builds Hearth-Setup.exe. The first run takes a few minutes
echo   and needs an internet connection. Later runs are quicker.
echo.

set "TOOLS=%~dp0.tools"
set "NODEDIR=%TOOLS%\node"

rem ---- 1. Node.js: use the one on this PC, or fetch a private copy just for building
where node >nul 2>nul
if not errorlevel 1 goto :have_node
if exist "%NODEDIR%\node.exe" goto :use_private
echo   [1/3] Fetching a private copy of Node.js, used only to build Hearth...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol='Tls12';" ^
  "try { $v=(Invoke-RestMethod 'https://nodejs.org/dist/index.json' | Where-Object { $_.lts } | Select-Object -First 1).version } catch { $v='v22.11.0' };" ^
  "$zip=Join-Path $env:TEMP ('node-'+$v+'-win-x64.zip');" ^
  "Write-Host ('         downloading Node.js '+$v+'...');" ^
  "Invoke-WebRequest ('https://nodejs.org/dist/'+$v+'/node-'+$v+'-win-x64.zip') -OutFile $zip -UseBasicParsing;" ^
  "New-Item -ItemType Directory -Force $env:TOOLS | Out-Null;" ^
  "Expand-Archive $zip -DestinationPath $env:TOOLS -Force;" ^
  "if (Test-Path $env:NODEDIR) { Remove-Item $env:NODEDIR -Recurse -Force };" ^
  "Get-ChildItem $env:TOOLS -Directory | Where-Object { $_.Name -like 'node-v*' } | Select-Object -First 1 | Rename-Item -NewName 'node';" ^
  "Remove-Item $zip -ErrorAction SilentlyContinue"
if errorlevel 1 goto :fail
:use_private
set "PATH=%NODEDIR%;%PATH%"
:have_node
for /f "delims=" %%v in ('node -v') do echo   Using Node.js %%v
echo.

rem ---- 2. Dependencies
echo   [2/3] Gathering Hearth's building blocks...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 goto :fail
echo.

rem ---- 3. Build the setup wizard
echo   [3/3] Building the setup wizard...
call npm run dist
if errorlevel 1 goto :fail

echo.
echo   ==============================================
echo     Done! Your installer is ready:
for %%f in ("%~dp0dist\Hearth-Setup-*.exe") do echo       dist\%%~nxf
echo   ==============================================
echo.
echo   Double-click it to install Hearth. Share the same file with anyone else.
echo   For silent installs (e.g. NinjaOne):  Hearth-Setup-x.y.z.exe /S
echo   (add /allusers to install for every user on the PC)
echo.
start "" "%~dp0dist"
pause
exit /b 0

:fail
echo.
echo   Something went wrong. Scroll up to see the error, then try running this again.
echo   If it keeps failing, copy the error and send it to me.
pause
exit /b 1
