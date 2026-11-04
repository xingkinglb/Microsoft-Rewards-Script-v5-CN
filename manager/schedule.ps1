#Requires -Version 5.1
<#
    schedule.ps1 — 管理 Microsoft Rewards v5 的 Windows 计划任务

    用法（一般由管理界面调用，也可手动执行）：
        powershell -NoProfile -ExecutionPolicy Bypass -File schedule.ps1 -Action status
        powershell -NoProfile -ExecutionPolicy Bypass -File schedule.ps1 -Action install -Time 07:00
        powershell -NoProfile -ExecutionPolicy Bypass -File schedule.ps1 -Action remove
        powershell -NoProfile -ExecutionPolicy Bypass -File schedule.ps1 -Action run

    输出为单行 JSON，便于程序解析。
    使用「仅在用户登录时运行」模式，因此不需要管理员权限，也不需要保存密码。
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('install', 'remove', 'status', 'run')]
    [string]$Action,

    [string]$Time = '07:00',

    [string]$TaskName = 'MicrosoftRewardsScript-v5'
)

$ErrorActionPreference = 'Stop'

# 保证中文错误信息以 UTF-8 输出，便于 Node 端正确解析
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Root     = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$NodeExe  = Join-Path $Root 'runtime\node\node.exe'
$Runner   = Join-Path $Root 'manager\scheduled-run.js'
$Launcher = Join-Path $Root 'manager\launch-scheduler.vbs'

function Write-Json($obj) {
    $obj | ConvertTo-Json -Compress -Depth 5 | Write-Output
}

function Format-Time($value) {
    if ($null -eq $value) { return $null }
    if ($value.Year -le 1999) { return $null }
    return $value.ToString('yyyy-MM-dd HH:mm:ss')
}

try {
    switch ($Action) {

        'status' {
            $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
            if (-not $task) {
                Write-Json @{ installed = $false; taskName = $TaskName }
                break
            }
            $info = Get-ScheduledTaskInfo -TaskName $TaskName
            # 注意：变量名不能叫 $action —— PowerShell 变量不分大小写，会撞上参数 $Action
            $firstAction = $task.Actions | Select-Object -First 1
            Write-Json @{
                installed   = $true
                taskName    = $TaskName
                state       = [string]$task.State
                nextRun     = Format-Time $info.NextRunTime
                lastRun     = Format-Time $info.LastRunTime
                lastResult  = $info.LastTaskResult
                viaLauncher = [bool]($firstAction -and $firstAction.Execute -match 'wscript')
            }
        }

        'install' {
            if (-not (Test-Path $NodeExe)) { throw "找不到便携版 Node：$NodeExe" }
            if (-not (Test-Path $Runner))  { throw "找不到运行脚本：$Runner" }
            if ($Time -notmatch '^\d{1,2}:\d{2}$') { throw "时间格式应为 HH:mm，当前为 $Time" }

            # 经 VBS 启动：窗口是否可见由 settings.json 的 scheduledProgressWindow 决定，
            # 所以切换开关不需要重新注册计划任务。VBS 缺失时回退为直接跑 Node。
            $wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
            if (Test-Path $Launcher) {
                $taskAction = New-ScheduledTaskAction -Execute $wscript -Argument ('"{0}"' -f $Launcher) -WorkingDirectory $Root
            } else {
                $taskAction = New-ScheduledTaskAction -Execute $NodeExe -Argument ('"{0}"' -f $Runner) -WorkingDirectory $Root
            }
            $trigger    = New-ScheduledTaskTrigger -Daily -At $Time
            $settings   = New-ScheduledTaskSettingsSet `
                            -StartWhenAvailable `
                            -AllowStartIfOnBatteries `
                            -DontStopIfGoingOnBatteries `
                            -MultipleInstances IgnoreNew `
                            -ExecutionTimeLimit (New-TimeSpan -Hours 3) `
                            -RestartCount 2 `
                            -RestartInterval (New-TimeSpan -Minutes 10)
            $principal  = New-ScheduledTaskPrincipal `
                            -UserId "$env:USERDOMAIN\$env:USERNAME" `
                            -LogonType Interactive `
                            -RunLevel Limited

            Register-ScheduledTask `
                -TaskName $TaskName `
                -Action $taskAction `
                -Trigger $trigger `
                -Settings $settings `
                -Principal $principal `
                -Description '每天定时运行 Microsoft Rewards Script v5（错过后开机自动补跑）' `
                -Force | Out-Null

            Write-Json @{ ok = $true; taskName = $TaskName; time = $Time }
        }

        'remove' {
            $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
            if ($task) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
            Write-Json @{ ok = $true; removed = [bool]$task }
        }

        'run' {
            $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
            if (-not $task) { throw '计划任务尚未创建，请先启用定时任务' }
            Start-ScheduledTask -TaskName $TaskName
            Write-Json @{ ok = $true; started = $true }
        }
    }
}
catch {
    Write-Json @{ ok = $false; error = $_.Exception.Message }
    exit 1
}
