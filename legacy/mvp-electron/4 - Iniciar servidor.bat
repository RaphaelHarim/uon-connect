@echo off
chcp 65001 >nul
title UON Connect - Servidor
cd /d "%~dp0"

echo.
echo  ================================================
echo   UON Connect - Servidor (API + tempo real)
echo  ================================================
echo.

if not exist "node_modules" (
    echo  Primeira execucao: instalando dependencias.
    echo  Isso demora alguns minutos. Aguarde...
    echo.
    call npm install
    if errorlevel 1 goto erro
    echo.
)

call npm run server
if errorlevel 1 goto erro
goto fim

:erro
echo.
echo  ------------------------------------------------
echo   Algo deu errado. Copie a mensagem acima.
echo  ------------------------------------------------
echo.
pause

:fim
