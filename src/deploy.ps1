# 部署脚本（必须由管理员通道执行：C:\Users\28565\.dsh\admin\do.ps1 里调它）
#
# 为什么提权的东西不能直接从用户可写目录跑：
# 提权任务执行一个普通用户能改的脚本 = 任何以这个用户身份跑的程序都能写一行进去拿到管理员。
# 所以代码放两处：仓库（可写，D:\项目\dsh-heartline）+ 部署位（只管理员可写，C:\ProgramData\DSH-Heartline）。
#
# 用法：deploy.ps1 -Tag v0.1.0
# 流程：检出 tag -> 校验文件哈希 -> 顶替 current（旧的进 previous）-> 重启任务
#       -> 90 秒内看心跳版本与新鲜度 -> 不合格自动回滚到 previous

param(
    [Parameter(Mandatory = $true)][string]$Tag,
    [string]$RepoPath = 'D:\项目\dsh-heartline',
    [string]$DestRoot = 'C:\ProgramData\DSH-Heartline',
    [string]$Heartline = 'C:\Users\28565\.dsh\heartline',
    [string]$TaskName = 'DSH-急救本体'
)

$ErrorActionPreference = 'Continue'
$日志 = Join-Path $DestRoot 'deploy.log'
$当前 = Join-Path $DestRoot 'current'
$上一版 = Join-Path $DestRoot 'previous'

function 记([string]$话) {
    $行 = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $话
    Write-Output $行
    try { Add-Content -LiteralPath $日志 -Value $行 -Encoding UTF8 } catch { }
}

function 健康([string]$期望版本, [int]$等秒) {
    $结束 = (Get-Date).AddSeconds($等秒)
    while ((Get-Date) -lt $结束) {
        Start-Sleep -Seconds 5
        try {
            $b = Get-Content (Join-Path $Heartline 'body.beat.json') -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json
            $年龄 = ((Get-Date) - [datetime]$b.at).TotalSeconds
            if ($b.version -eq $期望版本 -and $年龄 -lt 30) { return $true }
        } catch { }
    }
    return $false
}

if (-not ([Security.Principal.WindowsPrincipal]([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    记 '拒绝执行：不是管理员上下文，提权通道不对'
    exit 1
}

if (-not (Test-Path $RepoPath)) { 记 ('仓库不在: ' + $RepoPath); exit 1 }
if (-not (Test-Path $DestRoot)) { New-Item -ItemType Directory -Force -Path $DestRoot | Out-Null }

Push-Location $RepoPath
& git fetch --all --tags --quiet 2>&1 | Out-Null
$验证 = (& git rev-parse --verify ('refs/tags/' + $Tag) 2>&1)
if ($LASTEXITCODE -ne 0) { 记 ('没有这个 tag: ' + $Tag); Pop-Location; exit 1 }
& git checkout --quiet $Tag 2>&1 | Out-Null
Pop-Location
记 ('检出 ' + $Tag + '（' + ($验证.Trim()) + '）')

$源 = Join-Path $RepoPath 'src\急救本体.ps1'
if (-not (Test-Path $源)) { 记 '仓库里没有 src\急救本体.ps1'; exit 1 }
$哈希 = (Get-FileHash -LiteralPath $源 -Algorithm SHA256).Hash
记 ('源文件 sha256=' + $哈希)

if (Test-Path $当前) {
    if (Test-Path $上一版) { Remove-Item $上一版 -Recurse -Force -ErrorAction SilentlyContinue }
    Copy-Item $当前 $上一版 -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $当前 | Out-Null
Copy-Item $源 (Join-Path $当前 '急救本体.ps1') -Force
Set-Content -LiteralPath (Join-Path $当前 'VERSION') -Value $Tag -Encoding UTF8
记 ('已部署到 ' + $当前)

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if (健康 $Tag 90) {
    记 ('部署成功，' + $Tag + ' 已上报心跳')
    exit 0
}

记 ('部署失败：90 秒没看到 ' + $Tag + ' 的新鲜心跳，回滚')
if (Test-Path (Join-Path $上一版 '急救本体.ps1')) {
    Copy-Item (Join-Path $上一版 '急救本体.ps1') (Join-Path $当前 '急救本体.ps1') -Force
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    记 '已回滚到上一版'
} else {
    记 '没有上一版可回滚，停在失败状态等人看'
}
exit 1