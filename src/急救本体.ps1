# 急救本体 v0.1（只看不动手）
# 2026-11-03 立。名字避开「心跳」——机器上已经有一个 心跳.ps1，再来三个同名会出事。
#
# 这一版只做一件事：证明「这套判据不撒谎」。
# 不发杀指令、不拉起、不改任何配置。判定写进 state.json 和 事件.jsonl，看护照旧负责杀和拉。
#
# 判据（每 10 秒一轮）：
#   进程数 0                -> GONE
#   起来不到 180 秒          -> STARTING（插件加载、profile recovery 都在这段，不判死）
#   有窗口 + 探针能读控件树   -> ALIVE
#   探针超时 + CPU 零增量 + 不响应 -> SUSPECT（可疑僵死，这一版只记账）
#   其余（看不见、正在忙、托盘）-> UNKNOWN
#
# 还写 body.beat.json：给以后插件回心跳用（seq / nonce / instance_id 都在里面）。

$根 = 'C:\Users\28565\.dsh\heartline'
$状态文件 = Join-Path $根 'state.json'
$心跳文件 = Join-Path $根 'body.beat.json'
$事件文件 = Join-Path $根 '事件.jsonl'
$自检文件 = Join-Path $根 'selfcheck.json'
$锁文件 = Join-Path $根 '本体.lock'
$看护状态 = 'D:\rensheng\00-基地\心跳\看护\状态.json'
$DSH = 'D:\红\DeepSeek Harness.exe'
$宽限秒 = 180
$轮间隔 = 10

if (-not (Test-Path $根)) { New-Item -ItemType Directory -Force -Path $根 | Out-Null }

# 单实例
try {
    $锁 = [IO.File]::Open($锁文件, 'OpenOrCreate', 'ReadWrite', 'None')
    $锁.SetLength(0)
    $b = [Text.Encoding]::UTF8.GetBytes([string]$PID)
    $锁.Write($b, 0, $b.Length); $锁.Flush()
} catch {
    exit 0
}

function 记([string]$话) {
    $行 = '{"t":"' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '","m":"' + ($话 -replace '"', "'") + '"}'
    try { [IO.File]::AppendAllText($事件文件, $行 + "`n", (New-Object System.Text.UTF8Encoding($false))) } catch { }
}

function 写JSON([string]$路径, $对象) {
    $文本 = $对象 | ConvertTo-Json -Depth 6 -Compress
    $临时 = $路径 + '.tmp'
    try {
        [IO.File]::WriteAllText($临时, $文本, (New-Object System.Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $临时 -Destination $路径 -Force
    } catch {
        # 读方持锁时 rename 会撞车：重试三次，丢一拍不致命（判死窗口是 90 秒）
        Start-Sleep -Milliseconds 120
        try { [IO.File]::WriteAllText($路径, $文本, (New-Object System.Text.UTF8Encoding($false))) } catch { }
    }
}

$实例ID = [guid]::NewGuid().ToString('N').Substring(0, 8)
$开机ID = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('O')
$序号 = 0
$上一判定 = ''
$上回CPU = -1
$上回报警 = [datetime]::MinValue

function 取根 {
    $带窗 = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue |
              Where-Object { $_.MainWindowHandle -ne 0 })
    if ($带窗.Count -gt 0) { return @{ Proc = $带窗[0]; 有窗 = $true } }
    $全部 = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)
    if ($全部.Count -eq 0) { return @{ Proc = $null; 有窗 = $false } }
    return @{ Proc = $全部[0]; 有窗 = $false }
}

function 探针([int]$进程号, [int]$超时毫秒) {
    $脚 = {
        param($target)
        Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop
        $根元素 = [Windows.Automation.AutomationElement]::RootElement
        $子 = $根元素.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition)
        $窗 = $null
        for ($i = 0; $i -lt $子.Count; $i++) {
            if ($子.Item($i).Current.ProcessId -eq $target) { $窗 = $子.Item($i); break }
        }
        if (-not $窗) { return 'no-window' }
        $全 = $窗.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
        if ($全.Count -ge 20) { return ('ok:' + $全.Count) }
        return ('few:' + $全.Count)
    }
    $壳 = [powershell]::Create()
    [void]$壳.AddScript($脚).AddArgument($进程号)
    $表 = [Diagnostics.Stopwatch]::StartNew()
    $句柄 = $壳.BeginInvoke()
    if ($句柄.AsyncWaitHandle.WaitOne($超时毫秒)) {
        $出 = ''
        try { $出 = (@($壳.EndInvoke($句柄)) -join '') } catch { $出 = 'error' }
        try { $壳.Dispose() } catch { }
        return @{ 类 = $(if ($出 -like 'ok:*') { 'ok' } else { 'unknown' }); 说明 = $出; 毫秒 = $表.ElapsedMilliseconds }
    }
    return @{ 类 = 'timeout'; 说明 = '探针没回'; 毫秒 = $表.ElapsedMilliseconds }
}

记 ('本体启动 instance=' + $实例ID + ' 轮间隔=' + $轮间隔 + '秒')

while ($true) {
    $序号++
    $现在 = Get-Date
    $r = 取根
    $判定 = 'UNKNOWN'
    $说明 = ''
    $CPU增量 = 0

    if (-not $r.Proc) {
        $判定 = 'GONE'; $说明 = '进程一个都没有'
    } else {
        $p = $r.Proc
        $年龄 = 9999
        try { $年龄 = [int]($现在 - $p.StartTime).TotalSeconds } catch { }
        $当前CPU = 0
        try { $当前CPU = $p.TotalProcessorTime.TotalMilliseconds } catch { }
        if ($上回CPU -ge 0) { $CPU增量 = [int]($当前CPU - $上回CPU) }
        $上回CPU = $当前CPU

        if ($年龄 -lt $宽限秒) {
            $判定 = 'STARTING'; $说明 = ('起来 ' + $年龄 + ' 秒')
        } elseif (-not $r.有窗) {
            $判定 = 'UNKNOWN'; $说明 = '没有主窗口（托盘或最小化），不算死'
        } else {
            $探 = 探针 ([int]$p.Id) 5000
            if ($探.类 -eq 'ok') { $判定 = 'ALIVE'; $说明 = ('控件 ' + $探.说明) }
            elseif ($探.类 -eq 'unknown') { $判定 = 'UNKNOWN'; $说明 = ('看不清 ' + $探.说明) }
            elseif ($CPU增量 -le 0 -and -not $p.Responding) { $判定 = 'SUSPECT'; $说明 = '探针超时且 CPU 零增量且不响应' }
            else { $判定 = 'UNKNOWN'; $说明 = '探针超时但还有动静（可能在忙）' }
        }
    }

    $看护说 = ''
    try { if (Test-Path $看护状态) { $看护说 = [string]((Get-Content $看护状态 -Raw -Encoding UTF8 | ConvertFrom-Json).最近判定) } } catch { }

    写JSON $状态文件 ([pscustomobject]@{
        ts = $现在.ToString('yyyy-MM-dd HH:mm:ss'); instance = $实例ID; verdict = $判定; why = $说明
        pid = $(if ($r.Proc) { [int]$r.Proc.Id } else { 0 }); cpu_delta_ms = $CPU增量; watchdog = $看护说
    })

    $新nonce = -join ((1..16) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
    写JSON $心跳文件 ([pscustomobject]@{
        schema = 'dsh-heartline/1'; who = 'body'; boot_id = $开机ID; instance_id = $实例ID
        pid = $PID; seq = $序号; at = $现在.ToString('O'); mono_ms = [int]([Diagnostics.Stopwatch]::GetTimestamp() / 10000)
        state = $判定; nonce = $新nonce
    })

    if ($判定 -ne $上一判定) {
        记 ('判定 ' + $上一判定 + ' -> ' + $判定 + '：' + $说明 + '（看护说：' + $看护说 + '）')
        $上一判定 = $判定
    }

    if (($现在 - $上回报警).TotalMinutes -ge 10) {
        写JSON $自检文件 ([pscustomobject]@{
            checked_at = $现在.ToString('yyyy-MM-dd HH:mm:ss'); verdict = $判定
            heartline_exists = (Test-Path $根); watchdog = $看护说; seq = $序号
        })
        $上回报警 = $现在
    }

    Start-Sleep -Seconds $轮间隔
}