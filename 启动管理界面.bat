@echo off
title Microsoft Rewards v5 - 中文管理界面
cd /d "%~dp0"

netstat -ano | findstr "127.0.0.1:8899" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto ALREADY

if not exist "%~dp0runtime\node\node.exe" goto NONODE

rem 稍等 2 秒再打开浏览器，等服务监听就绪
start "" /min cmd /c "%SystemRoot%\System32\timeout.exe /t 2 /nobreak >nul & start http://127.0.0.1:8899"

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
rem 已经在运行，直接打开页面即可，不弹提示窗口
start "" http://127.0.0.1:8899
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
