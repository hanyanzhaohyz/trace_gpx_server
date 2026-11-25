import type { SpeedClassId } from './speedClass'
import { trackYear } from './yearColor'
import type { GpsTrack } from '../types'

export type ColorFilter =
  | { kind: 'year'; year: number }
  | { kind: 'speed'; speedClass: SpeedClassId }
  | null

export function filterTracksByColor(
  tracks: GpsTrack[],
  filter: ColorFilter,
): GpsTrack[] {
  if (!filter) return tracks
  if (filter.kind === 'year') {
    return tracks.filter((t) => trackYear(t) === filter.year)
  }
  // 速度筛选在地图层按点过滤，这里仍返回全部轨迹
  return tracks
}

export function colorFilterKey(filter: ColorFilter): string {
  if (!filter) return ''
  if (filter.kind === 'year') return `year:${filter.year}`
  return `speed:${filter.speedClass}`
}
