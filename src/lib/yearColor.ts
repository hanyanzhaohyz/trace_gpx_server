import {
  YEAR_COLORS_BY_TONE,
  colorForYearTone,
  type MapTone,
} from './palette'
import type { GpsTrack } from '../types'

/** @deprecated 用 YEAR_COLORS_BY_TONE；保留兼容默认浅色 */
export const YEAR_COLORS = YEAR_COLORS_BY_TONE.light

/**
 * 只从文件名解析年份。
 * 支持：20240731.gpx / 202505.gpx / 2026.gpx
 */
export function yearFromFileName(fileName: string): number | null {
  const base = fileName.replace(/\.[^.]+$/i, '')
  const m = base.match(/(?:^|\D)(20\d{2}|19\d{2})/)
  if (!m) return null
  const year = Number(m[1])
  if (year < 1990 || year > 2100) return null
  return year
}

export function trackYear(track: { fileName: string }): number | null {
  return yearFromFileName(track.fileName)
}

export function colorForYear(
  year: number | null | undefined,
  tone: MapTone = 'light',
): string {
  return colorForYearTone(year, tone)
}

export function colorForTrackYear(
  track: GpsTrack,
  tone: MapTone = 'light',
): string {
  return colorForYear(trackYear(track), tone)
}

/** 从轨迹列表收集出现过的年份（升序），供图例使用 */
export function collectTrackYears(
  tracks: { fileName: string }[],
): number[] {
  const set = new Set<number>()
  for (const t of tracks) {
    const y = yearFromFileName(t.fileName)
    if (y != null) set.add(y)
  }
  return [...set].sort((a, b) => a - b)
}
