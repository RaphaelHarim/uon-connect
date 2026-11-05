<#
.SYNOPSIS
  Prepara um computador com Windows 11 para hospedar o UON CONNECT (WSL2 + Ubuntu + Docker).

.DESCRIPTION
  Execute no PowerShell como Administrador, no próprio servidor:
      Set-ExecutionPolicy -Scope Process Bypass
      .\preparar-servidor.ps1                       # acesso de fora pelo túnel Cloudflare (recomendado)
      .\preparar-servidor.ps1 -AbrirPortasRedeLocal  # também atender a rede local direto (portas 80/443)

  O que faz (pode rodar de novo sem problema):
    1. Instala o WSL2 e o Ubuntu 24.04 (pode pedir reinício e a criação de um usuário do Ubuntu).
    2. Liga a rede "mirrored" do WSL, para o Ubuntu usar a mesma rede do Windows.
    3. Instala o Docker Engine dentro do Ubuntu (gratuito; não usa o Docker Desktop).
    4. Impede o computador de suspender ou hibernar.
    5. Cria uma tarefa que mantém o Ubuntu ligado depois que o Windows inicia a sessão.
    6. (Opcional) Libera as portas 80 e 443 no firewall para a rede local.

  O que NÃO faz: não baixa o código do UON CONNECT, não instala o aplicativo e não mexe no roteador.
  Depois dele, siga docs/SERVIDOR-WINDOWS.md (passo "Instalar o UON CONNECT").
#>
[CmdletBinding()]
param(
  [string]$Distro = 'Ubuntu-24.04',
  [switch]$AbrirPortasRedeLocal
)

$ErrorActionPreference = 'Stop'
function Passo($texto) { Write-Host "`n==> $texto" -ForegroundColor Cyan }
function Aviso($texto) { Write-Host "    $texto" -ForegroundColor Yellow }

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Abra o PowerShell como Administrador (botão direito › Executar como administrador) e rode de novo.'
}

$build = [Environment]::OSVersion.Version.Build
if ($build -lt 22621) {
  throw "Este script precisa do Windows 11 22H2 ou mais novo (build 22621+). Este computador está no build $build."
}

# ---------------------------------------------------------------- 1. WSL e Ubuntu
Passo 'Verificando o WSL'
$wslOk = $true
try { wsl.exe --status *> $null; if ($LASTEXITCODE -ne 0) { $wslOk = $false } } catch { $wslOk = $false }
if (-not $wslOk) {
  Passo 'Instalando o WSL (o Windows vai pedir para reiniciar)'
  wsl.exe --install --no-distribution
  Aviso 'Reinicie o computador e rode este script de novo.'
  exit 0
}
wsl.exe --update | Out-Null

$distros = (wsl.exe --list --quiet) -replace "`0", '' | Where-Object { $_ -match '\S' } | ForEach-Object { $_.Trim() }
if ($distros -notcontains $Distro) {
  Passo "Instalando o $Distro"
  Aviso 'Vai abrir uma janela do Ubuntu pedindo um nome de usuário e uma senha: crie e anote.'
  Aviso 'Quando aparecer o prompt do Ubuntu, digite "exit" e volte para cá.'
  wsl.exe --install -d $Distro
  $distros = (wsl.exe --list --quiet) -replace "`0", '' | Where-Object { $_ -match '\S' } | ForEach-Object { $_.Trim() }
  if ($distros -notcontains $Distro) { throw "O $Distro não foi instalado. Rode o script de novo depois de criar o usuário do Ubuntu." }
}

# ---------------------------------------------------------------- 2. Rede e recursos do WSL
Passo 'Configurando o WSL (rede mirrored)'
$wslConfig = Join-Path $env:USERPROFILE '.wslconfig'
$conteudo = @"
# Gerado por preparar-servidor.ps1 (UON CONNECT)
[wsl2]
networkingMode=mirrored
"@
if (Test-Path $wslConfig) { Copy-Item $wslConfig "$wslConfig.bak" -Force; Aviso "Cópia do arquivo anterior em $wslConfig.bak" }
Set-Content -Path $wslConfig -Value $conteudo -Encoding ASCII

# systemd ligado no Ubuntu (necessário para o Docker iniciar sozinho)
wsl.exe -d $Distro -u root -- bash -c "grep -q '^systemd=true' /etc/wsl.conf 2>/dev/null || printf '[boot]\nsystemd=true\n' >> /etc/wsl.conf"
wsl.exe --shutdown
Start-Sleep -Seconds 3

# ---------------------------------------------------------------- 3. Docker Engine no Ubuntu
Passo 'Instalando o Docker no Ubuntu (alguns minutos)'
wsl.exe -d $Distro -u root -- bash -c "command -v docker >/dev/null || (curl -fsSL https://get.docker.com | sh)"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar o Docker no Ubuntu. Verifique a internet e rode de novo.' }
wsl.exe -d $Distro -u root -- bash -c "systemctl enable --now docker && docker version --format 'Docker {{.Server.Version}} pronto'"
$usuarioUbuntu = (wsl.exe -d $Distro -- whoami).Trim()
if ($usuarioUbuntu -and $usuarioUbuntu -ne 'root') {
  wsl.exe -d $Distro -u root -- usermod -aG docker $usuarioUbuntu
}

# ---------------------------------------------------------------- 4. Energia
Passo 'Impedindo suspensão e hibernação (o servidor precisa ficar ligado)'
powercfg.exe /change standby-timeout-ac 0
powercfg.exe /change hibernate-timeout-ac 0
powercfg.exe /hibernate off

# ---------------------------------------------------------------- 5. Manter o Ubuntu ligado
Passo 'Criando a tarefa "UON CONNECT - manter servidor"'
$acao = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless wsl.exe -d $Distro --exec sleep infinity"
$gatilho = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$config = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'UON CONNECT - manter servidor' -Action $acao -Trigger $gatilho -Settings $config -Description 'Mantém o Ubuntu (WSL) e os contêineres do UON CONNECT ligados.' -Force | Out-Null
Start-ScheduledTask -TaskName 'UON CONNECT - manter servidor'

# ---------------------------------------------------------------- 6. Firewall (opcional)
if ($AbrirPortasRedeLocal) {
  Passo 'Liberando as portas 80 e 443 para a rede local (perfil Privado)'
  if (-not (Get-NetFirewallRule -DisplayName 'UON CONNECT (HTTP/HTTPS)' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'UON CONNECT (HTTP/HTTPS)' -Direction Inbound -Protocol TCP -LocalPort 80, 443 -Action Allow -Profile Private | Out-Null
  }
  if (Get-Command New-NetFirewallHyperVRule -ErrorAction SilentlyContinue) {
    # WSL usa o "firewall do Hyper-V" no modo mirrored; este é o identificador do WSL.
    if (-not (Get-NetFirewallHyperVRule -Name 'UON-CONNECT-WSL' -ErrorAction SilentlyContinue)) {
      New-NetFirewallHyperVRule -Name 'UON-CONNECT-WSL' -DisplayName 'UON CONNECT (WSL HTTP/HTTPS)' -Direction Inbound -VMCreatorId '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -Protocol TCP -LocalPorts 80, 443 | Out-Null
    }
  }
  $perfil = (Get-NetConnectionProfile | Select-Object -First 1).NetworkCategory
  if ($perfil -ne 'Private') { Aviso "A rede atual está como '$perfil'. Em Configurações › Rede, marque-a como Privada para a regra valer." }
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1).IPAddress
Write-Host "`nPronto. Endereço deste computador na rede: $ip" -ForegroundColor Green
Write-Host 'No UniFi, reserve este IP para este computador (IP fixo).'
Write-Host "Próximo passo: abra o Ubuntu (menu Iniciar › $Distro) e siga docs/SERVIDOR-WINDOWS.md, passo 'Instalar o UON CONNECT'."
