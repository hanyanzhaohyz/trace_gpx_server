import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapView } from './components/MapView'
import { Sidebar } from './components/Sidebar'
import { parseGpxFile } from './lib/gpx'
import {
  fetchFilteredStats,
  loadAllDeviceGpx,
} from './lib/loadDeviceGpx'
import { DEFAULT_MAP_STYLE } from './lib/mapStyles'
import {
  defaultTimeRangeFromTracks,
  emptyTimeRange,
  type TimeRange,
} from './lib/timeRange'
import {
  type ColorFilter,
} from './lib/colorFilter'
import type { PointColorMode } from './lib/speedClass'
import type { GpsTrack, MapStyleId, TrackStats } from './types'
import './App.css'

const MOBILE_MQ = '(max-width: 860px)'
/** 桌面控件栏固定宽度（不再拖拽调宽） */
const SIDEBAR_WIDTH = 360
const SIDEBAR_COLLAPSED_KEY = 'trace.sidebarCollapsed.v3'

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export default function App() {
  /** 设备摘要（无点）或回退时的全量带点轨迹 */
  const [tracks, setTracks] = useState<GpsTrack[]>([])
  /** 手动上传的带点轨迹 */
  const [localTracks, setLocalTracks] = useState<GpsTrack[]>([])
  const [useServerMap, setUseServerMap] = useState(false)
  const [mapStyle, setMapStyle] = useState<MapStyleId>(DEFAULT_MAP_STYLE)
  const [colorMode, setColorMode] = useState<PointColorMode>('year')
  const [colorFilter, setColorFilter] = useState<ColorFilter>(null)
  const [pointSize, setPointSize] = useState(2)
  const [fitToken, setFitToken] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [timeRange, setTimeRange] = useState<TimeRange>(emptyTimeRange)
  const [deviceDir, setDeviceDir] = useState<string | null>(null)
  const [overviewStats, setOverviewStats] = useState<
    (TrackStats & { trackCount: number }) | null
  >(null)
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_MQ).matches : false,
  )
  const [panelOpen, setPanelOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed)
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks
  const defaultTimeReadyRef = useRef(false)

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ)
    const sync = () => {
      setIsMobile(mq.matches)
      if (!mq.matches) setPanelOpen(false)
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!isMobile || !panelOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [isMobile, panelOpen])

  useEffect(() => {
    if (defaultTimeReadyRef.current || tracks.length === 0) return
    const next = defaultTimeRangeFromTracks(tracks)
    if (!next) return
    defaultTimeReadyRef.current = true
    setTimeRange(next)
  }, [tracks])

  const loadFromDevice = useCallback(async () => {
    setUploading(true)
    setError(null)
    setStatus('正在加载轨迹（优先读服务端摘要）…')

    const existing = new Set(tracksRef.current.map((t) => t.fileName))
    const { tracks: next, errors, dir, useServerMap: serverMap } =
      await loadAllDeviceGpx(existing, setStatus)
    if (dir) setDeviceDir(dir)
    setUseServerMap(serverMap)
    if (next.length) {
      setTracks((prev) => {
        const names = new Set(prev.map((t) => t.fileName))
        const unique = next.filter((t) => !names.has(t.fileName))
        return [...unique, ...prev]
      })
      setFitToken((t) => t + 1)
    }
    if (errors.length) setError(errors.join('；'))
    setStatus(
      next.length
        ? `已从 ${dir || '设备'} 加载 ${next.length} 个文件`
        : dir
          ? `${dir} 中没有新的 GPX（或目录为空）`
          : '未连接到设备 GPX 服务（开发模式可手动上传）',
    )
    setUploading(false)
    setTimeout(() => setStatus(null), 4000)
  }, [])

  useEffect(() => {
    void loadFromDevice()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 概览统计：服务端按筛选计算；本地回退时侧栏自行聚合
  useEffect(() => {
    if (!useServerMap) {
      setOverviewStats(null)
      return
    }
    let cancelled = false
    void (async () => {
      const stats = await fetchFilteredStats(timeRange, colorMode, colorFilter)
      if (!cancelled) setOverviewStats(stats)
    })()
    return () => {
      cancelled = true
    }
  }, [useServerMap, timeRange, colorMode, colorFilter])

  const handleUpload = useCallback(async (files: FileList | File[]) => {
    setUploading(true)
    setError(null)
    const list = Array.from(files).filter(
      (f) => f.name.toLowerCase().endsWith('.gpx') || f.type.includes('xml'),
    )
    if (!list.length) {
      setError('请选择 .gpx 文件')
      setUploading(false)
      return
    }

    await new Promise((r) => setTimeout(r, 40))

    const next: GpsTrack[] = []
    const errors: string[] = []
    for (const file of list) {
      try {
        next.push(await parseGpxFile(file))
      } catch (e) {
        errors.push(`${file.name}: ${e instanceof Error ? e.message : '解析失败'}`)
      }
    }

    if (next.length) {
      setLocalTracks((prev) => [...next, ...prev])
      setFitToken((t) => t + 1)
    }
    if (errors.length) setError(errors.join('；'))
    setUploading(false)
  }, [])

  const applyTimeRange = useCallback((range: TimeRange) => {
    setTimeRange(range)
    setFitToken((t) => t + 1)
  }, [])

  const handleColorModeChange = useCallback((mode: PointColorMode) => {
    setColorMode(mode)
    setColorFilter(null)
    setFitToken((t) => t + 1)
  }, [])

  const handleColorFilterChange = useCallback((next: ColorFilter) => {
    setColorFilter(next)
    setFitToken((t) => t + 1)
  }, [])

  const sourceTracks = useMemo(
    () => [...localTracks, ...tracks],
    [localTracks, tracks],
  )

  const hasMapData = useServerMap || localTracks.length > 0 || tracks.some((t) => t.points.length > 0)

  const closePanel = useCallback(() => setPanelOpen(false), [])

  const setSidebarOpen = useCallback((open: boolean) => {
    setSidebarCollapsed(!open)
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, open ? '0' : '1')
    } catch {
      /* ignore */
    }
  }, [])

  const effectiveSidebarWidth =
    isMobile || sidebarCollapsed ? 0 : SIDEBAR_WIDTH

  return (
    <div
      className={[
        'app',
        isMobile ? 'app--mobile' : '',
        panelOpen ? 'is-panel-open' : '',
        !isMobile && sidebarCollapsed ? 'is-sidebar-collapsed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <main className="stage">
        <MapView
          localTracks={
            useServerMap
              ? localTracks
              : [...localTracks, ...tracks]
          }
          useServerMap={useServerMap}
          timeRange={timeRange}
          mapStyle={mapStyle}
          fitToken={fitToken}
          colorMode={colorMode}
          colorFilter={colorFilter}
          pointSize={pointSize}
          interactive={!isMobile || !panelOpen}
          sidebarWidth={effectiveSidebarWidth}
          onMapStatus={setStatus}
        />
      </main>

      {!isMobile && sidebarCollapsed && (
        <button
          type="button"
          className="sidebar-expand"
          aria-label="展开控件栏"
          title="展开控件栏"
          onClick={() => setSidebarOpen(true)}
        >
          控件
        </button>
      )}

      {isMobile && (
        <>
          <button
            type="button"
            className="mobile-fab"
            aria-expanded={panelOpen}
            aria-controls="trace-sidebar"
            onClick={() => setPanelOpen((v) => !v)}
          >
            {panelOpen ? '收起' : '控件'}
          </button>
          {panelOpen && (
            <button
              type="button"
              className="mobile-backdrop"
              aria-label="关闭控件面板"
              onClick={closePanel}
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                closePanel()
              }}
            />
          )}
          {!panelOpen && (status || error) && (
            <div
              className={`mobile-toast${error ? ' mobile-toast--error' : ''}`}
              role="status"
            >
              {error || status}
            </div>
          )}
        </>
      )}

      <Sidebar
        id="trace-sidebar"
        mobile={isMobile}
        open={!isMobile || panelOpen}
        onClose={closePanel}
        onCollapse={!isMobile ? () => setSidebarOpen(false) : undefined}
        mapTracks={useServerMap ? tracks : [...localTracks, ...tracks]}
        sourceTracks={sourceTracks}
        overviewStatsOverride={useServerMap ? overviewStats : null}
        useServerMap={useServerMap}
        mapStyle={mapStyle}
        colorMode={colorMode}
        colorFilter={colorFilter}
        pointSize={pointSize}
        timeRange={timeRange}
        deviceDir={deviceDir}
        onColorModeChange={handleColorModeChange}
        onColorFilterChange={handleColorFilterChange}
        onPointSizeChange={setPointSize}
        onTimeRangeApply={applyTimeRange}
        onUpload={handleUpload}
        onReloadDevice={() => void loadFromDevice()}
        onMapStyle={setMapStyle}
        onFit={() => {
          setFitToken((t) => t + 1)
          if (isMobile) closePanel()
        }}
        canFit={hasMapData}
        uploading={uploading}
        error={error}
        status={status}
      />
    </div>
  )
}
