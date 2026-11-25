/** 服务端 GPX 宽松解析（与前端 src/lib/gpx.ts 对齐） */

const R = 6371000

function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

function sanitizeGpxText(raw) {
  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

function parseAttrNumber(tag, name) {
  const re = new RegExp(
    `${name}\\s*=\\s*["']([-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)["']`,
    'i',
  )
  const m = tag.match(re)
  if (!m) return undefined
  const n = Number(m[1])
  return Number.isFinite(n) ? n : undefined
}

function parseInnerTag(block, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const m = block.match(re)
  const t = m?.[1]?.trim()
  return t || undefined
}

function parseTimeMs(t) {
  if (!t) return 0
  const d = Date.parse(t)
  return Number.isFinite(d) ? d : 0
}

function extractName(text, fileName) {
  const fromTrk = text.match(
    /<trk\b[^>]*>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>/i,
  )
  if (fromTrk?.[1]?.trim()) return fromTrk[1].trim()
  const fromMeta = text.match(
    /<metadata\b[^>]*>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>/i,
  )
  if (fromMeta?.[1]?.trim()) return fromMeta[1].trim()
  const fromRte = text.match(
    /<rte\b[^>]*>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>/i,
  )
  if (fromRte?.[1]?.trim()) return fromRte[1].trim()
  return fileName.replace(/\.gpx$/i, '')
}

function extractPointsByTag(text, tag) {
  const re = new RegExp(
    `<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>|<${tag}\\b([^>]*)/>`,
    'gi',
  )
  const out = []
  let m
  while ((m = re.exec(text))) {
    const attrs = m[1] ?? m[3] ?? ''
    const body = m[2] ?? ''
    const lat = parseAttrNumber(attrs, 'lat')
    const lon = parseAttrNumber(attrs, 'lon')
    if (lat == null || lon == null) continue
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue
    const eleRaw = parseInnerTag(body, 'ele')
    const ele = eleRaw != null ? Number(eleRaw) : NaN
    out.push({
      lat,
      lon,
      ele: Number.isFinite(ele) ? ele : null,
      t: parseTimeMs(parseInnerTag(body, 'time')),
    })
  }
  return out
}

function collectRawPoints(text) {
  const trk = extractPointsByTag(text, 'trkpt')
  if (trk.length >= 2) return trk
  const rte = extractPointsByTag(text, 'rtept')
  if (rte.length >= 2) return rte
  return extractPointsByTag(text, 'wpt')
}

function enrich(raw) {
  const points = []
  let dist = 0
  for (let i = 0; i < raw.length; i++) {
    if (i > 0) {
      dist += haversine(raw[i - 1].lat, raw[i - 1].lon, raw[i].lat, raw[i].lon)
    }
    points.push([raw[i].lat, raw[i].lon, raw[i].t || 0, raw[i].ele, dist])
  }
  return points
}

function computeStats(points) {
  if (!points.length) {
    return {
      distanceKm: 0,
      elevGainM: 0,
      elevLossM: 0,
      elevMinM: null,
      elevMaxM: null,
      durationMs: null,
      avgSpeedKmh: null,
      maxSpeedKmh: null,
      pointCount: 0,
      startTime: null,
      endTime: null,
    }
  }
  const distanceKm = points[points.length - 1][4] / 1000
  let elevMin = null
  let elevMax = null
  let elevGain = 0
  let elevLoss = 0
  let prevEle = null
  for (const p of points) {
    const e = p[3]
    if (e == null) continue
    elevMin = elevMin == null ? e : Math.min(elevMin, e)
    elevMax = elevMax == null ? e : Math.max(elevMax, e)
    if (prevEle != null) {
      const d = e - prevEle
      if (d > 1) elevGain += d
      else if (d < -1) elevLoss += -d
    }
    prevEle = e
  }
  // 大文件可能有上百万点，禁止 Math.min(...arr) 展开，会撑爆调用栈
  let startTime = null
  let endTime = null
  for (const p of points) {
    const t = p[2]
    if (!(t > 0)) continue
    if (startTime == null || t < startTime) startTime = t
    if (endTime == null || t > endTime) endTime = t
  }
  const durationMs =
    startTime != null && endTime != null ? endTime - startTime : null
  const avgSpeedKmh =
    durationMs && durationMs > 0 ? distanceKm / (durationMs / 3600000) : null
  return {
    distanceKm,
    elevGainM: elevGain,
    elevLossM: elevLoss,
    elevMinM: elevMin,
    elevMaxM: elevMax,
    durationMs,
    avgSpeedKmh,
    maxSpeedKmh: null,
    pointCount: points.length,
    startTime,
    endTime,
  }
}

/**
 * @returns {{ fileName: string, name: string, points: any[], stats: object } | null}
 */
export function parseGpxToCached(xml, fileName) {
  const text = sanitizeGpxText(xml)
  if (
    !/<gpx\b/i.test(text) &&
    !/<trkpt\b/i.test(text) &&
    !/<rtept\b/i.test(text)
  ) {
    return null
  }
  const raw = collectRawPoints(text)
  if (raw.length < 2) return null
  const points = enrich(raw)
  return {
    fileName,
    name: extractName(text, fileName),
    points,
    stats: computeStats(points),
    waypoints: [],
  }
}
