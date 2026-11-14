# ExoVision keep-alive: держит backend + ngrok живыми несколько часов,
# перезапускает упавшего, не даёт компьютеру уснуть, пишет ссылку в models\ngrok_url.txt.
# Запуск вручную:  powershell -ExecutionPolicy Bypass -File keepalive.ps1 [часы]
param([double]$Hours = 6)

$backendDir = 'C:\Users\sozda\Desktop\TIC-id-main\backend'
$urlFile = Join-Path $backendDir 'models\ngrok_url.txt'
$logFile = Join-Path $backendDir 'models\keepalive.log'
$ngrokLog = Join-Path $backendDir 'models\ngrok_agent.log'
$env:PYTHONUTF8 = '1'; $env:PYTHONIOENCODING = 'utf-8'

$ngrok = 'C:\Users\sozda\AppData\Local\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe'
if (-not (Test-Path $ngrok)) { $c = Get-Command ngrok -ErrorAction SilentlyContinue; if ($c) { $ngrok = $c.Source } }

function Log($m) { "$((Get-Date).ToString('HH:mm:ss')) $m" | Out-File $logFile -Append -Encoding utf8 }

# быстрая проверка TCP-порта (не виснет, в отличие от Invoke-WebRequest в фоне)
function Test-Port([int]$port) {
  $t = New-Object System.Net.Sockets.TcpClient
  try { $ar = $t.BeginConnect('127.0.0.1', $port, $null, $null)
        if ($ar.AsyncWaitHandle.WaitOne(2000)) { $t.EndConnect($ar); return $true } else { return $false } }
  catch { return $false } finally { $t.Close() }
}

# не давать системе/экрану засыпать
try {
  Add-Type -Name P -Namespace W -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint e);' -ErrorAction Stop
  [W.P]::SetThreadExecutionState([uint32]2147483651) | Out-Null
} catch {}

$deadline = (Get-Date).AddHours($Hours)
Log "=== старт, работаю до $($deadline.ToString('HH:mm')) ==="

while ((Get-Date) -lt $deadline) {
  [W.P]::SetThreadExecutionState([uint32]2147483651) | Out-Null   # подтверждаем запрет сна

  if (-not (Test-Port 8001)) {
    Log "backend не слушает — поднимаю uvicorn"
    Start-Process -WindowStyle Hidden python -ArgumentList '-m','uvicorn','server:app','--port','8001' -WorkingDirectory $backendDir
    Start-Sleep 12
  }

  $url = $null
  if (Test-Port 4040) {
    try {
      $t = Invoke-RestMethod 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 6
      $url = ($t.tunnels | Where-Object { $_.public_url -like 'https*' } | Select-Object -First 1).public_url
    } catch {}
  }

  if (-not $url) {
    Log "ngrok оффлайн — перезапуск"
    Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep 3
    Start-Process -WindowStyle Hidden $ngrok -ArgumentList 'http','8001','--log',$ngrokLog,'--log-format','logfmt'
    Start-Sleep 9
    try {
      $t = Invoke-RestMethod 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 6
      $url = ($t.tunnels | Where-Object { $_.public_url -like 'https*' } | Select-Object -First 1).public_url
    } catch {}
    if ($url) { Log "ngrok онлайн: $url" }
  }

  if ($url) { Set-Content -Path $urlFile -Value $url -Encoding utf8 }
  Start-Sleep 20
}

Log "=== завершено ==="
try { [W.P]::SetThreadExecutionState([uint32]2147483648) | Out-Null } catch {}
