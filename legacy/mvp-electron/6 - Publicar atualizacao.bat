@echo off
chcp 65001 >nul
title UON Connect - Publicar atualizacao
cd /d "%~dp0"

echo.
echo  ================================================
echo   UON Connect - Publicar atualizacao
echo  ================================================
echo.
echo  Gera o instalador e copia para a pasta que o
echo  servidor publica em /updates. Os aplicativos ja
echo  instalados se atualizam sozinhos a partir dai.
echo.
echo  ANTES DE CONTINUAR: aumente a versao no
echo  package.json (campo "version"). O aplicativo so
echo  atualiza se o numero for MAIOR que o instalado.
echo.

for /f "tokens=2 delims=:, " %%a in ('findstr /r /c:"\"version\"" package.json') do (
    set VERSAO=%%~a
    goto :achou
)
:achou
echo  Versao atual no package.json: %VERSAO%
echo.
choice /c SN /m "Continuar"
if errorlevel 2 goto fim

echo.
if not exist "node_modules" (
    echo  Instalando dependencias...
    call npm install
    if errorlevel 1 goto erro
)

echo  Compilando e empacotando. Pode levar alguns minutos...
echo.
call npm run publicar
if errorlevel 1 goto erro

echo.
echo  ------------------------------------------------
echo   Publicado. Reinicie o servidor se ele nao
echo   estiver rodando e os clientes irao detectar.
echo  ------------------------------------------------
echo.
explorer "%~dp0server\updates"
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
