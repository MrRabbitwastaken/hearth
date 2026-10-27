@echo off
rem Runs Hearth straight from the source folder (handy for trying changes without reinstalling).
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%~dp0.tools\node\node.exe" (
    set "PATH=%~dp0.tools\node;%PATH%"
  ) else (
    echo Run Make-Installer.bat once first - it fetches what Hearth needs.
    pause
    exit /b 1
  )
)
if not exist node_modules call npm install --no-audit --no-fund
call npm start
