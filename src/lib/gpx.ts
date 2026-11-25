import { enrichDistances, computeStats } from './stats'
import { colorForTrackYear } from './yearColor'
import type { GpsTrack, TrackPoint, Waypoint } from '../types'

/**
 * GPSLogger 等 App 导出的 GPX 常见瑕疵：
 * - 文件中夹杂 \0 空字节（设备写入缓冲）
 * - 提前写了 </gpx> 后又继续追加 trkpt，形成「多段拼接」
 * 严格 DOMParser 会失败；灵感足迹等 App 用宽松解析。这里清洗 + 正则抽点。
 */
function sanitizeGpxText(raw: string): string {
  // 去掉非法 XML 控制字符（保留 \t \n \r）
  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

function parseAttrNumber(tag: string, name: string): number | undefined {
  const re = new RegExp(`${name}\\s*=\\s*["']([-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)["']`, 'i')
  const m = tag.match(re)
  if (!m) return undefined
  const n = Number(m[1])
  return Number.isFinite(n) ? n : undefined
}

function parseInnerTag(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const m = block.match(re)
  const t = m?.[1]?.trim()
  return t || undefined
}

function parseTimeString(t: string | undefined): Date | undefined {
  if (!t) return undefined
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? undefined : d
}

function parseTimeMs(t: string | undefined): number | undefined {
  if (!t) return undefined
  const ms = Date.parse(t)
  return Number.isFinite(ms) ? ms : undefined
}

function extractName(text: string, fileName: string): string {
  const fromTrk = text.match(/<trk\b[^>]*>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>/i)
  if (fromTrk?.[1]?.trim()) return fromTrk[1].trim()
  const fromMeta = text.match(/<metadata\b[^>]*>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>/i)
  if (fromMeta?.[1]?.trim()) return fromMeta[1].trim()
  const fromRte = text.match(/<rte\b[^>]*>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>/i)
  if (fromRte?.[1]?.trim()) return fromRte[1].trim()
  return fileName.replace(/\.gpx$/i, '')
}

function extractPointsByTag(
  text: string,
  tag: 'trkpt' | 'rtept' | 'wpt',
): Omit<TrackPoint, 'distance'>[] {
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>|<${tag}\\b([^>]*)/>`, 'gi')
  const out: Omit<TrackPoint, 'distance'>[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const attrs = m[1] ?? m[3] ?? ''
    const body = m[2] ?? ''
    const lat = parseAttrNumber(attrs, 'lat')
    const lon = parseAttrNumber(attrs, 'lon')
    if (lat == null || lon == null) continue
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue
    const eleRaw = parseInnerTag(body, 'ele')
    const ele = eleRaw != null ? Number(eleRaw) : undefined
    out.push({
      lat,
      lon,
      ele: ele != null && Number.isFinite(ele) ? ele : undefined,
      timeMs: parseTimeMs(parseInnerTag(body, 'time')),
    })
  }
  return out
}

function extractWaypoints(text: string): Waypoint[] {
  const re = /<wpt\b([^>]*)>([\s\S]*?)<\/wpt>|<wpt\b([^>]*)\/>/gi
  const out: Waypoint[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const attrs = m[1] ?? m[3] ?? ''
    const body = m[2] ?? ''
    const lat = parseAttrNumber(attrs, 'lat')
    const lon = parseAttrNumber(attrs, 'lon')
    if (lat == null || lon == null) continue
    const eleRaw = parseInnerTag(body, 'ele')
    const ele = eleRaw != null ? Number(eleRaw) : undefined
    out.push({
      lat,
      lon,
      name: parseInnerTag(body, 'name'),
      desc: parseInnerTag(body, 'desc'),
      ele: ele != null && Number.isFinite(ele) ? ele : undefined,
      time: parseTimeString(parseInnerTag(body, 'time')),
    })
  }
  return out
}

function collectRawPoints(text: string): Omit<TrackPoint, 'distance'>[] {
  const trk = extractPointsByTag(text, 'trkpt')
  if (trk.length >= 2) return trk
  const rte = extractPointsByTag(text, 'rtept')
  if (rte.length >= 2) return rte
  return extractPointsByTag(text, 'wpt')
}

export function parseGpx(xml: string, fileName: string): GpsTrack {
  const text = sanitizeGpxText(xml)
  if (!/<gpx\b/i.test(text) && !/<trkpt\b/i.test(text) && !/<rtept\b/i.test(text)) {
    throw new Error('不是有效的 GPX 文件')
  }

  const name = extractName(text, fileName)
  const rawPoints = collectRawPoints(text)
  if (rawPoints.length < 2) {
    throw new Error('轨迹点不足，至少需要 2 个有效坐标点')
  }

  // 全量保留，不做任何抽稀
  const points = enrichDistances(rawPoints)
  const stats = computeStats(points)
  const waypoints = extractWaypoints(text)
  const trackDraft = {
    id: `track-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    fileName,
    points,
    waypoints,
    stats,
    color: '#8b95a8',
    pointSize: 2,
    visible: true,
    createdAt: Date.now(),
  } satisfies GpsTrack
  trackDraft.color = colorForTrackYear(trackDraft)
  return trackDraft
}

export async function parseGpxFile(file: File): Promise<GpsTrack> {
  const text = await file.text()
  return parseGpx(text, file.name)
}

export function tracksToBounds(
  tracks: GpsTrack[],
): [[number, number], [number, number]] | null {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  let any = false

  for (const t of tracks) {
    if (!t.visible) continue
    for (const p of t.points) {
      any = true
      minLon = Math.min(minLon, p.lon)
      minLat = Math.min(minLat, p.lat)
      maxLon = Math.max(maxLon, p.lon)
      maxLat = Math.max(maxLat, p.lat)
    }
    for (const w of t.waypoints) {
      any = true
      minLon = Math.min(minLon, w.lon)
      minLat = Math.min(minLat, w.lat)
      maxLon = Math.max(maxLon, w.lon)
      maxLat = Math.max(maxLat, w.lat)
    }
  }

  if (!any) return null
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ]
}

/**
 * 全量轨迹点 → 单个 MultiPoint（不丢点、不抽稀）。
 * 疏密完全由原始采样决定：等时间记录下，飞机点间距大、走路点间距小。
 */
export function trackToGeoJSON(track: GpsTrack): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [
    {
      type: 'Feature',
      properties: {
        kind: 'track',
        trackId: track.id,
        name: track.name,
        color: track.color,
        pointSize: track.pointSize,
        pointCount: track.points.length,
      },
      geometry: {
        type: 'MultiPoint',
        coordinates: track.points.map((p) => [p.lon, p.lat]),
      },
    },
  ]

  for (const w of track.waypoints) {
    features.push({
      type: 'Feature',
      properties: {
        kind: 'waypoint',
        trackId: track.id,
        name: w.name || '路点',
        desc: w.desc || '',
        color: track.color,
      },
      geometry: { type: 'Point', coordinates: [w.lon, w.lat] },
    })
  }

  return { type: 'FeatureCollection', features }
}
