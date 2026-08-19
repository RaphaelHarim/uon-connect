@echo off
chcp 65001 >nul
title UON Connect - Gerar versao portatil
cd /d "%~dp0"

echo.
echo  ================================================
echo   UON Connect - Versao portatil (sem instalar)
echo  ================================================
echo.
echo  Gera um unico .exe que roda direto de um pendrive,
echo  sem instalacao e sem privilegios de administrador.
echo.

if not exist "node_modules" (
    echo  Primeira execucao: instalando dependencias.
    echo  Isso demora alguns minutos. Aguarde...
    echo.
    call npm install
    if errorlevel 1 goto erro
    echo.
)

echo  Compilando e empacotando. Pode levar alguns minutos...
echo.
call npm run dist:portable
if errorlevel 1 goto erro

echo.
echo  ------------------------------------------------
echo   Pronto! O arquivo esta na pasta "release".
echo  ------------------------------------------------
echo.
explorer "%~dp0release"
pause
goto fim

:erro
echo.
echo  ------------------------------------------------
echo   Algo deu errado. Copie a mensagem acima.
echo  ------------------------------------------------
echo.
pause

:fim
