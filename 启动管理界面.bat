@echo off
title Microsoft Rewards v5 - 中文管理界面
cd /d "%~dp0"

netstat -ano | findstr "127.0.0.1:8899" | findstr "LISTENING" >nul 2>&1
if errorlevel 1 goto START

rem 端口被占用：先确认占用者是不是一个真正能响应的管理界面
powershell -NoProfile -Command "try { $null = Invoke-WebRequest -Uri 'http://127.0.0.1:8899/api/state' -TimeoutSec 3 -UseBasicParsing; exit 0 } catch { exit 1 }"
if not errorlevel 1 goto ALREADY

echo.
echo   端口 8899 被无响应的进程占用（多半是上次异常退出的残留），正在清理...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "127.0.0.1:8899" ^| findstr "LISTENING"') do taskkill /PID %%a /T /F >nul 2>&1
%SystemRoot%\System32\timeout.exe /t 1 /nobreak >nul 2>&1

:START
if not exist "%~dp0runtime\node\node.exe" goto NONODE

rem 稍等 2 秒再打开浏览器，等服务监听就绪
start "" /min cmd /c "%SystemRoot%\System32\timeout.exe /t 2 /nobreak >nul 2>&1 & start http://127.0.0.1:8899"

"%~dp0runtime\node\node.exe" "%~dp0manager\server.js"

if not exist "%~dp0manager\.run.pid" goto END
echo 正在清理残留的奖励任务进程...
set /p RUNPID=<"%~dp0manager\.run.pid"
if not defined RUNPID goto DELPID
taskkill /PID %RUNPID% /T /F >nul 2>&1
:DELPID
del /q "%~dp0manager\.run.pid" >nul 2>&1
goto END

:ALREADY
start "" http://127.0.0.1:8899
echo.
echo   管理界面已经在运行中
echo.
echo   地址: http://127.0.0.1:8899
echo.
echo   已在浏览器中打开该地址。
echo.
echo   说明: 服务由另一个命令行窗口托管，
echo         关闭本窗口不会停止它。
echo         要停止服务，请双击「停止管理界面.bat」，
echo         或在该窗口按 Ctrl+C。
echo.
pause
exit /b

:NONODE
echo.
echo [错误] 找不到便携版 Node
echo 请确认以下文件存在：
echo   %~dp0runtime\node\node.exe
echo.
pause
exit /b 1

:END
echo.
echo 管理界面已停止。
pause
