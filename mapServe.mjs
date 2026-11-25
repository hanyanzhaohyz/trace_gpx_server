/**
 * 服务端地图/摘要：浏览器只拿轻量数据，避免整包轨迹点水合导致 OOM。
 */
const YEAR_COLORS = [
  '#0B6E4F', // 2020 / 2026
  '#C45D3A', // 2021
  '#2E5090', // 2022
  '#B8860B', // 2023
  '#6B3FA0', // 2024
  '#C2185B', // 2025
]

const SPEED_CLASS_COLOR = {
  walk: '#0B6E4F',
  car: '#1D4ED8',
  plane: '#C2410C',
  unknown: '#6B7280',
}

const SPEED_BUCKETS = ['walk', 'car', 'plane', 'unknown']
const SPEED_LABEL = {
  walk: '步行',
  car: '驾车',
  plane: '飞行',
  unknown: '未知',
}

const MAX_GAP_MS = 30 * 60 * 1000
const MIN_DT_MS = 800
/** 地图单次返回上限，超出做网格抽稀，防止浏览器再崩 */
const MAX_DISPLAY_POINTS = 320000

function yearFromFileName(fileName) {
  const base = String(fileName || '').replace(/\.[^.]+$/i, '')
  const m = base.match(/(?:^|\D)(20\d{2}|19\d{2})/)
  if (!m) return null
  const year = Number(m[1])
  if (year < 1990 || year > 2100) return null
  return year
}

function colorForYear(year) {
  if (year == null || !Number.isFinite(year)) return '#8b95a8'
  const idx =
    ((year - 2020) % YEAR_COLORS.length + YEAR_COLORS.length) %
    YEAR_COLORS.length
  return YEAR_COLORS[idx]
}

function classifySpeedKmh(kmh) {
  if (kmh == null || !Number.isFinite(kmh) || kmh < 0) return 'unknown'
  if (kmh < 6) return 'walk'
  if (kmh <= 140) return 'car'
  return 'plane'
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const toRad = Math.PI / 180
  const dLat = (lat2 - lat1) * toRad
  const dLon = (lon2 - lon1) * toRad
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function q5(n) {
  return Math.round(n * 1e5) / 1e5
}

function inTime(t, startMs, endMs) {
  if (startMs == null && endMs == null) return true
  if (t == null || !(t > 0)) return startMs == null && endMs == null
  if (startMs != null && t < startMs) return false
  if (endMs != null && t > endMs) return false
  return true
}

/** 网格抽稀：保证地理覆盖，控制点数 */
function gridThin(coords, maxN) {
  if (coords.length <= maxN) return coords
  let lo = 0.00008
  let hi = 0.08
  let best = coords
  for (let iter = 0; iter < 18; iter++) {
    const cell = (lo + hi) / 2
    const seen = new Set()
    const out = []
    for (let i = 0; i < coords.length; i++) {
      const lon = coords[i][0]
      const lat = coords[i][1]
      const key =
        ((Math.round(lon / cell) * 73856093) ^
          (Math.round(lat / cell) * 19349663)) >>>
        0
      if (seen.has(key)) continue
      seen.add(key)
      out.push(coords[i])
      if (out.length > maxN) break
    }
    if (out.length > maxN) {
      lo = cell
    } else {
      hi = cell
      best = out
    }
  }
  return best
}

function thinBuckets(buckets, maxTotal) {
  let total = 0
  for (const id of Object.keys(buckets)) total += buckets[id].length
  if (total <= maxTotal) return buckets
  const out = {}
  for (const id of Object.keys(buckets)) {
    const arr = buckets[id]
    const share = Math.max(1000, Math.floor((arr.length / total) * maxTotal))
    out[id] = gridThin(arr, share)
  }
  return out
}

function emptyStats() {
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
    trackCount: 0,
  }
}

function mergeStats(acc, s) {
  if (!s) return
  acc.distanceKm += s.distanceKm || 0
  acc.elevGainM += s.elevGainM || 0
  acc.elevLossM += s.elevLossM || 0
  acc.pointCount += s.pointCount || 0
  if (s.elevMinM != null) {
    acc.elevMinM =
      acc.elevMinM == null ? s.elevMinM : Math.min(acc.elevMinM, s.elevMinM)
  }
  if (s.elevMaxM != null) {
    acc.elevMaxM =
      acc.elevMaxM == null ? s.elevMaxM : Math.max(acc.elevMaxM, s.elevMaxM)
  }
  if (s.maxSpeedKmh != null) {
    acc.maxSpeedKmh =
      acc.maxSpeedKmh == null
        ? s.maxSpeedKmh
        : Math.max(acc.maxSpeedKmh, s.maxSpeedKmh)
  }
  if (s.durationMs != null && s.durationMs > 0) {
    acc.durationMs = (acc.durationMs || 0) + s.durationMs
  }
  if (s.startTime != null) {
    const t = typeof s.startTime === 'number' ? s.startTime : Number(s.startTime)
    if (Number.isFinite(t)) {
      acc.startTime =
        acc.startTime == null ? t : Math.min(acc.startTime, t)
    }
  }
  if (s.endTime != null) {
    const t = typeof s.endTime === 'number' ? s.endTime : Number(s.endTime)
    if (Number.isFinite(t)) {
      acc.endTime = acc.endTime == null ? t : Math.max(acc.endTime, t)
    }
  }
  acc.trackCount += 1
}

function finalizeStats(acc) {
  const durationMs = acc.durationMs
  const avgSpeedKmh =
    durationMs && durationMs > 0
      ? acc.distanceKm / (durationMs / 3600000)
      : null
  return {
    ...acc,
    avgSpeedKmh,
  }
}

/**
 * 轻量摘要：不含轨迹点
 */
export function buildSummary(bundle) {
  const yearsSet = new Set()
  let minT = null
  let maxT = null
  let pointCount = 0
  const overview = emptyStats()

  const tracks = (bundle.tracks || []).map((t) => {
    const year = yearFromFileName(t.fileName)
    if (year != null) yearsSet.add(year)
    const s = t.stats || {}
    pointCount += s.pointCount || (t.points ? t.points.length : 0)
    if (s.startTime != null) {
      const st = Number(s.startTime)
      if (st > 0) minT = minT == null ? st : Math.min(minT, st)
    }
    if (s.endTime != null) {
      const et = Number(s.endTime)
      if (et > 0) maxT = maxT == null ? et : Math.max(maxT, et)
    }
    mergeStats(overview, s)
    return {
      fileName: t.fileName,
      name: t.name,
      size: t.size,
      mtime: t.mtime,
      year,
      stats: s,
    }
  })

  return {
    v: 2,
    dir: bundle.dir,
    builtAt: bundle.builtAt,
    trackCount: tracks.length,
    pointCount,
    years: [...yearsSet].sort((a, b) => a - b),
    timeSpan: { min: minT, max: maxT },
    overviewStats: finalizeStats(overview),
    tracks,
    errors: bundle.errors || [],
  }
}

function trackMatchesYear(fileName, yearFilter) {
  if (yearFilter == null) return true
  return yearFromFileName(fileName) === yearFilter
}

/**
 * 构建地图 GeoJSON（合并 MultiPoint），可选时间/年/速度筛选 + 抽稀
 */
export function buildMapGeoJSON(bundle, opts = {}) {
  const mode = opts.mode === 'speed' ? 'speed' : 'year'
  const startMs = opts.startMs ?? null
  const endMs = opts.endMs ?? null
  const yearFilter = opts.year ?? null
  const speedOnly = opts.speedClass || null

  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  let rawCount = 0

  const bump = (lon, lat) => {
    if (lon < minLon) minLon = lon
    if (lat < minLat) minLat = lat
    if (lon > maxLon) maxLon = lon
    if (lat > maxLat) maxLat = lat
  }

  if (mode === 'year') {
    const byYear = new Map()
    for (const track of bundle.tracks || []) {
      const y = yearFromFileName(track.fileName)
      if (y == null) continue
      if (!trackMatchesYear(track.fileName, yearFilter)) continue
      let arr = byYear.get(y)
      if (!arr) {
        arr = []
        byYear.set(y, arr)
      }
      const pts = track.points || []
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]
        const t = p[2]
        if (!inTime(t, startMs, endMs)) continue
        const lat = p[0]
        const lon = p[1]
        arr.push([q5(lon), q5(lat)])
        bump(lon, lat)
        rawCount += 1
      }
    }

    // 抽稀
    let total = 0
    for (const arr of byYear.values()) total += arr.length
    if (total > MAX_DISPLAY_POINTS) {
      for (const [y, arr] of byYear) {
        const share = Math.max(
          2000,
          Math.floor((arr.length / total) * MAX_DISPLAY_POINTS),
        )
        byYear.set(y, gridThin(arr, share))
      }
    }

    const features = []
    let displayCount = 0
    for (const [y, coords] of byYear) {
      if (!coords.length) continue
      displayCount += coords.length
      features.push({
        type: 'Feature',
        properties: {
          kind: 'year',
          year: y,
          color: colorForYear(y),
          name: String(y),
          pointCount: coords.length,
        },
        geometry: { type: 'MultiPoint', coordinates: coords },
      })
    }

    return {
      type: 'FeatureCollection',
      features,
      bbox:
        Number.isFinite(minLon) && Number.isFinite(minLat)
          ? [minLon, minLat, maxLon, maxLat]
          : null,
      meta: {
        mode: 'year',
        rawPointCount: rawCount,
        displayPointCount: displayCount,
        thinned: rawCount > displayCount,
      },
    }
  }

  // speed
  let buckets = {
    walk: [],
    car: [],
    plane: [],
    unknown: [],
  }

  for (const track of bundle.tracks || []) {
    if (!trackMatchesYear(track.fileName, yearFilter)) continue
    const pts = track.points || []
    if (pts.length < 1) continue

    let prevCls = 'unknown'
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      const t = p[2]
      if (!inTime(t, startMs, endMs)) continue

      let cls = 'unknown'
      if (i > 0) {
        const a = pts[i - 1]
        const ta = a[2]
        const tb = t
        if (ta > 0 && tb > 0) {
          const dt = tb - ta
          if (dt >= MIN_DT_MS && dt <= MAX_GAP_MS) {
            const km = haversineM(a[0], a[1], p[0], p[1]) / 1000
            cls = classifySpeedKmh(km / (dt / 3600000))
          }
        }
      } else {
        cls = prevCls
      }
      if (i === 0 && pts.length > 1) {
        // 稍后用下一个有效点；先 unknown
      }
      if (speedOnly && cls !== speedOnly) {
        prevCls = cls
        continue
      }
      const lon = q5(p[1])
      const lat = q5(p[0])
      buckets[cls].push([lon, lat])
      bump(p[1], p[0])
      rawCount += 1
      prevCls = cls
    }
  }

  buckets = thinBuckets(buckets, MAX_DISPLAY_POINTS)

  const features = []
  let displayCount = 0
  for (const id of SPEED_BUCKETS) {
    if (speedOnly && id !== speedOnly) continue
    const coords = buckets[id]
    if (!coords.length) continue
    displayCount += coords.length
    features.push({
      type: 'Feature',
      properties: {
        kind: 'speed',
        speedClass: id,
        color: SPEED_CLASS_COLOR[id],
        pointCount: coords.length,
        name: SPEED_LABEL[id],
      },
      geometry: { type: 'MultiPoint', coordinates: coords },
    })
  }

  return {
    type: 'FeatureCollection',
    features,
    bbox:
      Number.isFinite(minLon) && Number.isFinite(minLat)
        ? [minLon, minLat, maxLon, maxLat]
        : null,
    meta: {
      mode: 'speed',
      rawPointCount: rawCount,
      displayPointCount: displayCount,
      thinned: rawCount > displayCount,
    },
  }
}

/**
 * 按筛选汇总统计（年筛选用文件 stats；有时间/速度筛选则扫点）
 */
export function buildFilteredStats(bundle, opts = {}) {
  const startMs = opts.startMs ?? null
  const endMs = opts.endMs ?? null
  const yearFilter = opts.year ?? null
  const speedOnly = opts.speedClass || null
  const needPointWalk = startMs != null || endMs != null || speedOnly != null

  const acc = emptyStats()

  if (!needPointWalk) {
    for (const track of bundle.tracks || []) {
      if (!trackMatchesYear(track.fileName, yearFilter)) continue
      mergeStats(acc, track.stats)
    }
    return finalizeStats(acc)
  }

  for (const track of bundle.tracks || []) {
    if (!trackMatchesYear(track.fileName, yearFilter)) continue
    const pts = track.points || []
    let distM = 0
    let elevGain = 0
    let elevLoss = 0
    let elevMin = null
    let elevMax = null
    let maxSpeed = null
    let pointCount = 0
    let firstT = null
    let lastT = null
    let prev = null
    let prevCls = 'unknown'

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      const t = p[2]
      if (!inTime(t, startMs, endMs)) {
        prev = null
        continue
      }

      let cls = 'unknown'
      if (prev) {
        const dt = t > 0 && prev.t > 0 ? t - prev.t : 0
        if (dt >= MIN_DT_MS && dt <= MAX_GAP_MS) {
          const km = haversineM(prev.lat, prev.lon, p[0], p[1]) / 1000
          const kmh = km / (dt / 3600000)
          cls = classifySpeedKmh(kmh)
          if (maxSpeed == null || kmh > maxSpeed) maxSpeed = kmh
        } else if (dt > 0 && dt < MIN_DT_MS) {
          cls = prevCls
        }
      }

      if (speedOnly && cls !== speedOnly && !(prev == null && !speedOnly)) {
        // 速度筛选：首点没有速度时，等有分类再算
        if (speedOnly && cls !== speedOnly) {
          if (cls !== 'unknown' || prev) {
            prev = { lat: p[0], lon: p[1], t, ele: p[3] }
            prevCls = cls
            continue
          }
        }
      }
      if (speedOnly && cls !== speedOnly) {
        prev = { lat: p[0], lon: p[1], t, ele: p[3] }
        prevCls = cls
        continue
      }

      pointCount += 1
      if (t > 0) {
        firstT = firstT == null ? t : Math.min(firstT, t)
        lastT = lastT == null ? t : Math.max(lastT, t)
      }
      const ele = p[3]
      if (ele != null) {
        elevMin = elevMin == null ? ele : Math.min(elevMin, ele)
        elevMax = elevMax == null ? ele : Math.max(elevMax, ele)
        if (prev && prev.ele != null) {
          const dEle = ele - prev.ele
          if (dEle > 0) elevGain += dEle
          else elevLoss += -dEle
        }
      }
      if (prev) {
        distM += haversineM(prev.lat, prev.lon, p[0], p[1])
      }
      prev = { lat: p[0], lon: p[1], t, ele }
      prevCls = cls
    }

    if (pointCount < 1) continue
    mergeStats(acc, {
      distanceKm: distM / 1000,
      elevGainM: elevGain,
      elevLossM: elevLoss,
      elevMinM: elevMin,
      elevMaxM: elevMax,
      durationMs:
        firstT != null && lastT != null && lastT > firstT
          ? lastT - firstT
          : null,
      maxSpeedKmh: maxSpeed,
      pointCount,
      startTime: firstT,
      endTime: lastT,
    })
  }

  return finalizeStats(acc)
}

export function parseTimeQuery(url) {
  const start = url.searchParams.get('start') || ''
  const end = url.searchParams.get('end') || ''
  let startMs = null
  let endMs = null
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    const [y, m, d] = start.split('-').map(Number)
    startMs = new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    const [y, m, d] = end.split('-').map(Number)
    endMs = new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
  }
  const yearRaw = url.searchParams.get('year')
  const year = yearRaw ? Number(yearRaw) : null
  const speedClass = url.searchParams.get('speed') || null
  const mode = url.searchParams.get('mode') === 'speed' ? 'speed' : 'year'
  return {
    mode,
    startMs,
    endMs,
    year: Number.isFinite(year) ? year : null,
    speedClass:
      speedClass && SPEED_BUCKETS.includes(speedClass) ? speedClass : null,
  }
}
