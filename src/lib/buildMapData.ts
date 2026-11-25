import { haversine } from './geo'
import type { ColorFilter } from './colorFilter'
import {
  colorForSpeed,
  classifySpeedKmh,
  type PointColorMode,
  type SpeedClassId,
} from './speedClass'
import { colorForYear, trackYear } from './yearColor'
import type { MapTone } from './palette'
import type { GpsTrack } from '../types'

const MAX_GAP_MS = 30 * 60 * 1000
const MIN_DT_MS = 800

const SPEED_BUCKETS: SpeedClassId[] = ['walk', 'car', 'plane', 'unknown']

const SPEED_LABEL: Record<SpeedClassId, string> = {
  walk: '步行',
  car: '驾车',
  plane: '飞行',
  unknown: '未知',
}

function pointTimeMs(p: {
  timeMs?: number
  time?: Date
}): number | undefined {
  if (p.timeMs != null && p.timeMs > 0) return p.timeMs
  if (p.time) return p.time.getTime()
  return undefined
}

/** 预计算每条轨迹各点速度类别（与 points 等长） */
export function computeTrackSpeedClasses(track: GpsTrack): SpeedClassId[] {
  const pts = track.points
  const n = pts.length
  const out: SpeedClassId[] = new Array(n)
  if (n === 0) return out
  out[0] = 'unknown'

  for (let i = 1; i < n; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const ta = pointTimeMs(a)
    const tb = pointTimeMs(b)
    if (ta == null || tb == null) {
      out[i] = out[i - 1]
      continue
    }
    const dt = tb - ta
    if (dt < MIN_DT_MS || dt > MAX_GAP_MS) {
      out[i] = 'unknown'
      continue
    }
    const km = haversine(a.lat, a.lon, b.lat, b.lon) / 1000
    const kmh = km / (dt / 3600000)
    out[i] = classifySpeedKmh(kmh)
  }
  if (n > 1 && out[0] === 'unknown') out[0] = out[1]
  return out
}

/**
 * 按速度档拆成多个 MultiPoint（单轨道路径，保留兼容）
 */
export function trackToSpeedGeoJSON(
  track: GpsTrack,
  classes: SpeedClassId[],
  onlyClass?: SpeedClassId | null,
  tone: MapTone = 'light',
): GeoJSON.FeatureCollection {
  const buckets: Record<SpeedClassId, [number, number][]> = {
    walk: [],
    car: [],
    plane: [],
    unknown: [],
  }

  const n = Math.min(track.points.length, classes.length)
  for (let i = 0; i < n; i++) {
    const cls = classes[i]
    if (onlyClass && cls !== onlyClass) continue
    const p = track.points[i]
    buckets[cls].push([p.lon, p.lat])
  }

  const features: GeoJSON.Feature[] = []
  for (const id of SPEED_BUCKETS) {
    if (onlyClass && id !== onlyClass) continue
    const coords = buckets[id]
    if (!coords.length) continue
    features.push({
      type: 'Feature',
      properties: {
        kind: 'speed',
        speedClass: id,
        trackId: track.id,
        color: colorForSpeed(id, tone),
        pointSize: track.pointSize,
        pointCount: coords.length,
        name: SPEED_LABEL[id],
      },
      geometry: { type: 'MultiPoint', coordinates: coords },
    })
  }

  return { type: 'FeatureCollection', features }
}

/**
 * 合并为少量 MultiPoint（按年或按速度），视觉与分文件上色一致，
 * 但只有 1 个 GeoJSON Source / 1 个图层，大幅减轻卡顿。
 */
export function buildMergedDisplayGeoJSON(
  tracks: GpsTrack[],
  colorMode: PointColorMode,
  colorFilter: ColorFilter,
  speedCache: Map<string, SpeedClassId[]>,
  tone: MapTone = 'light',
): GeoJSON.FeatureCollection {
  const visible = tracks.filter((t) => t.visible && t.points.length > 0)

  if (colorMode === 'year') {
    const byYear = new Map<number, [number, number][]>()
    for (const track of visible) {
      const y = trackYear(track)
      if (y == null) continue
      if (colorFilter?.kind === 'year' && colorFilter.year !== y) continue
      let arr = byYear.get(y)
      if (!arr) {
        arr = []
        byYear.set(y, arr)
      }
      for (const p of track.points) {
        arr.push([p.lon, p.lat])
      }
    }
    const features: GeoJSON.Feature[] = []
    for (const [y, coords] of byYear) {
      if (!coords.length) continue
      features.push({
        type: 'Feature',
        properties: {
          kind: 'year',
          year: y,
          color: colorForYear(y, tone),
          name: String(y),
          pointCount: coords.length,
        },
        geometry: { type: 'MultiPoint', coordinates: coords },
      })
    }
    return { type: 'FeatureCollection', features }
  }

  // speed：全局按速度分桶（步行 / 驾车 / 飞行）
  const buckets: Record<SpeedClassId, [number, number][]> = {
    walk: [],
    car: [],
    plane: [],
    unknown: [],
  }
  const speedOnly =
    colorFilter?.kind === 'speed' ? colorFilter.speedClass : null

  for (const track of visible) {
    let classes = speedCache.get(track.id)
    if (!classes || classes.length !== track.points.length) {
      classes = computeTrackSpeedClasses(track)
      speedCache.set(track.id, classes)
    }
    const n = Math.min(track.points.length, classes.length)
    for (let i = 0; i < n; i++) {
      const cls = classes[i]
      if (speedOnly && cls !== speedOnly) continue
      buckets[cls].push([track.points[i].lon, track.points[i].lat])
    }
  }

  const features: GeoJSON.Feature[] = []
  for (const id of SPEED_BUCKETS) {
    if (speedOnly && id !== speedOnly) continue
    const coords = buckets[id]
    if (!coords.length) continue
    features.push({
      type: 'Feature',
      properties: {
        kind: 'speed',
        speedClass: id,
        color: colorForSpeed(id, tone),
        pointCount: coords.length,
        name: SPEED_LABEL[id],
      },
      geometry: { type: 'MultiPoint', coordinates: coords },
    })
  }
  return { type: 'FeatureCollection', features }
}
