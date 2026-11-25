#!/usr/bin/env node
/**
 * 迹 Trace 静态服务 + GPX API
 *
 * 环境变量：
 *   PORT          默认 4173
 *   GPX_DIR       本地目录（优先）
 *   GPX_SOURCE=adb  通过 adb 读手机目录（Mac 开发/临时托管）
 *   ADB_GPX_DIR   默认 /storage/emulated/0/gpx
 *   ADB           adb 可执行文件，默认 adb
 *   CACHE_DIR     解析缓存目录，默认 <cwd>/cache
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseGpxToCached } from './gpxParse.mjs'
import {
  buildSummary,
  buildMapGeoJSON,
  buildFilteredStats,
  parseTimeQuery,
} from './mapServe.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 4173)
const DIST = path.join(__dirname, 'dist')
const ADB = process.env.ADB || 'adb'
const ADB_GPX_DIR =
  process.env.ADB_GPX_DIR || '/storage/emulated/0/gpx'
const USE_ADB = process.env.GPX_SOURCE === 'adb'
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'cache')
const BUNDLE_PATH = path.join(CACHE_DIR, 'tracks.bundle.json.gz')
const META_PATH = path.join(CACHE_DIR, 'tracks.meta.json')

/** 内存中的解析包（只服务端持有，勿整包发给浏览器） */
let memBundle = null

const LOCAL_CANDIDATES = [
  process.env.GPX_DIR,
  '/storage/emulated/0/gpx',
  '/sdcard/gpx',
  path.join(__dirname, 'gpx'),
].filter(Boolean)

function resolveLocalGpxDir() {
  for (const dir of LOCAL_CANDIDATES) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir
    } catch {
      /* continue */
    }
  }
  return LOCAL_CANDIDATES[0] || '/storage/emulated/0/gpx'
}

const LOCAL_GPX_DIR = resolveLocalGpxDir()

function adb(args, encoding = 'utf8') {
  const r = spawnSync(ADB, args, {
    encoding,
    maxBuffer: 256 * 1024 * 1024,
  })
  if (r.error) throw r.error
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || 'adb failed').toString().trim())
  }
  return r.stdout
}

function listGpxFiles() {
  if (USE_ADB) {
    const out = adb(['shell', `ls -1 "${ADB_GPX_DIR}"`])
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((f) => f.toLowerCase().endsWith('.gpx'))
      .sort((a, b) => a.localeCompare(b, 'zh'))
      .map((name) => ({ name, size: 0, mtime: '' }))
  }
  const dir = LOCAL_GPX_DIR
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.gpx'))
    .sort((a, b) => a.localeCompare(b, 'zh'))
    .map((name) => {
      const full = path.join(dir, name)
      const st = fs.statSync(full)
      return { name, size: st.size, mtime: st.mtime.toISOString() }
    })
}

function readGpxFile(name) {
  const base = path.basename(name)
  if (!base.toLowerCase().endsWith('.gpx')) {
    throw Object.assign(new Error('非法文件名'), { status: 400 })
  }
  if (base.includes('..') || base.includes('/') || base.includes('\\')) {
    throw Object.assign(new Error('非法文件名'), { status: 400 })
  }

  if (USE_ADB) {
    // exec-out 保留二进制/原文
    const r = spawnSync(
      ADB,
      ['exec-out', 'cat', `${ADB_GPX_DIR}/${base}`],
      { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 },
    )
    if (r.status !== 0) {
      throw Object.assign(new Error('文件不存在或 adb 读取失败'), {
        status: 404,
      })
    }
    return r.stdout
  }

  const full = path.join(LOCAL_GPX_DIR, base)
  if (!fs.existsSync(full)) {
    throw Object.assign(new Error('文件不存在'), { status: 404 })
  }
  return fs.readFileSync(full)
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(data)
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.woff2': 'font/woff2',
      '.mjs': 'text/javascript; charset=utf-8',
      '.map': 'application/json; charset=utf-8',
    }[ext] || 'application/octet-stream'
  )
}

/** @type {{ building: boolean, ready: boolean, total: number, done: number, error: string | null, trackCount: number, builtAt: string | null }} */
const cacheState = {
  building: false,
  ready: false,
  total: 0,
  done: 0,
  error: null,
  trackCount: 0,
  builtAt: null,
}

function fileFingerprint(f) {
  return `${f.name}|${f.size}|${f.mtime}`
}

function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(META_PATH, 'utf8'))
  } catch {
    return null
  }
}

function cacheIsFresh(files) {
  const meta = readMeta()
  if (!meta?.files || !fs.existsSync(BUNDLE_PATH)) return false
  if (meta.files.length !== files.length) return false
  const a = meta.files.map(fileFingerprint).sort()
  const b = files.map(fileFingerprint).sort()
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function buildCacheSync() {
  if (USE_ADB) {
    throw new Error('adb 模式不支持服务端缓存，请用本机 GPX_DIR')
  }
  const files = listGpxFiles()
  cacheState.building = true
  cacheState.ready = false
  cacheState.error = null
  cacheState.total = files.length
  cacheState.done = 0
  cacheState.trackCount = 0

  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const tracks = []
  const errors = []

  console.log(`[迹 Trace] 构建解析缓存：${files.length} 个 GPX…`)
  const t0 = Date.now()

  for (const f of files) {
    try {
      const buf = readGpxFile(f.name)
      const xml = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf)
      const parsed = parseGpxToCached(xml, f.name)
      if (!parsed) {
        errors.push(`${f.name}: 解析失败`)
      } else {
        tracks.push({
          ...parsed,
          size: f.size,
          mtime: f.mtime,
        })
      }
    } catch (e) {
      errors.push(`${f.name}: ${e.message || e}`)
    }
    cacheState.done += 1
    if (cacheState.done % 50 === 0 || cacheState.done === files.length) {
      console.log(
        `[迹 Trace] 缓存进度 ${cacheState.done}/${files.length}`,
      )
    }
  }

  const payload = {
    v: 1,
    dir: gpxDirLabel,
    builtAt: new Date().toISOString(),
    tracks,
    errors,
  }
  const json = JSON.stringify(payload)
  const gz = zlib.gzipSync(Buffer.from(json), { level: 6 })
  fs.writeFileSync(BUNDLE_PATH, gz)
  fs.writeFileSync(
    META_PATH,
    JSON.stringify(
      {
        builtAt: payload.builtAt,
        trackCount: tracks.length,
        files: files.map((f) => ({
          name: f.name,
          size: f.size,
          mtime: f.mtime,
        })),
        errorCount: errors.length,
        bytesRaw: json.length,
        bytesGz: gz.length,
      },
      null,
      2,
    ),
  )

  memBundle = payload
  cacheState.building = false
  cacheState.ready = true
  cacheState.trackCount = tracks.length
  cacheState.builtAt = payload.builtAt
  console.log(
    `[迹 Trace] 缓存完成 ${tracks.length} tracks，gzip ${(gz.length / 1048576).toFixed(1)}MB，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  )
  return payload
}

function getBundle() {
  ensureCache()
  if (memBundle?.tracks?.length) return memBundle
  if (!fs.existsSync(BUNDLE_PATH)) {
    throw Object.assign(new Error('缓存不可用'), { status: 500 })
  }
  const raw = zlib.gunzipSync(fs.readFileSync(BUNDLE_PATH))
  memBundle = JSON.parse(raw.toString('utf8'))
  return memBundle
}

function sendGzipJson(req, res, obj) {
  const json = JSON.stringify(obj)
  const accept = String(req.headers['accept-encoding'] || '')
  if (accept.includes('gzip')) {
    const gz = zlib.gzipSync(Buffer.from(json), { level: 5 })
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Encoding': 'gzip',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'Content-Length': gz.length,
    })
    res.end(gz)
    return
  }
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(json),
  })
  res.end(json)
}

function ensureCache() {
  if (USE_ADB) return null
  const files = listGpxFiles()
  if (cacheIsFresh(files)) {
    cacheState.ready = true
    const meta = readMeta()
    cacheState.trackCount = meta?.trackCount ?? 0
    cacheState.builtAt = meta?.builtAt ?? null
    cacheState.total = files.length
    cacheState.done = files.length
    return 'fresh'
  }
  if (cacheState.building) return 'building'
  buildCacheSync()
  return 'built'
}

function sendGzipJsonFile(req, res, filePath) {
  const accept = String(req.headers['accept-encoding'] || '')
  const buf = fs.readFileSync(filePath)
  if (accept.includes('gzip')) {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Encoding': 'gzip',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'Content-Length': buf.length,
    })
    res.end(buf)
    return
  }
  const raw = zlib.gunzipSync(buf)
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': raw.length,
  })
  res.end(raw)
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0])
  if (rel === '/') rel = '/index.html'
  const filePath = path.normalize(path.join(DIST, rel))
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403).end('Forbidden')
    return
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const index = path.join(DIST, 'index.html')
    if (fs.existsSync(index)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      fs.createReadStream(index).pipe(res)
      return
    }
    res.writeHead(404).end('Not Found')
    return
  }
  res.writeHead(200, { 'Content-Type': contentType(filePath) })
  fs.createReadStream(filePath).pipe(res)
}

const gpxDirLabel = USE_ADB ? `adb:${ADB_GPX_DIR}` : LOCAL_GPX_DIR

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    res.end()
    return
  }

  if (url.pathname === '/api/health') {
    let count = 0
    try {
      count = listGpxFiles().length
    } catch {
      /* ignore */
    }
    sendJson(res, 200, {
      ok: true,
      mode: USE_ADB ? 'adb' : 'local',
      gpxDir: gpxDirLabel,
      count,
      cache: {
        ready: cacheState.ready,
        building: cacheState.building,
        trackCount: cacheState.trackCount,
        builtAt: cacheState.builtAt,
        progress:
          cacheState.total > 0
            ? `${cacheState.done}/${cacheState.total}`
            : null,
      },
    })
    return
  }

  if (url.pathname === '/api/cache/status') {
    sendJson(res, 200, { ...cacheState, dir: gpxDirLabel })
    return
  }

  if (url.pathname === '/api/cache/rebuild' && req.method === 'POST') {
    try {
      if (cacheState.building) {
        sendJson(res, 409, { error: '正在构建中' })
        return
      }
      // 强制重建：删 meta
      try {
        fs.unlinkSync(META_PATH)
      } catch {
        /* ignore */
      }
      buildCacheSync()
      sendJson(res, 200, {
        ok: true,
        trackCount: cacheState.trackCount,
        builtAt: cacheState.builtAt,
      })
    } catch (e) {
      sendJson(res, 500, { error: String(e.message || e) })
    }
    return
  }

  // 轻量摘要（无轨迹点）—— 浏览器应使用此接口，勿再拉 /api/tracks
  if (url.pathname === '/api/summary') {
    try {
      if (USE_ADB) {
        sendJson(res, 501, { error: 'adb 模式不支持摘要缓存' })
        return
      }
      const bundle = getBundle()
      sendGzipJson(req, res, buildSummary(bundle))
    } catch (e) {
      sendJson(res, e.status || 500, { error: String(e.message || e) })
    }
    return
  }

  // 地图 GeoJSON（服务端合并/筛选/抽稀）
  if (url.pathname === '/api/map') {
    try {
      if (USE_ADB) {
        sendJson(res, 501, { error: 'adb 模式不支持地图缓存' })
        return
      }
      const bundle = getBundle()
      const q = parseTimeQuery(url)
      const geo = buildMapGeoJSON(bundle, q)
      sendGzipJson(req, res, geo)
    } catch (e) {
      sendJson(res, e.status || 500, { error: String(e.message || e) })
    }
    return
  }

  // 筛选后的概览统计
  if (url.pathname === '/api/stats') {
    try {
      if (USE_ADB) {
        sendJson(res, 501, { error: 'adb 模式不支持' })
        return
      }
      const bundle = getBundle()
      const q = parseTimeQuery(url)
      sendJson(res, 200, buildFilteredStats(bundle, q))
    } catch (e) {
      sendJson(res, e.status || 500, { error: String(e.message || e) })
    }
    return
  }

  // 兼容旧接口：整包轨迹（体积巨大，容易弄崩浏览器，不推荐）
  if (url.pathname === '/api/tracks') {
    try {
      if (USE_ADB) {
        sendJson(res, 501, {
          error: 'adb 模式请改用逐文件 /api/gpx',
        })
        return
      }
      ensureCache()
      if (!fs.existsSync(BUNDLE_PATH)) {
        sendJson(res, 500, { error: '缓存构建失败' })
        return
      }
      sendGzipJsonFile(req, res, BUNDLE_PATH)
    } catch (e) {
      sendJson(res, 500, { error: String(e.message || e) })
    }
    return
  }

  if (url.pathname === '/api/gpx') {
    try {
      sendJson(res, 200, { dir: gpxDirLabel, files: listGpxFiles() })
    } catch (e) {
      sendJson(res, 500, { error: String(e.message || e) })
    }
    return
  }

  const fileMatch = url.pathname.match(/^\/api\/gpx\/([^/]+)$/)
  if (fileMatch) {
    try {
      const buf = readGpxFile(decodeURIComponent(fileMatch[1]))
      res.writeHead(200, {
        'Content-Type': 'application/gpx+xml; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(buf)
    } catch (e) {
      sendJson(res, e.status || 500, { error: String(e.message || e) })
    }
    return
  }

  serveStatic(req, res, url.pathname)
})

server.listen(PORT, '0.0.0.0', () => {
  let files = []
  try {
    files = listGpxFiles()
  } catch (e) {
    console.error('[迹] 列出 GPX 失败:', e.message || e)
  }
  console.log(`[迹 Trace] http://0.0.0.0:${PORT}`)
  console.log(`[迹 Trace] mode=${USE_ADB ? 'adb' : 'local'} dir=${gpxDirLabel}`)
  console.log(`[迹 Trace] ${files.length} gpx files`)

  // 启动后后台预热缓存，避免首次打开网页卡很久
  if (!USE_ADB && files.length) {
    setImmediate(() => {
      try {
        const r = ensureCache()
        console.log(`[迹 Trace] 缓存状态: ${r}`)
      } catch (e) {
        console.error('[迹 Trace] 缓存预热失败:', e.message || e)
        cacheState.building = false
        cacheState.error = String(e.message || e)
      }
    })
  }
})
