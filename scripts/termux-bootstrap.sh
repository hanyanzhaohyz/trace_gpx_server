#!/data/data/com.termux/files/usr/bin/bash
# 在 Termux 内安装依赖、配置 sshd、启动 迹 Trace
set -euo pipefail

export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PATH"
export HOME="${HOME:-/data/data/com.termux/files/home}"
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"
# shellcheck disable=SC1091
[[ -f "$PREFIX/etc/profile.d/amap.sh" ]] && source "$PREFIX/etc/profile.d/amap.sh"

APP_SD="/sdcard/trace_gps"
APP_HOME="$HOME/trace_gps"
PORT="${PORT:-4173}"
GPX_DIR="${GPX_DIR:-/storage/emulated/0/gpx}"
PUBKEY_FILE="$APP_SD/authorized_keys.pub"

mkdir -p "$HOME/.termux" "$HOME/.ssh" "$APP_HOME" "$GPX_DIR" "$PREFIX/tmp"
chmod 700 "$HOME/.ssh"

# 允许外部调用（F-Droid 才有 RunCommand；写了也无害）
PROP="$HOME/.termux/termux.properties"
touch "$PROP"
grep -q '^allow-external-apps=true' "$PROP" 2>/dev/null || echo 'allow-external-apps=true' >> "$PROP"

echo "[迹] 检查软件包…"
pkg update -y || true
# node + openssh（方便以后电脑 SSH 进来）
NEED=()
command -v node >/dev/null 2>&1 || NEED+=(nodejs)
command -v sshd >/dev/null 2>&1 || NEED+=(openssh)
if ((${#NEED[@]})); then
  echo "[迹] 安装: ${NEED[*]}"
  pkg install -y "${NEED[@]}"
fi

# 安装电脑公钥
if [[ -f "$PUBKEY_FILE" ]]; then
  touch "$HOME/.ssh/authorized_keys"
  chmod 600 "$HOME/.ssh/authorized_keys"
  if ! grep -qf "$PUBKEY_FILE" "$HOME/.ssh/authorized_keys" 2>/dev/null; then
    cat "$PUBKEY_FILE" >> "$HOME/.ssh/authorized_keys"
    echo "[迹] 已写入 authorized_keys"
  fi
fi

# 启动 sshd（默认 8022）
if ! ss -ltn 2>/dev/null | grep -q ':8022' && ! netstat -ltn 2>/dev/null | grep -q ':8022'; then
  echo "[迹] 启动 sshd :8022"
  sshd || true
fi

echo "[迹] 同步应用文件…"
cp -f "$APP_SD/server.mjs" "$APP_HOME/" 2>/dev/null || true
cp -f "$APP_SD/gpxParse.mjs" "$APP_HOME/" 2>/dev/null || true
cp -f "$APP_SD/package.json" "$APP_HOME/" 2>/dev/null || true
rm -rf "$APP_HOME/dist"
cp -R "$APP_SD/dist" "$APP_HOME/"

pkill -f "node server.mjs" 2>/dev/null || true
sleep 0.5

cd "$APP_HOME"
echo "[迹] GPX_DIR=$GPX_DIR"
echo "[迹] 启动 http://0.0.0.0:$PORT"
termux-wake-lock 2>/dev/null || true
nohup env \
  PORT="$PORT" \
  GPX_DIR="$GPX_DIR" \
  AMAP_KEY="${AMAP_KEY:-}" \
  AMAP_SECURITY_JS_CODE="${AMAP_SECURITY_JS_CODE:-}" \
  node server.mjs >"$APP_HOME/server.log" 2>&1 &
echo $! >"$APP_HOME/server.pid"
sleep 1
if ss -ltn 2>/dev/null | grep -q ":$PORT" || netstat -ltn 2>/dev/null | grep -q ":$PORT"; then
  echo "[迹] 服务已监听 $PORT"
else
  echo "[迹] 启动可能失败，日志："
  tail -n 30 "$APP_HOME/server.log" || true
  exit 1
fi

echo "[迹] 完成。电脑执行: adb forward tcp:$PORT tcp:$PORT"
echo "[迹] 然后打开 http://127.0.0.1:$PORT"
