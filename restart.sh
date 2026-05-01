#!/bin/bash
# JT-GELFLOW - Restart Script
# 用法: ./restart.sh [--no-build]

set -e

cd /opt/jt-gelflow

echo "=== JT-GELFLOW Restart ==="

# 檢查是否跳過建置
if [[ "$1" != "--no-build" ]]; then
    echo "[1/4] 清除舊建置檔案..."
    rm -rf dist

    echo "[2/4] 建置前端..."
    npm run build
else
    echo "[1/4] 跳過建置 (--no-build)"
    echo "[2/4] 跳過建置 (--no-build)"
fi

echo "[3/4] 終止舊程序..."
# 只終止 jt-gelflow 的程序，不影響其他站台
pkill -9 -f "python.*/opt/jt-gelflow/run.py" 2>/dev/null || true
sleep 2

echo "[4/4] 啟動伺服器..."
cd /opt/jt-gelflow
nohup python3.10 /opt/jt-gelflow/run.py > /tmp/jt-gelflow.log 2>&1 &
sleep 3

# 驗證
PID=$(pgrep -f "jt-gelflow" | head -1)
if [[ -n "$PID" ]]; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8099/ 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
        echo ""
        echo "=== 重啟成功 ==="
        echo "PID: $PID"
        echo "HTTP: $HTTP_CODE"
        echo "URL: http://localhost:8099"
        echo ""
    else
        echo "警告: 伺服器啟動但 HTTP 回應異常 ($HTTP_CODE)"
    fi
else
    echo "錯誤: 伺服器啟動失敗"
    exit 1
fi
