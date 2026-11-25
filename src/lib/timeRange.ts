import type { GpsTrack, TrackPoint, Waypoint } from '../types'
import { enrichDistances, computeStats } from './stats'

export interface TimeRange {
  /** date 字符串 YYYY-MM-DD，空表示不限制 */
  start: string
  end: string
}

export function emptyTimeRange(): TimeRange {
  return { start: '', end: '' }
}

export function hasTimeFilter(range: TimeRange): boolean {
  return Boolean(range.start || range.end)
}

function parseBound(value: string, endOfDay: boolean): number | null {
  if (!value) return null
  // 仅日期 YYYY-MM-DD（兼容旧的 datetime-local）
  const day = value.slice(0, 10)
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const d = Number(m[3])
  const dt = endOfDay
    ? new Date(y, mo, d, 23, 59, 59, 999)
    : new Date(y, mo, d, 0, 0, 0, 0)
  if (Number.isNaN(dt.getTime())) return null
  return dt.getTime()
}

function pointTimeMs(point: TrackPoint): number | null {
  if (point.timeMs != null && point.timeMs > 0) return point.timeMs
  if (point.time) return point.time.getTime()
  return null
}

export function pointInRange(point: TrackPoint, range: TimeRange): boolean {
  const t = pointTimeMs(point)
  if (t == null) return !hasTimeFilter(range)
  const start = parseBound(range.start, false)
  const end = parseBound(range.end, true)
  if (start != null && t < start) return false
  if (end != null && t > end) return false
  return true
}

export function waypointInRange(w: Waypoint, range: TimeRange): boolean {
  if (!hasTimeFilter(range)) return true
  if (!w.time) return true
  const t = w.time.getTime()
  const start = parseBound(range.start, false)
  const end = parseBound(range.end, true)
  if (start != null && t < start) return false
  if (end != null && t > end) return false
  return true
}

/** 按时间过滤轨迹点；无时间戳的点在启用筛选时会被隐藏 */
export function filterTrackByTime(track: GpsTrack, range: TimeRange): GpsTrack {
  if (!hasTimeFilter(range)) return track

  const raw = track.points
    .filter((p) => pointInRange(p, range))
    .map(({ lat, lon, ele, time, timeMs }) => ({ lat, lon, ele, time, timeMs }))

  if (raw.length === 0) {
    return {
      ...track,
      points: [],
      waypoints: track.waypoints.filter((w) => waypointInRange(w, range)),
      stats: {
        ...track.stats,
        distanceKm: 0,
        elevGainM: 0,
        elevLossM: 0,
        durationMs: null,
        avgSpeedKmh: null,
        maxSpeedKmh: null,
        pointCount: 0,
        startTime: null,
        endTime: null,
      },
    }
  }

  const points = enrichDistances(raw)
  return {
    ...track,
    points,
    waypoints: track.waypoints.filter((w) => waypointInRange(w, range)),
    stats: {
      ...computeStats(points),
      pointCount: points.length,
    },
  }
}

export function filterTracksByTime(
  tracks: GpsTrack[],
  range: TimeRange,
): GpsTrack[] {
  if (!hasTimeFilter(range)) return tracks
  return tracks.map((t) => filterTrackByTime(t, range))
}

/** 从已加载轨迹推断可选时间跨度，方便填默认值 */
export function inferTracksTimeSpan(tracks: GpsTrack[]): {
  min: Date | null
  max: Date | null
} {
  let min: number | null = null
  let max: number | null = null
  for (const t of tracks) {
    if (t.points.length) {
      for (const p of t.points) {
        const ms = p.timeMs ?? p.time?.getTime()
        if (ms == null || !(ms > 0)) continue
        min = min == null ? ms : Math.min(min, ms)
        max = max == null ? ms : Math.max(max, ms)
      }
    } else {
      // 摘要模式：无点，用文件级 stats
      const st = t.stats.startTime?.getTime()
      const et = t.stats.endTime?.getTime()
      if (st != null && st > 0) min = min == null ? st : Math.min(min, st)
      if (et != null && et > 0) max = max == null ? et : Math.max(max, et)
    }
  }
  return {
    min: min != null ? new Date(min) : null,
    max: max != null ? new Date(max) : null,
  }
}

export function toDateValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** @deprecated 兼容旧调用，等同 toDateValue */
export function toDatetimeLocalValue(d: Date): string {
  return toDateValue(d)
}

/** 今天的日期 */
export function todayDate(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export function sameTimeRange(a: TimeRange, b: TimeRange): boolean {
  return a.start === b.start && a.end === b.end
}

/** 快捷时间预设（滚动日；「本年」为当年 1/1 → 今天） */
export type TimePresetId =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'

export interface TimePreset {
  id: TimePresetId
  label: string
}

export const TIME_PRESETS: TimePreset[] = [
  { id: 'today', label: '今天' },
  { id: 'yesterday', label: '昨天' },
  { id: 'week', label: '最近一周' },
  { id: 'month', label: '最近一月' },
  { id: 'quarter', label: '最近三月' },
  { id: 'year', label: '本年' },
]

export function timeRangeFromPreset(id: TimePresetId, now = new Date()): TimeRange {
  const end = new Date(now)
  end.setHours(0, 0, 0, 0)
  const start = new Date(end)

  switch (id) {
    case 'today':
      break
    case 'yesterday':
      start.setDate(start.getDate() - 1)
      return { start: toDateValue(start), end: toDateValue(start) }
    case 'week':
      start.setDate(start.getDate() - 6)
      break
    case 'month':
      start.setDate(start.getDate() - 29)
      break
    case 'quarter':
      start.setDate(start.getDate() - 89)
      break
    case 'year':
      start.setMonth(0, 1)
      break
  }

  return { start: toDateValue(start), end: toDateValue(end) }
}

export function matchTimePreset(range: TimeRange, now = new Date()): TimePresetId | null {
  if (!hasTimeFilter(range)) return null
  for (const p of TIME_PRESETS) {
    if (sameTimeRange(range, timeRangeFromPreset(p.id, now))) return p.id
  }
  return null
}

/** 默认时间范围：GPX 最早日期 → 今天 */
export function defaultTimeRangeFromTracks(tracks: GpsTrack[]): TimeRange | null {
  const span = inferTracksTimeSpan(tracks)
  if (!span.min) return null
  return {
    start: toDateValue(span.min),
    end: toDateValue(todayDate()),
  }
}
