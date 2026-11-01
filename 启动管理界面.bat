@echo off
chcp 65001 >nul
setlocal
title Microsoft Rewards v5 - 中文管理界面
cd /d "%~dp0"

netstat -ano | findstr "127.0.0.1:8899" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo 管理界面已在运行，正在打开浏览器...
    start "" http://127.0.0.1:8899
    timeout /t 2 >nul
    exit /b
)

start "" /min cmd /c "timeout /t 2 >nul & start http://127.0.0.1:8899"

if not exist "%~dp0runtime\node\node.exe" (
    echo [错误] 找不到便携版 Node，请确认 runtime\node\node.exe 存在
    pause
    exit /b 1
)

"%~dp0runtime\node\node.exe" "%~dp0manager\server.js"

rem ---- 兜底：管理界面退出后，清理可能残留的奖励任务进程 ----
if exist "%~dp0manager\.run.pid" (
    echo 正在清理残留的奖励任务进程...
    for /f %%i in (%~dp0manager\.run.pid) do taskkill /PID %%i /T /F >nul 2>&1
    del /q "%~dp0manager\.run.pid" >nul 2>&1
)

echo.
echo 管理界面已停止。
pause
