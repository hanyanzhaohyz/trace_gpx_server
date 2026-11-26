#!/usr/bin/env bash
# 部署到已 USB 连接的安卓手机 Termux，并 adb forward 供电脑访问
# 同时同步运行包 + 源码（不含 node_modules / .venv）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_SD="/sdcard/trace_gps"
PORT="${PORT:-4173}"
ADB="${ADB:-adb}"

cd "$ROOT"

echo "==> 检查 adb 设备"
if ! "$ADB" devices | awk 'NR>1 && $2=="device"{ok=1} END{exit ok?0:1}'; then
  echo "未检测到已授权的手机。请："
  echo "  1) USB 连接手机"
  echo "  2) 打开开发者选项 → USB 调试"
  echo "  3) 手机上点「允许」这台电脑调试"
  echo "  4) 再运行: npm run deploy:phone"
  "$ADB" devices -l
  exit 1
fi

echo "==> 构建前端"
npm run build

echo "==> 推送到手机 $REMOTE_SD"
"$ADB" shell "mkdir -p $REMOTE_SD"

# 运行包：整目录替换，避免旧版 assets 残留
"$ADB" shell "rm -rf $REMOTE_SD/dist"
"$ADB" push "$ROOT/dist" "$REMOTE_SD/"
"$ADB" push "$ROOT/server.mjs" "$REMOTE_SD/"
"$ADB" push "$ROOT/gpxParse.mjs" "$REMOTE_SD/"
"$ADB" push "$ROOT/mapServe.mjs" "$REMOTE_SD/"
"$ADB" push "$ROOT/package.json" "$REMOTE_SD/"

# 源码（不含 node_modules）
echo "==> 同步源码"
"$ADB" shell "rm -rf $REMOTE_SD/src $REMOTE_SD/public $REMOTE_SD/scripts $REMOTE_SD/docs"
"$ADB" push "$ROOT/src" "$REMOTE_SD/"
"$ADB" push "$ROOT/public" "$REMOTE_SD/"
"$ADB" push "$ROOT/scripts" "$REMOTE_SD/"
if [[ -d "$ROOT/docs" ]]; then
  "$ADB" push "$ROOT/docs" "$REMOTE_SD/"
fi
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
  if [[ -f "$ROOT/$f" ]]; then
    "$ADB" push "$ROOT/$f" "$REMOTE_SD/"
  fi
done

# 根目录保留短路径，方便文档里的命令
"$ADB" shell "cp $REMOTE_SD/scripts/termux-start.sh $REMOTE_SD/termux-start.sh; cp $REMOTE_SD/scripts/trace $REMOTE_SD/trace; chmod +x $REMOTE_SD/termux-start.sh $REMOTE_SD/trace $REMOTE_SD/scripts/termux-start.sh $REMOTE_SD/scripts/trace || true"

# 确保 gpx 目录存在
"$ADB" shell "mkdir -p /sdcard/gpx /storage/emulated/0/gpx" || true

echo "==> 尝试在 Termux 中启动服务"
# 允许外部应用调 RunCommand（需用户曾在 termux.properties 打开 allow-external-apps）
PROP=/data/data/com.termux/files/home/.termux/termux.properties
"$ADB" shell "grep -q '^allow-external-apps=true' $PROP 2>/dev/null || echo allow-external-apps=true >> $PROP" 2>/dev/null || true

START_CMD="cd $REMOTE_SD && bash termux-start.sh"

# 方式 1：Termux RUN_COMMAND
set +e
"$ADB" shell am startservice \
  -n com.termux/com.termux.app.RunCommandService \
  -a com.termux.RUN_COMMAND \
  --es com.termux.RUN_COMMAND_PATH '/data/data/com.termux/files/usr/bin/bash' \
  --esa com.termux.RUN_COMMAND_ARGUMENTS "-lc,$START_CMD" \
  --ez com.termux.RUN_COMMAND_BACKGROUND true \
  --es com.termux.RUN_COMMAND_WORKDIR '/data/data/com.termux/files/home'
RC=$?
set -e

if [[ $RC -ne 0 ]]; then
  echo "RunCommand 未能自动启动（常见）。请在手机 Termux 里手动执行："
  echo "  trace"
  echo "  或: bash /sdcard/trace_gps/termux-start.sh"
fi

echo "==> adb forward tcp:$PORT -> 手机:$PORT"
"$ADB" forward --remove "tcp:$PORT" 2>/dev/null || true
"$ADB" forward "tcp:$PORT" "tcp:$PORT"

echo ""
echo "部署完成（含源码同步到 /sdcard/trace_gps 与 ~/trace_gps）。"
echo "电脑浏览器：http://127.0.0.1:$PORT"
echo "手机 Chrome：http://127.0.0.1:$PORT"
echo "源码位置：~/trace_gps/src"
echo "重启：在 Termux 执行 trace"
echo "GPX 默认目录：/storage/emulated/0/gpx"
