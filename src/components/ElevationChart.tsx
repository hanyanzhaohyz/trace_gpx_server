import { useMemo, useRef, useState } from 'react'
import type { GpsTrack } from '../types'
import { formatDistance, formatElevation } from '../lib/geo'

interface ElevationChartProps {
  track: GpsTrack | null
  onHoverDistance?: (distanceM: number | null) => void
}

export function ElevationChart({ track, onHoverDistance }: ElevationChartProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<{
    x: number
    ele: number
    dist: number
  } | null>(null)

  const { path, area, minEle, maxEle, hasEle } = useMemo(() => {
    if (!track || track.points.length < 2) {
      return { path: '', area: '', minEle: 0, maxEle: 0, hasEle: false }
    }

    const pts = track.points.filter((p) => p.ele != null)
    if (pts.length < 2) {
      return { path: '', area: '', minEle: 0, maxEle: 0, hasEle: false }
    }

    const eles = pts.map((p) => p.ele as number)
    const minE = Math.min(...eles)
    const maxE = Math.max(...eles)
    const range = Math.max(maxE - minE, 10)
    const pad = range * 0.08
    const yMin = minE - pad
    const yMax = maxE + pad
    const maxDist = pts[pts.length - 1].distance || 1

    const W = 100
    const H = 100
    const coords = pts.map((p) => {
      const x = (p.distance / maxDist) * W
      const y = H - ((p.ele! - yMin) / (yMax - yMin)) * H
      return [x, y] as const
    })

    const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c[0].toFixed(2)},${c[1].toFixed(2)}`).join(' ')
    const areaPath = `${line} L${W},${H} L0,${H} Z`

    return {
      path: line,
      area: areaPath,
      minEle: minE,
      maxEle: maxE,
      hasEle: true,
    }
  }, [track])

  if (!track) {
    return (
      <div className="elev elev--empty">
        <p>选择轨迹查看海拔剖面</p>
      </div>
    )
  }

  if (!hasEle) {
    return (
      <div className="elev elev--empty">
        <p>此轨迹无海拔数据</p>
      </div>
    )
  }

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!track || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const targetDist = ratio * track.points[track.points.length - 1].distance

    let best = track.points[0]
    let bestDiff = Infinity
    for (const p of track.points) {
      if (p.ele == null) continue
      const d = Math.abs(p.distance - targetDist)
      if (d < bestDiff) {
        bestDiff = d
        best = p
      }
    }

    setHover({
      x: ratio * 100,
      ele: best.ele ?? 0,
      dist: best.distance,
    })
    onHoverDistance?.(best.distance)
  }

  const handleLeave = () => {
    setHover(null)
    onHoverDistance?.(null)
  }

  return (
    <div className="elev">
      <div className="elev__meta">
        <span>最低 {formatElevation(minEle)}</span>
        <span>最高 {formatElevation(maxEle)}</span>
      </div>
      <svg
        ref={svgRef}
        className="elev__svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        <defs>
          <linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#elevFill)" />
        <path
          d={path}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.2"
          vectorEffect="non-scaling-stroke"
        />
        {hover && (
          <>
            <line
              x1={hover.x}
              y1="0"
              x2={hover.x}
              y2="100"
              stroke="var(--ink-soft)"
              strokeWidth="0.4"
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={hover.x}
              cy={
                100 -
                ((hover.ele - (minEle - (maxEle - minEle) * 0.08)) /
                  Math.max((maxEle - minEle) * 1.16, 10)) *
                  100
              }
              r="1.8"
              fill="var(--accent)"
              stroke="#fff"
              strokeWidth="0.6"
            />
          </>
        )}
      </svg>
      {hover && (
        <div className="elev__tooltip" style={{ left: `${hover.x}%` }}>
          {formatElevation(hover.ele)} · {formatDistance(hover.dist / 1000)}
        </div>
      )}
    </div>
  )
}
