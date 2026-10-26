$ErrorActionPreference = 'Stop'
$mysqlRoot = 'D:\ankang-mysql'
$mysqlExe = Join-Path $mysqlRoot 'mysql-8.4.11-winx64\bin\mysqld.exe'
$mysqlConfig = Join-Path $mysqlRoot 'my.ini'
if (-not (Test-Path -LiteralPath $mysqlExe) -or -not (Test-Path -LiteralPath $mysqlConfig)) {
    throw 'Local MySQL files are missing. Check D:\ankang-mysql.'
}
$running = $false
try {
    $client = [Net.Sockets.TcpClient]::new()
    $connect = $client.BeginConnect('127.0.0.1', 3306, $null, $null)
    $running = $connect.AsyncWaitHandle.WaitOne(700) -and $client.Connected
    $client.Close()
} catch {}
if (-not $running) {
    Start-Process -FilePath $mysqlExe -ArgumentList ('--defaults-file=' + $mysqlConfig) -WorkingDirectory $mysqlRoot -WindowStyle Hidden | Out-Null
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            $client = [Net.Sockets.TcpClient]::new()
            $connect = $client.BeginConnect('127.0.0.1', 3306, $null, $null)
            $running = $connect.AsyncWaitHandle.WaitOne(700) -and $client.Connected
            $client.Close()
            if ($running) { break }
        } catch {}
    }
    if (-not $running) { throw 'MySQL failed to start. Check D:\ankang-mysql\mysql-error.log.' }
}
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
foreach ($name in @('HEALTH_AI_API_KEY', 'HEALTH_AI_MODEL', 'HEALTH_AI_BASE_URL')) {
    if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
        $value = [Environment]::GetEnvironmentVariable($name, 'User')
        if ($value) { [Environment]::SetEnvironmentVariable($name, $value, 'Process') }
    }
}
& node server.js
