@echo off
chcp 65001 >nul
title UON Connect - Teste com 2 usuarios
cd /d "%~dp0"

echo.
echo  ================================================
echo   UON Connect - Teste com 2 usuarios
echo  ================================================
echo.
echo  Este script abre 3 janelas:
echo    1) Servidor (API + tempo real)
echo    2) Aplicativo - usuario 1
echo    3) Aplicativo - usuario 2
echo.
echo  Logins (senha: uon@2026)
echo    Janela 1: raphael.arrifano@uongroup.com
echo    Janela 2: teste1@uongroup.com
echo.
echo  Para encerrar tudo, feche as 3 janelas.
echo.

if not exist "node_modules" (
    echo  Instalando dependencias do aplicativo...
    echo.
    call npm install
    if errorlevel 1 goto erro
    echo.
)

if not exist "server\node_modules" (
    echo  Instalando dependencias do servidor...
    echo.
    call npm --prefix server install
    if errorlevel 1 goto erro
    echo.
)

echo  [1/3] Subindo o servidor...
start "UON Connect - SERVIDOR" cmd /k "cd /d "%~dp0" && npm --prefix server start"

echo  Aguardando o servidor responder...
timeout /t 5 /nobreak >nul

echo  [2/3] Abrindo o aplicativo - usuario 1...
start "UON Connect - USUARIO 1" cmd /k "cd /d "%~dp0" && npm run dev:servidor"

echo  Aguardando a interface compilar...
timeout /t 14 /nobreak >nul

echo  [3/3] Abrindo o aplicativo - usuario 2...
start "UON Connect - USUARIO 2" cmd /k "cd /d "%~dp0" && npm run dev:janela2"

echo.
echo  ------------------------------------------------
echo   Pronto. As janelas estao abrindo.
echo.
echo   Entre com usuarios DIFERENTES em cada janela e
echo   procure um pelo outro na aba Contatos.
echo  ------------------------------------------------
echo.
timeout /t 6 /nobreak >nul
goto fim

:erro
echo.
echo  ------------------------------------------------
echo   Algo deu errado. Copie a mensagem acima.
echo  ------------------------------------------------
echo.
pause

:fim
