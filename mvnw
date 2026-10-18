#!/usr/bin/env bash
# 自带环境解析的 Maven 启动器（本机没配 PATH 也能用）。
#   JDK：要 Java 21+。优先 21；找不到 21 就用 ≥21 的（pom 里锁的 Lombok 1.18.42 支持到 JDK 25，已在 25 上编译+跑通）。
#   mvn：优先 $SQLFLOW_MAVEN_HOME，其次 PATH 上的 mvn；都没有才下载一份到 $SQLFLOW_MVN_CACHE（默认 ~/.sqlflow-maven）。
#   JDK 也可用 $SQLFLOW_JDK_HOME（或 $JAVA_HOME）直接指定。
# 用法同 mvn：./mvnw spring-boot:run
set -euo pipefail
cd "$(dirname "$0")"

NEED_JAVA=21

# $1 = java 可执行文件路径 → 主版本号（认不出给 0）
# 扫所有行，不只第一行：有些机器会先打一行 "Picked up JAVA_TOOL_OPTIONS: ..."。
java_major() {
  local v
  v="$("$1" -version 2>&1 | sed -n 's/.*version "\([0-9][0-9]*\)[."].*/\1/p' | head -n1 || true)"
  case "$v" in ''|*[!0-9]*) echo 0 ;; *) echo "$v" ;; esac
}

SYSTEM_JAVA="$(command -v java 2>/dev/null || echo /usr/bin/java)"

# 在常见位置找一个带 javac 的 JDK；$1="21" 只找恰好 21，$1="any" 找 ≥21
find_jdk() {
  local d v
  # ~/Library/... 是 IntelliJ「下载 JDK」装的位置，不在系统目录里
  for d in ${SQLFLOW_JDK_HOME:+"$SQLFLOW_JDK_HOME"} \
           /Library/Java/JavaVirtualMachines/*/Contents/Home \
           "$HOME"/Library/Java/JavaVirtualMachines/*/Contents/Home \
           /usr/lib/jvm/*; do
    [ -x "$d/bin/javac" ] || continue
    v="$(java_major "$d/bin/java")"
    if [ "$1" = "21" ]; then [ "$v" -eq "$NEED_JAVA" ] || continue
    else [ "$v" -ge "$NEED_JAVA" ] || continue; fi
    printf '%s' "$d"; return 0
  done
  return 1
}

pick_java_home() {
  local d jh

  # ── 第一优先：恰好 21 ──────────────────────────────────
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/javac" ] \
     && [ "$(java_major "$JAVA_HOME/bin/java")" -eq "$NEED_JAVA" ]; then return 0; fi
  if [ "$(java_major "$SYSTEM_JAVA")" -eq "$NEED_JAVA" ] && command -v javac >/dev/null 2>&1; then return 0; fi
  d="$(find_jdk 21 || true)"; [ -n "$d" ] && { export JAVA_HOME="$d"; return 0; }
  # macOS 没装 21 时 `java_home -v 21` 也会返回别的版本（实测给 25），所以还要再核一下版本
  jh="$(/usr/libexec/java_home -v "$NEED_JAVA" 2>/dev/null || true)"
  [ -n "$jh" ] && [ -x "$jh/bin/javac" ] && [ "$(java_major "$jh/bin/java")" -eq "$NEED_JAVA" ] \
    && { export JAVA_HOME="$jh"; return 0; }

  # ── 退而求其次：任何 ≥21 的 JDK ──
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/javac" ] \
     && [ "$(java_major "$JAVA_HOME/bin/java")" -ge "$NEED_JAVA" ]; then return 0; fi
  if [ "$(java_major "$SYSTEM_JAVA")" -ge "$NEED_JAVA" ] && command -v javac >/dev/null 2>&1; then return 0; fi
  d="$(find_jdk any || true)"; [ -n "$d" ] && { export JAVA_HOME="$d"; return 0; }
  return 1
}

if ! pick_java_home; then
  echo "✗ 找不到 Java $NEED_JAVA+ 的 JDK（PATH 上的 java 主版本：$(java_major "$SYSTEM_JAVA")）"
  echo "  安装 JDK 21（如 brew install openjdk@21），或设置 SQLFLOW_JDK_HOME / JAVA_HOME 指向 JDK 21"
  exit 1
fi

if [ -n "${JAVA_HOME:-}" ]; then
  export PATH="$JAVA_HOME/bin:$PATH"
fi

# ── mvn ─────────────────────────────────────────────────────
MVN=""
if [ -n "${SQLFLOW_MAVEN_HOME:-}" ] && [ -x "$SQLFLOW_MAVEN_HOME/bin/mvn" ]; then
  MVN="$SQLFLOW_MAVEN_HOME/bin/mvn"
elif command -v mvn >/dev/null 2>&1; then
  MVN="$(command -v mvn)"
else
  for c in /opt/homebrew/bin/mvn /usr/local/bin/mvn; do
    [ -x "$c" ] && { MVN="$c"; break; }
  done
fi

# 都没有 → 下载一份（只此一次）
if [ -z "$MVN" ]; then
  V="3.9.9"; CACHE="${SQLFLOW_MVN_CACHE:-$HOME/.sqlflow-maven}"
  MVN="$CACHE/apache-maven-$V/bin/mvn"
  if [ ! -x "$MVN" ]; then
    echo "==> 本机没有 mvn，下载 Maven $V 到 $CACHE（只此一次）"
    mkdir -p "$CACHE"
    URL="https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/$V/apache-maven-$V-bin.tar.gz"
    if command -v curl >/dev/null 2>&1; then
      curl -fL "$URL" -o "$CACHE/maven.tar.gz"
    elif command -v wget >/dev/null 2>&1; then
      wget -q "$URL" -O "$CACHE/maven.tar.gz"
    else
      echo "✗ 需要 curl 或 wget 才能下载 Maven"; exit 1
    fi
    tar -xzf "$CACHE/maven.tar.gz" -C "$CACHE"
    rm -f "$CACHE/maven.tar.gz"
  fi
fi

exec "$MVN" "$@"
