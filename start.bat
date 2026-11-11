@echo off
chcp 65001 >nul
REM 城市资本家 - 启动脚本 (Windows)
REM 飞机上使用：一台手机开热点，其他手机连接后运行此脚本

echo.
echo 🏙️  城市资本家 - 多人联机服务器
echo ================================
echo.

REM 检查 Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ 未找到 Node.js，请先安装
    echo    下载地址: https://nodejs.org/
    pause
    exit /b 1
)

REM 启动服务器
echo 正在启动服务器...
cd /d "%~dp0web"
node server.js --port 8080

pause
