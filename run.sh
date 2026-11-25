#!/data/data/com.termux/files/usr/bin/bash
export PATH=/data/data/com.termux/files/usr/bin:$PATH
APP_SD=/sdcard/trace_gps
APP_HOME=$HOME/trace_gps
mkdir -p "$APP_HOME"
cp -f "$APP_SD/server.mjs" "$APP_HOME/"
cp -f "$APP_SD/gpxParse.mjs" "$APP_HOME/"
cp -f "$APP_SD/package.json" "$APP_HOME/"
rm -rf "$APP_HOME/dist"
cp -R "$APP_SD/dist" "$APP_HOME/"
pkill -f "node server.mjs" 2>/dev/null || true
sleep 0.4
cd "$APP_HOME"
termux-wake-lock 2>/dev/null || true
nohup env PORT=4173 GPX_DIR=/storage/emulated/0/gpx node server.mjs >"$APP_HOME/server.log" 2>&1 &
echo $! >"$APP_HOME/server.pid"
