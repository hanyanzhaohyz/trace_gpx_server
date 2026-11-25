import { computeTrackSpeedClasses } from './buildMapData'
import type { ColorFilter } from './colorFilter'
import { computeStats, enrichDistances } from './stats'
import type { PointColorMode } from './speedClass'
import type { GpsTrack, TrackPoint, TrackStats } from '../types'

function emptyStats(): TrackStats {
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

/** 按当前地图筛选条件汇总可见轨迹统计（总里程等） */
export function aggregateVisibleStats(
  tracks: GpsTrack[],
  colorMode: PointColorMode,
  colorFilter: ColorFilter,
): TrackStats & { trackCount: number } {
  const visible = tracks.filter((t) => t.visible)
  if (!visible.length) {
    return { ...emptyStats(), trackCount: 0 }
  }

  const speedOnly =
    colorMode === 'speed' && colorFilter?.kind === 'speed'
      ? colorFilter.speedClass
      : null

  let distanceKm = 0
  let elevGainM = 0
  let elevLossM = 0
  let elevMinM: number | null = null
  let elevMaxM: number | null = null
  let pointCount = 0
  let startMs: number | null = null
  let endMs: number | null = null
  let durationSum = 0
  let hasDuration = false
  let maxSpeedKmh: number | null = null
  let trackCount = 0

  for (const track of visible) {
    let points: TrackPoint[] = track.points
    if (speedOnly) {
      const classes = computeTrackSpeedClasses(track)
      const raw: Omit<TrackPoint, 'distance'>[] = []
      for (let i = 0; i < points.length; i++) {
        if (classes[i] !== speedOnly) continue
        const p = points[i]
        raw.push({
          lat: p.lat,
          lon: p.lon,
          ele: p.ele,
          time: p.time,
          timeMs: p.timeMs,
        })
      }
      if (raw.length < 2) continue
      // 速度筛选后点可能不连续，按相邻筛选点累加距离
      points = enrichDistances(raw)
    } else if (points.length < 2) {
      continue
    }

    trackCount += 1
    const s = speedOnly ? computeStats(points) : track.stats
    // 无速度筛选时直接用已有 stats，避免重复计算；有筛选则用重算结果
    const use = speedOnly ? s : track.stats

    distanceKm += use.distanceKm
    elevGainM += use.elevGainM
    elevLossM += use.elevLossM
    pointCount += use.pointCount

    if (use.elevMinM != null) {
      elevMinM =
        elevMinM == null ? use.elevMinM : Math.min(elevMinM, use.elevMinM)
    }
    if (use.elevMaxM != null) {
      elevMaxM =
        elevMaxM == null ? use.elevMaxM : Math.max(elevMaxM, use.elevMaxM)
    }
    if (use.maxSpeedKmh != null) {
      maxSpeedKmh =
        maxSpeedKmh == null
          ? use.maxSpeedKmh
          : Math.max(maxSpeedKmh, use.maxSpeedKmh)
    }
    if (use.durationMs != null && use.durationMs > 0) {
      durationSum += use.durationMs
      hasDuration = true
    }
    if (use.startTime) {
      const t = use.startTime.getTime()
      startMs = startMs == null ? t : Math.min(startMs, t)
    }
    if (use.endTime) {
      const t = use.endTime.getTime()
      endMs = endMs == null ? t : Math.max(endMs, t)
    }
  }

  // 速度筛选路径下 distance 已由 enrichDistances 算准；
  // 无筛选时用各文件 stats.distanceKm 求和（各文件内部连续轨迹）
  if (speedOnly) {
    // 已在循环里累加 use.distanceKm
  }

  const durationMs = hasDuration ? durationSum : null
  const avgSpeedKmh =
    durationMs && durationMs > 0
      ? distanceKm / (durationMs / 3600000)
      : null

  return {
    distanceKm,
    elevGainM,
    elevLossM,
    elevMinM,
    elevMaxM,
    durationMs,
    avgSpeedKmh,
    maxSpeedKmh,
    pointCount,
    startTime: startMs != null ? new Date(startMs) : null,
    endTime: endMs != null ? new Date(endMs) : null,
    trackCount,
  }
}
