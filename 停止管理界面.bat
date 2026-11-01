@echo off
title 停止 Microsoft Rewards 管理界面
cd /d "%~dp0"

set "SRVPID="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr "127.0.0.1:8899" ^| findstr "LISTENING"') do set "SRVPID=%%a"

if not defined SRVPID goto NOTRUN

echo.
echo   正在停止管理界面 (PID %SRVPID%) ...
taskkill /PID %SRVPID% /T /F >nul 2>&1
if errorlevel 1 goto FAILED
echo   已停止。正在运行的奖励任务也已一并结束。
echo.
pause
exit /b

:NOTRUN
echo.
echo   管理界面当前没有运行。
echo.
pause
exit /b

:FAILED
echo   停止失败，可能权限不足。请尝试以管理员身份运行本脚本。
echo.
pause
exit /b 1
