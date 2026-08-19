@echo off
chcp 65001 >nul
title UON Connect - Atualizar dependencias
cd /d "%~dp0"

echo.
echo  ================================================
echo   UON Connect - Atualizar dependencias
echo  ================================================
echo.
echo  Rode este script UMA VEZ depois de receber uma
echo  versao nova do codigo.
echo.
echo  Os outros scripts so instalam dependencias na
echo  primeira execucao (quando node_modules ainda nao
echo  existe). Se o projeto passou a usar uma biblioteca
echo  nova, e este script que a instala.
echo.

REM O banco usa node:sqlite, embutido no Node a partir da versao 22.
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 22 (
    echo.
    echo  ------------------------------------------------
    echo   VERSAO DO NODE INCOMPATIVEL
    echo.
    node -v
    echo   Necessario: Node 22 ou superior.
    echo.
    echo   O armazenamento passou de arquivo JSON para
    echo   SQLite, que vem embutido no Node 22+.
    echo   Baixe a versao LTS em https://nodejs.org
    echo  ------------------------------------------------
    echo.
    pause
    goto fim
)

echo  [1/3] Dependencias do aplicativo...
echo.
call npm install
if errorlevel 1 goto erro

echo.
echo  [2/3] Dependencias do servidor...
echo.
call npm --prefix server install
if errorlevel 1 goto erro

echo.
echo  [3/3] Conferindo se o codigo compila...
echo.
call npm run typecheck
if errorlevel 1 goto erro

REM Cria o arquivo de configuracao do servidor, se ainda nao existir.
REM E nele que ficam as credenciais de e-mail dos Chamados de TI.
if not exist "server\.env" (
    if exist "server\.env.example" (
        copy "server\.env.example" "server\.env" >nul
        echo.
        echo  Criado o arquivo server\.env a partir do exemplo.
        echo  Preencha SMTP_* e IMAP_* nele para ligar o e-mail
        echo  dos Chamados de TI. Sem isso o modulo funciona
        echo  inteiro, apenas sem enviar nem ler e-mails.
    )
)

echo.
echo  ------------------------------------------------
echo   Tudo atualizado.
echo.
echo   Para testar agora:
echo     "Modo Dev.bat" ............ demonstracao, sem servidor
echo     "5 - Testar com 2 usuarios.bat" .. com servidor
echo.
echo   Para distribuir para a equipe:
echo     1. aumente "version" no package.json
echo     2. rode "6 - Publicar atualizacao.bat"
echo  ------------------------------------------------
echo.
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
