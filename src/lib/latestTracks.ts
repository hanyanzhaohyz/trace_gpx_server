/** 侧栏列表默认只展示最近若干个 GPX 文件（地图仍用全量） */
export const LATEST_TRACK_LIMIT = 6

/** 用于排序的时间戳：优先轨迹结束/开始时间，否则从文件名里抽数字 */
export function trackTimeMs(track: {
  fileName: string
  stats?: { endTime?: Date | number | null; startTime?: Date | number | null }
  mtime?: string
}): number {
  const end = track.stats?.endTime
  if (end instanceof Date && !Number.isNaN(end.getTime())) return end.getTime()
  if (typeof end === 'number' && end > 0) return end

  const start = track.stats?.startTime
  if (start instanceof Date && !Number.isNaN(start.getTime())) return start.getTime()
  if (typeof start === 'number' && start > 0) return start

  if (track.mtime) {
    const t = Date.parse(track.mtime)
    if (Number.isFinite(t)) return t
  }

  const digits = track.fileName.replace(/\D/g, '')
  // 20240731 / 202611 / 2025…
  if (digits.length >= 8) {
    const y = Number(digits.slice(0, 4))
    const m = Number(digits.slice(4, 6)) - 1
    const d = Number(digits.slice(6, 8))
    const dt = new Date(y, m, d, 23, 59, 59).getTime()
    if (Number.isFinite(dt)) return dt
  }
  if (digits.length >= 6) {
    const y = Number(digits.slice(0, 4))
    const m = Number(digits.slice(4, 6)) - 1
    const dt = new Date(y, m + 1, 0, 23, 59, 59).getTime() // 月末
    if (Number.isFinite(dt)) return dt
  }
  if (digits.length >= 4) {
    const y = Number(digits.slice(0, 4))
    return new Date(y, 11, 31, 23, 59, 59).getTime()
  }
  return 0
}

/** 按时间逆序，并只保留最新 limit 条 */
export function selectLatestTracks<T extends { fileName: string }>(
  tracks: T[],
  limit: number = LATEST_TRACK_LIMIT,
): T[] {
  return [...tracks]
    .sort((a, b) => {
      const dt = trackTimeMs(b) - trackTimeMs(a)
      if (dt !== 0) return dt
      return b.fileName.localeCompare(a.fileName, 'en')
    })
    .slice(0, limit)
}
