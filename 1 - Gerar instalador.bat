@echo off
chcp 65001 >nul
title UON Connect - Gerar instalador
cd /d "%~dp0"

echo.
echo  ================================================
echo   UON Connect - Gerar instalador do Windows
echo  ================================================
echo.
echo  Gera a versao CONECTADA (fala com o servidor).
echo  O endereco do servidor e informado dentro do
echo  aplicativo, na tela de login - por isso o mesmo
echo  instalador serve para todas as maquinas.
echo.

if not exist "node_modules" (
    echo  Primeira execucao: instalando dependencias.
    echo  Isso demora alguns minutos. Aguarde...
    echo.
    call npm install
    if errorlevel 1 goto erro
    echo.
)

if not exist "build\icon.png" (
    echo  [AVISO] O arquivo build\icon.png nao existe.
    echo          O executavel saira com o icone padrao do Electron.
    echo          Veja as instrucoes em build\LEIA-ME.md
    echo.
)

echo  Compilando e empacotando. Pode levar alguns minutos...
echo.
call npm run dist:servidor
if errorlevel 1 goto erro

echo.
echo  ------------------------------------------------
echo   Pronto! O instalador esta na pasta "release".
echo.
echo   PROXIMO PASSO: rode "6 - Publicar atualizacao.bat"
echo   para colocar o instalador no ar. Ele imprime o
echo   link que voce manda para a equipe:
echo       http://SEU-SERVIDOR:4000/baixar
echo.
echo   Sem publicar, o arquivo fica so na sua maquina.
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
