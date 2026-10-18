#!/usr/bin/env bash
# 开发模式：改代码自动重启。
#   后端：监听 src/main 改动 → 重启；**成功启动后**崩溃会自动拉起；
#         但如果压根没起来（构建失败），不反复重启，等下次改动再试。
#   前端：Vite 热更新（改 .tsx 立即生效，无需重启）。
# 环境由 ./mvnw 自己解析。Ctrl-C 退出并清理。
set -uo pipefail
cd "$(dirname "$0")"

echo "==> 检查环境"
./mvnw -v || { echo "✗ Maven / JDK 没配好（看上面的报错）"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "✗ 缺少 npm（Node.js）"; exit 1; }
[ -d frontend/node_modules ] || { echo "✗ 先执行：cd frontend && npm install"; exit 1; }

BACK_PID=""
FRONT_PID=""
BLOG="$(mktemp)"

kill_port() { local p; p=$(lsof -ti tcp:7000 2>/dev/null || true); [ -n "$p" ] && kill $p 2>/dev/null || true; }

cleanup() {
  echo; echo "==> 退出，清理…"
  [ -n "$BACK_PID" ]  && kill "$BACK_PID"  2>/dev/null || true
  [ -n "$FRONT_PID" ] && kill "$FRONT_PID" 2>/dev/null || true
  kill_port
}
trap cleanup EXIT INT TERM

start_backend() {
  kill_port
  echo "==> 启动后端  →  http://localhost:7000"
  ./mvnw -DskipTests spring-boot:run 2>&1 | tee "$BLOG" &
  BACK_PID=$!
}

echo "==> 启动前端  →  http://localhost:5173  (Vite 热更新)"
( cd frontend && npm run dev ) &
FRONT_PID=$!

start_backend

STAMP="$(mktemp)"
touch "$STAMP"
echo "==> 监听 src/main 变化…（Ctrl-C 退出）"

while true; do
  sleep 2

  # 源码有改动 → 重启后端
  if [ -n "$(find src/main -type f -newer "$STAMP" 2>/dev/null | head -n1)" ]; then
    touch "$STAMP"
    echo "==> 检测到改动，重启后端…"
    kill "$BACK_PID" 2>/dev/null || true
    wait "$BACK_PID" 2>/dev/null || true
    start_backend
    continue
  fi

  # 后端进程没了
  if [ -n "$BACK_PID" ] && ! kill -0 "$BACK_PID" 2>/dev/null; then
    if grep -q 'Started SqlFlowApplication' "$BLOG"; then
      echo "==> 后端已退出，自动重启…"
      start_backend
    else
      # 没起来（构建失败/启动报错）：不反复重启，等改动
      if [ -z "$(find src/main -type f -newer "$STAMP" 2>/dev/null | head -n1)" ]; then
        sleep 2
      fi
    fi
  fi
done
