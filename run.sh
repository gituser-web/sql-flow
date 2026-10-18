#!/usr/bin/env bash
# 构建前端 + 启动后端。
#   后端**成功启动后**意外退出 → 2 秒后自动重启；
#   构建失败 / 启动报错（压根没起来）→ 不重启，停下让你看错误。
# Ctrl-C 结束。环境由 ./mvnw 自己解析。
set -uo pipefail
cd "$(dirname "$0")"

echo "==> 检查环境"
./mvnw -v || { echo "✗ Maven / JDK 没配好（看上面的报错）"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "✗ 缺少 npm（Node.js）"; exit 1; }
echo "node: $(node -v)"

kill_port() { local p; p=$(lsof -ti tcp:7000 2>/dev/null || true); [ -n "$p" ] && kill $p 2>/dev/null || true; }

trap 'echo; echo "==> 退出"; kill_port; exit 0' INT TERM

echo "==> 构建前端（产物写入 src/main/resources/static）"
( cd frontend && npm install && npm run build ) || { echo "✗ 前端构建失败"; exit 1; }

LOG="$(mktemp)"
echo "==> 启动后端  →  http://localhost:7000   （Ctrl-C 结束）"
while true; do
  kill_port
  ./mvnw -DskipTests spring-boot:run 2>&1 | tee "$LOG"

  # 没打印出 "Started SqlFlowApplication" 就说明它根本没起来（构建失败/启动报错）——
  # 这种情况重启也是白重启，直接停下，把错误留给用户看。
  if ! grep -q 'Started SqlFlowApplication' "$LOG"; then
    echo
    echo "✗ 后端没能启动（构建失败或启动报错），已停止自动重启。修好后重跑 ./run.sh。"
    exit 1
  fi

  echo "==> 后端已退出，2 秒后自动重启…"
  sleep 2
done
