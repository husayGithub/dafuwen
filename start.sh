#!/bin/bash
# 城市资本家 - 启动脚本 (Mac/Linux)
# 飞机上使用：一台手机开热点，其他手机连接后运行此脚本

echo ""
echo "🏙️  城市资本家 - 多人联机服务器"
echo "================================"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未找到 Node.js，请先安装"
    echo "   下载地址: https://nodejs.org/"
    exit 1
fi

# 启动服务器
echo "正在启动服务器..."
cd "$(dirname "$0")/web"
node server.js --port 8080
