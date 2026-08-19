@echo off
chcp 65001 >nul
title UON Connect - Liberar porta no firewall

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo  Esta acao precisa de privilegios de administrador.
    echo  Solicitando elevacao...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo.
echo  ================================================
echo   UON Connect - Liberar porta 4000 no firewall
echo  ================================================
echo.
echo  Execute isto SOMENTE na maquina que roda o SERVIDOR.
echo  Sem isso, outras estacoes da rede nao conseguem
echo  se conectar.
echo.

netsh advfirewall firewall show rule name="UON Connect (TCP 4000)" >nul 2>&1
if %errorLevel% equ 0 (
    echo  A regra ja existe. Nada a fazer.
    echo.
    goto endereco
)

netsh advfirewall firewall add rule name="UON Connect (TCP 4000)" dir=in action=allow protocol=TCP localport=4000 profile=domain,private
if errorlevel 1 (
    echo.
    echo  Falha ao criar a regra.
    echo.
    pause
    exit /b
)

echo.
echo  Regra criada: entrada TCP 4000 liberada nos perfis
echo  de dominio e rede privada.
echo.

:endereco
echo  ------------------------------------------------
echo   Enderecos desta maquina na rede:
echo  ------------------------------------------------
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=* delims= " %%b in ("%%a") do echo     http://%%b:4000
)
echo  ------------------------------------------------
echo.
echo  Na OUTRA maquina, abra o UON Connect e clique em
echo  "Alterar" ao lado do endereco do servidor,
echo  na tela de login. Informe um dos enderecos acima.
echo.
pause
