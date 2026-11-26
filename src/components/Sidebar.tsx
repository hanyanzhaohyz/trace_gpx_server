import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GpsTrack, MapStyleId } from '../types'
import { MAP_STYLE_LIST } from '../lib/mapStyles'
import { aggregateVisibleStats } from '../lib/aggregateStats'
import type { ColorFilter } from '../lib/colorFilter'
import {
  SPEED_CLASSES,
  colorForSpeed,
  type PointColorMode,
  type SpeedClassId,
} from '../lib/speedClass'
import { collectTrackYears, colorForYear } from '../lib/yearColor'
import {
  TIME_PRESETS,
  emptyTimeRange,
  hasTimeFilter,
  inferTracksTimeSpan,
  matchTimePreset,
  timeRangeFromPreset,
  toDateValue,
  type TimePresetId,
  type TimeRange,
} from '../lib/timeRange'
import { TrackStatsPanel } from './TrackStats'

interface SidebarProps {
  id?: string
  /** 手机端底部抽屉 */
  mobile?: boolean
  open?: boolean
  onClose?: () => void
  /** 桌面端收起控件栏 */
  onCollapse?: () => void
  /** 地图当前可见轨迹（已按时间/年份等过滤） */
  mapTracks: GpsTrack[]
  /** 原始全量，用于时间跨度与年份图例 */
  sourceTracks: GpsTrack[]
  /** 服务端筛选统计（大批量时用，避免本地无点无法汇总） */
  overviewStatsOverride?: (ReturnType<typeof aggregateVisibleStats>) | null
  useServerMap?: boolean
  mapStyle: MapStyleId
  colorMode: PointColorMode
  colorFilter: ColorFilter
  pointSize: number
  timeRange: TimeRange
  deviceDir: string | null
  onColorModeChange: (mode: PointColorMode) => void
  onColorFilterChange: (filter: ColorFilter) => void
  onPointSizeChange: (size: number) => void
  onTimeRangeApply: (range: TimeRange) => void
  onUpload: (files: FileList | File[]) => void
  onReloadDevice: () => void
  onMapStyle: (style: MapStyleId) => void
  onFit: () => void
  canFit?: boolean
  uploading: boolean
  error: string | null
  status: string | null
}

export function Sidebar({
  id,
  mobile = false,
  open = true,
  onClose,
  onCollapse,
  mapTracks,
  sourceTracks,
  overviewStatsOverride = null,
  useServerMap: _useServerMap = false,
  mapStyle,
  colorMode,
  colorFilter,
  pointSize,
  timeRange,
  deviceDir,
  onColorModeChange,
  onColorFilterChange,
  onPointSizeChange,
  onTimeRangeApply,
  onUpload,
  onReloadDevice,
  onMapStyle,
  onFit,
  canFit = false,
  uploading,
  error,
  status,
}: SidebarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [draftTimeRange, setDraftTimeRange] = useState<TimeRange>(timeRange)

  useEffect(() => {
    setDraftTimeRange(timeRange)
  }, [timeRange])

  const span = useMemo(
    () => inferTracksTimeSpan(sourceTracks),
    [sourceTracks],
  )

  const yearLegend = useMemo(
    () => collectTrackYears(sourceTracks),
    [sourceTracks],
  )

  const localOverview = useMemo(
    () => aggregateVisibleStats(mapTracks, colorMode, colorFilter),
    [mapTracks, colorMode, colorFilter],
  )
  const overviewStats = overviewStatsOverride ?? localOverview

  const timeDirty =
    draftTimeRange.start !== timeRange.start ||
    draftTimeRange.end !== timeRange.end

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      if (e.dataTransfer.files?.length) onUpload(e.dataTransfer.files)
    },
    [onUpload],
  )

  const fillFullSpan = () => {
    if (!span.min || !span.max) return
    const full = {
      start: toDateValue(span.min),
      end: toDateValue(span.max),
    }
    setDraftTimeRange(full)
    onTimeRangeApply(full)
  }

  const clearTimeRange = () => {
    const empty = emptyTimeRange()
    setDraftTimeRange(empty)
    onTimeRangeApply(empty)
  }

  const applyPreset = (id: TimePresetId) => {
    const next = timeRangeFromPreset(id)
    setDraftTimeRange(next)
    onTimeRangeApply(next)
  }

  const activePreset = matchTimePreset(timeRange)

  const toggleYearFilter = (year: number) => {
    if (colorFilter?.kind === 'year' && colorFilter.year === year) {
      onColorFilterChange(null)
    } else {
      onColorFilterChange({ kind: 'year', year })
    }
  }

  const toggleSpeedFilter = (speedClass: SpeedClassId) => {
    if (
      colorFilter?.kind === 'speed' &&
      colorFilter.speedClass === speedClass
    ) {
      onColorFilterChange(null)
    } else {
      onColorFilterChange({ kind: 'speed', speedClass })
    }
  }

  const stopMapGesture = (e: React.SyntheticEvent) => {
    e.stopPropagation()
  }

  return (
    <aside
      id={id}
      className={`sidebar${mobile ? ' sidebar--sheet' : ''}${open ? ' is-open' : ''}`}
      aria-hidden={mobile ? !open : undefined}
      inert={mobile && !open ? true : undefined}
      onPointerDown={mobile ? stopMapGesture : undefined}
      onTouchStart={mobile ? stopMapGesture : undefined}
      onTouchMove={mobile ? stopMapGesture : undefined}
      onWheel={mobile ? stopMapGesture : undefined}
    >
      <div className="sidebar__scroll">
      {mobile && (
        <div className="sidebar__sheet-bar">
          <span className="sidebar__handle" aria-hidden />
          <button
            type="button"
            className="sidebar__close"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onClose?.()
            }}
            onPointerDown={(e) => {
              e.stopPropagation()
            }}
            aria-label="关闭"
          >
            关闭
          </button>
        </div>
      )}
      <header className="sidebar__brand">
        <div className="brand-mark" aria-hidden>
          <svg viewBox="0 0 40 40" width="36" height="36">
            <circle
              cx="20"
              cy="20"
              r="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              opacity="0.35"
            />
            <path
              d="M8 26 C14 10, 18 28, 22 16 S30 8, 32 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <circle cx="32" cy="14" r="2.4" fill="currentColor" />
          </svg>
        </div>
        <div className="sidebar__brand-text">
          <h1 className="brand-title">迹 Trace</h1>
          <p className="brand-sub">把每一次出行，画进地图</p>
        </div>
        {!mobile && onCollapse && (
          <button
            type="button"
            className="sidebar__collapse"
            onClick={onCollapse}
            title="隐藏控件栏"
            aria-label="隐藏控件栏"
          >
            隐藏
          </button>
        )}
      </header>

      <div
        className={`dropzone${dragOver ? ' is-over' : ''}${uploading ? ' is-busy' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".gpx,application/gpx+xml,application/xml,text/xml"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) onUpload(e.target.files)
            e.target.value = ''
          }}
        />
        <div className="dropzone__icon">↑</div>
        <div className="dropzone__text">
          <strong>{uploading ? '加载中…' : '拖入或点击上传 GPX'}</strong>
          <span>
            {deviceDir
              ? `设备目录：${deviceDir}`
              : '也可从手机 /gpx 目录自动加载'}
          </span>
        </div>
      </div>

      <div className="panel__actions-row">
        <button
          type="button"
          className="chip"
          onClick={onReloadDevice}
          disabled={uploading}
        >
          重新加载设备 GPX
        </button>
        <button
          type="button"
          className="chip"
          onClick={onFit}
          disabled={!canFit}
        >
          适应范围
        </button>
      </div>

      {status && <div className="banner banner--info">{status}</div>}
      {error && <div className="banner banner--error">{error}</div>}

      <section className="panel">
        <div className="panel__head">
          <h2>概览</h2>
        </div>
        <TrackStatsPanel
          stats={overviewStats}
          emptyHint="加载 GPX 后，这里会汇总当前地图可见范围的总里程"
        />
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2>点颜色</h2>
        </div>
        <div className="color-mode">
          <button
            type="button"
            className={`chip${colorMode === 'year' ? ' is-active' : ''}`}
            onClick={() => onColorModeChange('year')}
          >
            按年份
          </button>
          <button
            type="button"
            className={`chip${colorMode === 'speed' ? ' is-active' : ''}`}
            onClick={() => onColorModeChange('speed')}
          >
            按速度
          </button>
        </div>
        {colorMode === 'year' && yearLegend.length > 0 && (
          <ul className="speed-legend speed-legend--years">
            {yearLegend.map((y) => {
              const activeYear =
                colorFilter?.kind === 'year' && colorFilter.year === y
              return (
                <li key={y}>
                  <button
                    type="button"
                    className={`legend-filter${activeYear ? ' is-active' : ''}`}
                    onClick={() => toggleYearFilter(y)}
                    title={activeYear ? '取消筛选' : `只显示 ${y}`}
                  >
                    <span
                      className="speed-legend__dot"
                      style={{ background: colorForYear(y, mapStyle) }}
                    />
                    <span className="speed-legend__label">{y}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {colorMode === 'speed' && (
          <ul className="speed-legend">
            {SPEED_CLASSES.map((c) => {
              const activeSpeed =
                colorFilter?.kind === 'speed' &&
                colorFilter.speedClass === c.id
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`legend-filter${activeSpeed ? ' is-active' : ''}`}
                    onClick={() => toggleSpeedFilter(c.id)}
                    title={activeSpeed ? '取消筛选' : `只显示${c.label}`}
                  >
                    <span
                      className="speed-legend__dot"
                      style={{ background: colorForSpeed(c.id, mapStyle) }}
                    />
                    <span className="speed-legend__label">{c.label}</span>
                    <span className="speed-legend__hint">{c.hint}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {colorFilter && (
          <p className="time-range__hint">
            已筛选：
            {colorFilter.kind === 'year'
              ? `${colorFilter.year} 年`
              : SPEED_CLASSES.find((c) => c.id === colorFilter.speedClass)
                  ?.label ?? colorFilter.speedClass}
            ，再点一次可取消
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2>点大小</h2>
          <span className="panel__subhead">{pointSize.toFixed(1)}</span>
        </div>
        <input
          className="point-style__range"
          type="range"
          min={1}
          max={6}
          step={0.5}
          value={pointSize}
          onChange={(e) => onPointSizeChange(Number(e.target.value))}
          aria-label="轨迹点大小"
        />
        <div className="point-style__preview">
          <span
            className="point-style__dot"
            style={{
              width: pointSize * 2 + 4,
              height: pointSize * 2 + 4,
              background: colorForYear(yearLegend[0] ?? 2024, mapStyle),
            }}
          />
          <span>拖动调节地图上轨迹点的显示大小</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2>时间范围</h2>
          <div className="panel__actions">
            <button
              type="button"
              className="chip"
              onClick={fillFullSpan}
              disabled={!span.min}
            >
              全部
            </button>
            <button
              type="button"
              className="chip"
              onClick={clearTimeRange}
              disabled={
                !hasTimeFilter(timeRange) && !hasTimeFilter(draftTimeRange)
              }
            >
              清除
            </button>
          </div>
        </div>
        <div className="time-range">
          <div className="time-range__presets" role="group" aria-label="快捷时间">
            {TIME_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`chip${activePreset === p.id ? ' is-active' : ''}`}
                onClick={() => applyPreset(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <label className="time-range__field">
            <span>开始</span>
            <input
              type="date"
              value={draftTimeRange.start}
              onChange={(e) =>
                setDraftTimeRange({
                  ...draftTimeRange,
                  start: e.target.value,
                })
              }
            />
          </label>
          <label className="time-range__field">
            <span>结束</span>
            <input
              type="date"
              value={draftTimeRange.end}
              onChange={(e) =>
                setDraftTimeRange({
                  ...draftTimeRange,
                  end: e.target.value,
                })
              }
            />
          </label>
          <button
            type="button"
            className="chip chip--primary"
            onClick={() => onTimeRangeApply(draftTimeRange)}
            disabled={!timeDirty}
          >
            确认
          </button>
          {hasTimeFilter(timeRange) && (
            <p className="time-range__hint">
              地图仅显示该时段内的轨迹点
              {span.min && span.max && (
                <>
                  。数据跨度 {toDateValue(span.min)} ~ {toDateValue(span.max)}
                </>
              )}
            </p>
          )}
          {timeDirty && (
            <p className="time-range__hint">已修改，点「确认」后生效</p>
          )}
        </div>
      </section>

      <section className="panel panel--footer">
        <div className="panel__head">
          <h2>地图风格</h2>
        </div>
        <div className="style-switch">
          {MAP_STYLE_LIST.map((style) => (
            <button
              key={style.id}
              type="button"
              className={`style-btn${mapStyle === style.id ? ' is-active' : ''}`}
              onClick={() => onMapStyle(style.id)}
            >
              <span
                className="style-btn__swatch"
                style={{ background: style.swatch }}
                aria-hidden
              />
              <span className="style-btn__label">{style.label}</span>
            </button>
          ))}
        </div>
      </section>
      </div>
    </aside>
  )
}
