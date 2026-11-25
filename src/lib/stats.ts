import { haversine } from './geo'
import type { TrackPoint, TrackStats } from '../types'

const ELE_SMOOTH = 3
const MIN_MOVE_M = 2
const MAX_SPEED_KMH = 200

export function enrichDistances(
  raw: Omit<TrackPoint, 'distance'>[],
): TrackPoint[] {
  const points: TrackPoint[] = []
  let dist = 0
  for (let i = 0; i < raw.length; i++) {
    if (i > 0) {
      dist += haversine(
        raw[i - 1].lat,
        raw[i - 1].lon,
        raw[i].lat,
        raw[i].lon,
      )
    }
    points.push({ ...raw[i], distance: dist })
  }
  return points
}

function smoothElevations(points: TrackPoint[]): (number | undefined)[] {
  const eles = points.map((p) => p.ele)
  return eles.map((ele, i) => {
    if (ele == null) return undefined
    let sum = 0
    let n = 0
    for (
      let j = Math.max(0, i - ELE_SMOOTH);
      j <= Math.min(eles.length - 1, i + ELE_SMOOTH);
      j++
    ) {
      const v = eles[j]
      if (v != null) {
        sum += v
        n++
      }
    }
    return n > 0 ? sum / n : ele
  })
}

export function computeStats(points: TrackPoint[]): TrackStats {
  if (points.length === 0) {
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

  const distanceKm = points[points.length - 1].distance / 1000
  const smoothed = smoothElevations(points)

  let elevGain = 0
  let elevLoss = 0
  let elevMin: number | null = null
  let elevMax: number | null = null

  for (let i = 0; i < smoothed.length; i++) {
    const e = smoothed[i]
    if (e == null) continue
    elevMin = elevMin == null ? e : Math.min(elevMin, e)
    elevMax = elevMax == null ? e : Math.max(elevMax, e)
    if (i === 0) continue
    const prev = smoothed[i - 1]
    if (prev == null) continue
    const d = e - prev
    if (d > 0.5) elevGain += d
    else if (d < -0.5) elevLoss += -d
  }

  const startMs = points[0].timeMs ?? points[0].time?.getTime()
  const endMs =
    points[points.length - 1].timeMs ?? points[points.length - 1].time?.getTime()
  const startTime = startMs != null ? new Date(startMs) : null
  const endTime = endMs != null ? new Date(endMs) : null
  let durationMs: number | null = null
  if (startMs != null && endMs != null) {
    durationMs = endMs - startMs
    if (durationMs < 0) durationMs = null
  }

  let maxSpeedKmh: number | null = null
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const ta = a.timeMs ?? a.time?.getTime()
    const tb = b.timeMs ?? b.time?.getTime()
    if (ta == null || tb == null) continue
    const dt = (tb - ta) / 1000
    if (dt <= 0) continue
    const dd = b.distance - a.distance
    if (dd < MIN_MOVE_M) continue
    const speed = (dd / dt) * 3.6
    if (speed > MAX_SPEED_KMH) continue
    maxSpeedKmh = maxSpeedKmh == null ? speed : Math.max(maxSpeedKmh, speed)
  }

  let avgSpeedKmh: number | null = null
  if (durationMs && durationMs > 0) {
    avgSpeedKmh = distanceKm / (durationMs / 3600000)
  }

  return {
    distanceKm,
    elevGainM: elevGain,
    elevLossM: elevLoss,
    elevMinM: elevMin,
    elevMaxM: elevMax,
    durationMs,
    avgSpeedKmh,
    maxSpeedKmh,
    pointCount: points.length,
    startTime,
    endTime,
  }
}
