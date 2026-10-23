@echo off
chcp 65001 >nul
title UON Connect - Modo desenvolvimento
cd /d "%~dp0"

echo.
echo  ================================================
echo   UON Connect - Modo desenvolvimento
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

echo  Abrindo o aplicativo...
echo  Feche esta janela para encerrar.
echo.
call npm run dev
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
