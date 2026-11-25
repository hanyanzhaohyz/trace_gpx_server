import type { TrackStats } from '../types'
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatSpeed,
  formatDate,
} from '../lib/geo'

interface TrackStatsProps {
  stats: (TrackStats & { trackCount?: number }) | null
  emptyHint?: string
}

export function TrackStatsPanel({
  stats,
  emptyHint = '导入 GPX 后，这里会显示里程、爬升与用时',
}: TrackStatsProps) {
  if (!stats || stats.pointCount === 0) {
    return (
      <div className="stats stats--empty">
        <p>{emptyHint}</p>
      </div>
    )
  }

  return (
    <div className="stats">
      <div className="stats__hero">
        <span className="stats__hero-label">总里程</span>
        <span className="stats__hero-value">
          {formatDistance(stats.distanceKm)}
        </span>
      </div>
      <div className="stats__grid">
        <Stat label="累计爬升" value={formatElevation(stats.elevGainM)} />
        <Stat label="累计下降" value={formatElevation(stats.elevLossM)} />
        <Stat label="用时" value={formatDuration(stats.durationMs)} />
        <Stat label="均速" value={formatSpeed(stats.avgSpeedKmh)} />
        <Stat
          label="最高"
          value={
            stats.elevMaxM != null ? formatElevation(stats.elevMaxM) : '—'
          }
        />
        <Stat label="极速" value={formatSpeed(stats.maxSpeedKmh)} />
      </div>
      <div className="stats__footer">
        <span>
          {stats.pointCount.toLocaleString()} 点
          {stats.trackCount != null ? ` · ${stats.trackCount} 个文件` : ''}
        </span>
        <span>
          {formatDate(stats.startTime)}
          {stats.endTime ? ` ~ ${formatDate(stats.endTime)}` : ''}
        </span>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
    </div>
  )
}
