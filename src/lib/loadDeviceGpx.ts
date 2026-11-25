import { parseGpx } from './gpx'
import { colorForTrackYear, colorForYear } from './yearColor'
import type { ColorFilter } from './colorFilter'
import type { PointColorMode } from './speedClass'
import type { TimeRange } from './timeRange'
import type { GpsTrack, TrackStats } from '../types'

export interface DeviceGpxList {
  dir: string
  files: { name: string; size: number; mtime: string }[]
}

/** 从本机服务拉取 /storage/.../gpx 目录清单 */
export async function fetchDeviceGpxList(): Promise<DeviceGpxList | null> {
  try {
    const res = await fetch('/api/gpx')
    if (!res.ok) return null
    return (await res.json()) as DeviceGpxList
  } catch {
    return null
  }
}

export interface SummaryTrackMeta {
  fileName: string
  name: string
  size?: number
  mtime?: string
  year: number | null
  stats: {
    distanceKm: number
    elevGainM: number
    elevLossM: number
    elevMinM: number | null
    elevMaxM: number | null
    durationMs: number | null
    avgSpeedKmh: number | null
    maxSpeedKmh: number | null
    pointCount: number
    startTime: number | null
    endTime: number | null
  }
}

export interface TracksSummary {
  v: number
  dir: string
  builtAt: string
  trackCount: number
  pointCount: number
  years: number[]
  timeSpan: { min: number | null; max: number | null }
  overviewStats: SummaryTrackMeta['stats'] & { trackCount?: number }
  tracks: SummaryTrackMeta[]
  errors?: string[]
}

function hydrateStats(s: SummaryTrackMeta['stats']): TrackStats {
  return {
    distanceKm: s.distanceKm,
    elevGainM: s.elevGainM,
    elevLossM: s.elevLossM,
    elevMinM: s.elevMinM,
    elevMaxM: s.elevMaxM,
    durationMs: s.durationMs,
    avgSpeedKmh: s.avgSpeedKmh,
    maxSpeedKmh: s.maxSpeedKmh,
    pointCount: s.pointCount,
    startTime: s.startTime != null ? new Date(s.startTime) : null,
    endTime: s.endTime != null ? new Date(s.endTime) : null,
  }
}

/** 元数据轨迹（无点），供侧栏年份/跨度，不占内存 */
export function metaToTrack(raw: SummaryTrackMeta): GpsTrack {
  const track: GpsTrack = {
    id: `meta-${raw.fileName}`,
    name: raw.name,
    fileName: raw.fileName,
    points: [],
    waypoints: [],
    stats: hydrateStats(raw.stats),
    color: colorForYear(raw.year),
    pointSize: 2,
    visible: true,
    createdAt: Date.now(),
  }
  track.color = colorForTrackYear(track)
  return track
}

async function waitForCache(
  onProgress?: (msg: string) => void,
): Promise<boolean> {
  for (let i = 0; i < 600; i++) {
    const st = await fetch('/api/cache/status')
    if (!st.ok) return false
    const status = (await st.json()) as {
      building: boolean
      ready: boolean
      done: number
      total: number
      error: string | null
    }
    if (status.error && !status.building && !status.ready) return false
    if (status.building) {
      onProgress?.(
        `服务端首次解析缓存 ${status.done}/${status.total || '?'}…（仅第一次慢）`,
      )
      await new Promise((r) => setTimeout(r, 500))
      continue
    }
    return status.ready
  }
  return false
}

/** 只拉摘要，绝不下载整包轨迹点 */
export async function loadTracksSummary(
  onProgress?: (msg: string) => void,
): Promise<{
  tracks: GpsTrack[]
  errors: string[]
  dir: string | null
  summary: TracksSummary | null
} | null> {
  onProgress?.('正在检查服务端轨迹缓存…')
  try {
    const ok = await waitForCache(onProgress)
    if (!ok) return null

    onProgress?.('正在加载轨迹摘要…')
    const res = await fetch('/api/summary')
    if (res.status === 501 || res.status === 404) return null
    if (!res.ok) throw new Error(`摘要接口失败 HTTP ${res.status}`)

    const summary = (await res.json()) as TracksSummary
    const tracks = (summary.tracks || []).map(metaToTrack)
    return {
      tracks,
      errors: summary.errors ?? [],
      dir: summary.dir ?? null,
      summary,
    }
  } catch {
    return null
  }
}

export function buildMapQuery(
  timeRange: TimeRange,
  colorMode: PointColorMode,
  colorFilter: ColorFilter,
): string {
  const qs = new URLSearchParams()
  qs.set('mode', colorMode)
  if (timeRange.start) qs.set('start', timeRange.start)
  if (timeRange.end) qs.set('end', timeRange.end)
  if (colorFilter?.kind === 'year') qs.set('year', String(colorFilter.year))
  if (colorFilter?.kind === 'speed') qs.set('speed', colorFilter.speedClass)
  return qs.toString()
}

export async function fetchMapGeoJSON(
  timeRange: TimeRange,
  colorMode: PointColorMode,
  colorFilter: ColorFilter,
): Promise<GeoJSON.FeatureCollection & {
  bbox?: [number, number, number, number] | null
  meta?: { displayPointCount?: number; thinned?: boolean }
}> {
  const qs = buildMapQuery(timeRange, colorMode, colorFilter)
  const res = await fetch(`/api/map?${qs}`)
  if (!res.ok) throw new Error(`地图接口失败 HTTP ${res.status}`)
  return (await res.json()) as GeoJSON.FeatureCollection & {
    bbox?: [number, number, number, number] | null
    meta?: { displayPointCount?: number; thinned?: boolean }
  }
}

export async function fetchFilteredStats(
  timeRange: TimeRange,
  colorMode: PointColorMode,
  colorFilter: ColorFilter,
): Promise<(TrackStats & { trackCount: number }) | null> {
  try {
    const qs = buildMapQuery(timeRange, colorMode, colorFilter)
    const res = await fetch(`/api/stats?${qs}`)
    if (!res.ok) return null
    const raw = (await res.json()) as SummaryTrackMeta['stats'] & {
      trackCount?: number
    }
    return {
      ...hydrateStats(raw),
      trackCount: raw.trackCount ?? 0,
    }
  } catch {
    return null
  }
}

export async function fetchAndParseDeviceGpx(
  fileName: string,
): Promise<GpsTrack> {
  const res = await fetch(`/api/gpx/${encodeURIComponent(fileName)}`)
  if (!res.ok) {
    throw new Error(`无法读取 ${fileName}`)
  }
  const text = await res.text()
  return parseGpx(text, fileName)
}

const CONCURRENCY = 6

/** 旧路径：逐文件拉取（缓存不可用时的回退） */
async function loadAllDeviceGpxFallback(
  existingFileNames: Set<string>,
  onProgress?: (msg: string) => void,
): Promise<{ tracks: GpsTrack[]; errors: string[]; dir: string | null }> {
  const list = await fetchDeviceGpxList()
  if (!list) {
    return { tracks: [], errors: [], dir: null }
  }

  const tracks: GpsTrack[] = []
  const errors: string[] = []
  const pending = list.files.filter((f) => !existingFileNames.has(f.name))
  let done = 0

  async function worker(queue: typeof pending) {
    while (queue.length) {
      const file = queue.shift()
      if (!file) break
      try {
        tracks.push(await fetchAndParseDeviceGpx(file.name))
      } catch (e) {
        errors.push(
          `${file.name}: ${e instanceof Error ? e.message : '解析失败'}`,
        )
      }
      done += 1
      onProgress?.(`正在加载 ${file.name}（${done}/${pending.length}）…`)
    }
  }

  onProgress?.(`并行加载 ${pending.length} 个 GPX…`)
  const queue = [...pending]
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () =>
      worker(queue),
    ),
  )

  return { tracks, errors, dir: list.dir }
}

/**
 * 优先摘要（无点）；失败再逐文件（体积小时才合理）
 */
export async function loadAllDeviceGpx(
  existingFileNames: Set<string>,
  onProgress?: (msg: string) => void,
): Promise<{
  tracks: GpsTrack[]
  errors: string[]
  dir: string | null
  useServerMap: boolean
  summary: TracksSummary | null
}> {
  const cached = await loadTracksSummary(onProgress)
  if (cached && cached.tracks.length) {
    const tracks =
      existingFileNames.size === 0
        ? cached.tracks
        : cached.tracks.filter((t) => !existingFileNames.has(t.fileName))
    onProgress?.(
      tracks.length
        ? `已加载 ${tracks.length} 条轨迹摘要（地图按需拉取）`
        : '缓存已是最新，没有新文件',
    )
    return {
      tracks,
      errors: cached.errors,
      dir: cached.dir,
      useServerMap: true,
      summary: cached.summary,
    }
  }
  const fb = await loadAllDeviceGpxFallback(existingFileNames, onProgress)
  return { ...fb, useServerMap: false, summary: null }
}
