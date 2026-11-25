export interface TrackPoint {
  lat: number
  lon: number
  ele?: number
  /** 优先用毫秒时间戳，避免海量 Date 对象占内存 */
  timeMs?: number
  time?: Date
  /** Cumulative distance from start in meters */
  distance: number
}

export interface Waypoint {
  lat: number
  lon: number
  name?: string
  desc?: string
  ele?: number
  time?: Date
}

export interface TrackStats {
  distanceKm: number
  elevGainM: number
  elevLossM: number
  elevMinM: number | null
  elevMaxM: number | null
  durationMs: number | null
  avgSpeedKmh: number | null
  maxSpeedKmh: number | null
  pointCount: number
  startTime: Date | null
  endTime: Date | null
}

export interface GpsTrack {
  id: string
  name: string
  fileName: string
  points: TrackPoint[]
  waypoints: Waypoint[]
  stats: TrackStats
  /** 轨迹点颜色 */
  color: string
  /** 轨迹点半径（像素） */
  pointSize: number
  visible: boolean
  createdAt: number
}

export type MapStyleId = 'positron' | 'bright' | 'dark' | 'fiord'
