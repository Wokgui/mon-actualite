@echo off
setlocal
title Mon actualite - LOCAL 91.45
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est necessaire pour lancer cette version locale.
  echo Installe Node.js 22 LTS puis relance ce fichier.
  pause
  exit /b 1
)
echo.
echo Demarrage de Mon actualite LOCAL 91.45...
echo Aucun deploiement Vercel ne sera effectue.
echo.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:4173"
node local-preview-v91.45.mjs
pause
