#!/data/data/com.termux/files/usr/bin/bash
# 在 Termux 内启动 迹 Trace 服务，并同步运行包 + 源码到 ~/trace_gps
set -euo pipefail

export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export HOME="${HOME:-/data/data/com.termux/files/home}"

# 载入高德 Key（Termux profile.d）
# shellcheck disable=SC1091
[[ -f "$PREFIX/etc/profile.d/amap.sh" ]] && source "$PREFIX/etc/profile.d/amap.sh"

APP_SD="/sdcard/trace_gps"
APP_HOME="$HOME/trace_gps"
PORT="${PORT:-4173}"
GPX_DIR="${GPX_DIR:-/storage/emulated/0/gpx}"

mkdir -p "$APP_HOME" "$GPX_DIR"

echo "[迹] 同步 /sdcard/trace_gps -> ~/trace_gps"

# 运行包
rm -rf "$APP_HOME/dist"
cp -R "$APP_SD/dist" "$APP_HOME/" 2>/dev/null || true
cp "$APP_SD/server.mjs" "$APP_HOME/" 2>/dev/null || true
cp "$APP_SD/gpxParse.mjs" "$APP_HOME/" 2>/dev/null || true
cp "$APP_SD/mapServe.mjs" "$APP_HOME/" 2>/dev/null || true
cp "$APP_SD/package.json" "$APP_HOME/" 2>/dev/null || true

# 源码目录
rm -rf "$APP_HOME/src" "$APP_HOME/public" "$APP_HOME/scripts" "$APP_HOME/docs"
[[ -d "$APP_SD/src" ]] && cp -R "$APP_SD/src" "$APP_HOME/"
[[ -d "$APP_SD/public" ]] && cp -R "$APP_SD/public" "$APP_HOME/"
[[ -d "$APP_SD/scripts" ]] && cp -R "$APP_SD/scripts" "$APP_HOME/"
[[ -d "$APP_SD/docs" ]] && cp -R "$APP_SD/docs" "$APP_HOME/"

# 工程配置文件
for f in \
  index.html \
  vite.config.ts \
  tsconfig.json \
  tsconfig.app.json \
  tsconfig.node.json \
  package-lock.json \
  README.md \
  .gitignore \
  .oxlintrc.json
do
  [[ -f "$APP_SD/$f" ]] && cp "$APP_SD/$f" "$APP_HOME/"
done

# 安装短命令：之后在 Termux 里直接敲 trace
TRACE_SRC=""
if [[ -f "$APP_SD/trace" ]]; then
  TRACE_SRC="$APP_SD/trace"
elif [[ -f "$APP_SD/scripts/trace" ]]; then
  TRACE_SRC="$APP_SD/scripts/trace"
fi
if [[ -n "$TRACE_SRC" ]]; then
  cp "$TRACE_SRC" "$PREFIX/bin/trace"
  chmod +x "$PREFIX/bin/trace"
  echo "[迹] 已安装命令: trace"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[迹] 未找到 node，正在安装 nodejs..."
  pkg update -y
  pkg install -y nodejs-lts
fi

# 结束旧进程
pkill -f "node server.mjs" 2>/dev/null || true
sleep 0.5

cd "$APP_HOME"
if [[ ! -d dist ]]; then
  echo "[迹] 缺少 dist/，请先在电脑执行 npm run deploy:phone"
  exit 1
fi

echo "[迹] 源码: $APP_HOME/src"
echo "[迹] GPX_DIR=$GPX_DIR"
if [[ -n "${AMAP_KEY:-}" && -n "${AMAP_SECURITY_JS_CODE:-}" ]]; then
  echo "[迹] 高德 JS API: 已配置 Key"
else
  echo "[迹] 高德 JS API: 未配置（请 export AMAP_KEY / AMAP_SECURITY_JS_CODE）"
fi
echo "[迹] 启动 http://0.0.0.0:$PORT"
termux-wake-lock 2>/dev/null || true
# 手机内存紧，给 Node 更大堆，避免 GPX 缓存 OOM
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"
exec env \
  PORT="$PORT" \
  GPX_DIR="$GPX_DIR" \
  NODE_OPTIONS="$NODE_OPTIONS" \
  AMAP_KEY="${AMAP_KEY:-}" \
  AMAP_SECURITY_JS_CODE="${AMAP_SECURITY_JS_CODE:-}" \
  node server.mjs
