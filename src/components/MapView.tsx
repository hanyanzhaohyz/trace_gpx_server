import { useEffect, useRef } from 'react'
import {
  Map as MapLibreMap,
  Popup,
  NavigationControl,
  AttributionControl,
  GeoJSONSource,
  type MapLayerMouseEvent,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { tracksToBounds } from '../lib/gpx'
import { enhanceLocalPlaceLabels } from '../lib/chineseLabels'
import {
  bboxToGcj02,
  featureCollectionToGcj02,
  gcj02ToWgs84,
} from '../lib/gcj02'
import { fetchAmapConfig } from '../lib/amapLoader'
import { AmapUnderlay } from '../lib/amapUnderlay'
import {
  isAmapStyleId,
  resolveMapStyle,
  styleUsesGcj02,
} from '../lib/mapStyles'
import { buildMergedDisplayGeoJSON } from '../lib/buildMapData'
import { fetchMapGeoJSON } from '../lib/loadDeviceGpx'
import {
  mapTone,
  pointOpacityForStyle,
  recolorFeatureCollection,
  type MapTone,
} from '../lib/palette'
import type { ColorFilter } from '../lib/colorFilter'
import type { PointColorMode, SpeedClassId } from '../lib/speedClass'
import type { TimeRange } from '../lib/timeRange'
import type { GpsTrack, MapStyleId } from '../types'

const SOURCE_ID = 'trace-merged'
const LAYER_ID = 'trace-points'

interface MapViewProps {
  /** 本地上传的带点轨迹（小文件） */
  localTracks: GpsTrack[]
  /** 是否走服务端 /api/map（设备大批量） */
  useServerMap: boolean
  timeRange: TimeRange
  mapStyle: MapStyleId
  fitToken: number
  colorMode: PointColorMode
  colorFilter: ColorFilter
  /** 全局轨迹点大小 */
  pointSize: number
  /** 为 false 时禁用拖拽/缩放（手机控件面板打开时） */
  interactive?: boolean
  /** 桌面侧栏宽度，用于 fitBounds 左侧留白 */
  sidebarWidth?: number
  onMapStatus?: (msg: string | null) => void
}

export function MapView({
  localTracks,
  useServerMap,
  timeRange,
  mapStyle,
  fitToken,
  colorMode,
  colorFilter,
  pointSize,
  interactive = true,
  sidebarWidth = 360,
  onMapStatus,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const readyRef = useRef(false)
  const localRef = useRef(localTracks)
  const colorModeRef = useRef(colorMode)
  const colorFilterRef = useRef(colorFilter)
  const timeRangeRef = useRef(timeRange)
  const useServerRef = useRef(useServerMap)
  const mapStyleRef = useRef(mapStyle)
  const pointSizeRef = useRef(pointSize)
  const sidebarWidthRef = useRef(sidebarWidth)
  const speedCacheRef = useRef(new Map<string, SpeedClassId[]>())
  const lastBboxRef = useRef<[number, number, number, number] | null>(null)
  const rawGeoRef = useRef<GeoJSON.FeatureCollection | null>(null)
  const loadSeqRef = useRef(0)
  const pendingFitRef = useRef(false)
  const underlayRef = useRef<AmapUnderlay | null>(null)
  const officialAmapRef = useRef(false)

  localRef.current = localTracks
  colorModeRef.current = colorMode
  colorFilterRef.current = colorFilter
  timeRangeRef.current = timeRange
  useServerRef.current = useServerMap
  mapStyleRef.current = mapStyle
  pointSizeRef.current = pointSize
  sidebarWidthRef.current = sidebarWidth

  const currentTone = (): MapTone => mapTone(mapStyleRef.current)
  const usesGcj = () => styleUsesGcj02(mapStyleRef.current)

  const displayBbox = (
    bbox: [number, number, number, number] | null,
  ): [number, number, number, number] | null => {
    if (!bbox) return null
    return usesGcj() ? bboxToGcj02(bbox) : bbox
  }

  const displayGeo = (
    data: GeoJSON.FeatureCollection,
  ): GeoJSON.FeatureCollection =>
    usesGcj() ? featureCollectionToGcj02(data) : data

  const tryFit = (map: MapLibreMap) => {
    if (!pendingFitRef.current) return
    const bbox = displayBbox(lastBboxRef.current)
    if (!bbox) return
    pendingFitRef.current = false
    const wide = window.innerWidth > 860
    const leftPad = wide
      ? Math.max(24, Math.round(sidebarWidthRef.current) + 40)
      : 24
    map.fitBounds(
      [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[3]],
      ],
      {
        padding: wide
          ? { top: 80, bottom: 80, left: leftPad, right: 40 }
          : { top: 56, bottom: 100, left: leftPad, right: 24 },
        duration: 600,
        maxZoom: 14,
      },
    )
  }

  const applyPaint = (map: MapLibreMap) => {
    if (!map.getLayer(LAYER_ID)) return
    const paint = circlePaint(pointSizeRef.current, mapStyleRef.current)
    map.setPaintProperty(
      LAYER_ID,
      'circle-radius',
      paint['circle-radius'] as never,
    )
    map.setPaintProperty(LAYER_ID, 'circle-opacity', paint['circle-opacity'])
  }

  const applyData = (
    map: MapLibreMap,
    data: GeoJSON.FeatureCollection,
    bbox?: [number, number, number, number] | null,
  ) => {
    // raw 始终存 WGS-84，切高德/国际底图时再决定是否转 GCJ
    rawGeoRef.current = data
    const colored = recolorFeatureCollection(
      displayGeo(data),
      mapStyleRef.current,
    )
    ensureLayer(map, pointSizeRef.current, mapStyleRef.current)
    ;(map.getSource(SOURCE_ID) as GeoJSONSource).setData(colored)
    applyPaint(map)
    if (bbox && bbox.length === 4) {
      lastBboxRef.current = bbox
    } else {
      const b = tracksToBounds(localRef.current)
      lastBboxRef.current = b
        ? [b[0][0], b[0][1], b[1][0], b[1][1]]
        : null
    }
    tryFit(map)
  }

  const recolorCached = (map: MapLibreMap) => {
    if (!rawGeoRef.current || !map.getSource(SOURCE_ID)) return
    const colored = recolorFeatureCollection(
      displayGeo(rawGeoRef.current),
      mapStyleRef.current,
    )
    ;(map.getSource(SOURCE_ID) as GeoJSONSource).setData(colored)
    applyPaint(map)
  }

  const refresh = async (map: MapLibreMap) => {
    const seq = ++loadSeqRef.current
    const styleId = mapStyleRef.current
    const local = localRef.current.filter((t) => t.visible && t.points.length)

    if (useServerRef.current) {
      onMapStatus?.('正在加载地图点…')
      try {
        const remote = await fetchMapGeoJSON(
          timeRangeRef.current,
          colorModeRef.current,
          colorFilterRef.current,
        )
        if (seq !== loadSeqRef.current || !mapRef.current) return

        let features = remote.features
        if (local.length) {
          const localGeo = buildMergedDisplayGeoJSON(
            local,
            colorModeRef.current,
            colorFilterRef.current,
            speedCacheRef.current,
            styleId,
          )
          features = [...remote.features, ...localGeo.features]
        }

        applyData(
          map,
          { type: 'FeatureCollection', features },
          remote.bbox ?? null,
        )
        const n = remote.meta?.displayPointCount
        onMapStatus?.(
          n != null
            ? `地图已显示 ${n.toLocaleString()} 点${remote.meta?.thinned ? '（已抽稀）' : ''}`
            : null,
        )
        if (n != null) {
          setTimeout(() => onMapStatus?.(null), 2500)
        }
      } catch (e) {
        if (seq !== loadSeqRef.current) return
        onMapStatus?.(
          e instanceof Error ? e.message : '地图加载失败',
        )
      }
      return
    }

    const data = buildMergedDisplayGeoJSON(
      localRef.current,
      colorModeRef.current,
      colorFilterRef.current,
      speedCacheRef.current,
      styleId,
    )
    applyData(map, data, null)
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    let cancelled = false

    const boot = async () => {
      const cfg = await fetchAmapConfig()
      if (cancelled || !containerRef.current) return
      officialAmapRef.current = Boolean(cfg.configured)
      if (cfg.configured) {
        console.info('[迹] 高德官方 JS API 已启用')
      } else if (isAmapStyleId(mapStyle)) {
        onMapStatus?.(
          cfg.reason || '未配置高德 Key，官方底图不可用',
        )
      }

      // 高德底图用 GCJ 中心，避免首屏偏一截
      const startCenter = styleUsesGcj02(mapStyle)
        ? ([116.4074, 39.9042] as [number, number])
        : ([116.397, 39.908] as [number, number])

      const map = new MapLibreMap({
        container: containerRef.current,
        style: resolveMapStyle(mapStyle),
        center: startCenter,
        zoom: 4,
        attributionControl: false,
        fadeDuration: 0,
        maxPitch: 0,
        refreshExpiredTiles: false,
        localIdeographFontFamily:
          '"PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
      })

      map.addControl(
        new NavigationControl({ visualizePitch: false }),
        'bottom-right',
      )
      map.addControl(
        new AttributionControl({ compact: true }),
        'bottom-left',
      )

      map.on('load', () => {
        void (async () => {
          if (officialAmapRef.current && isAmapStyleId(mapStyleRef.current)) {
            underlayRef.current = new AmapUnderlay(map)
            const ok = await underlayRef.current.enable(mapStyleRef.current)
            if (!ok) {
              officialAmapRef.current = false
              underlayRef.current?.destroy()
              underlayRef.current = null
              onMapStatus?.('高德官方底图加载失败')
            }
          }
          if (!officialAmapRef.current || !isAmapStyleId(mapStyleRef.current)) {
            enhanceLocalPlaceLabels(map, currentTone())
          }
          readyRef.current = true
          void refresh(map)
        })()
      })

      map.on('error', (e) => {
        console.error('MapLibre error:', e.error)
      })

      mapRef.current = map
    }

    void boot()

    return () => {
      cancelled = true
      readyRef.current = false
      underlayRef.current?.destroy()
      underlayRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    readyRef.current = false

    const applyStyle = async () => {
      const wantAmap = isAmapStyleId(mapStyle)
      const official = officialAmapRef.current

      // 高德各样式的 MapLibre 画布都是同一张透明底。
      // 再 setStyle 时 diff 认为没有变化，style.load 不会来，轨迹层被清掉后也补不回。
      if (official && wantAmap && underlayRef.current) {
        underlayRef.current.setStyle(mapStyle)
        readyRef.current = true
        if (rawGeoRef.current) {
          ensureLayer(map, pointSizeRef.current, mapStyle)
          recolorCached(map)
        }
        return
      }

      if (official && wantAmap) {
        const styled = waitForStyleLoad(map)
        map.setStyle(resolveMapStyle(mapStyle), { diff: false })
        await styled
        underlayRef.current = new AmapUnderlay(map)
        const ok = await underlayRef.current.enable(mapStyle)
        if (!ok) {
          underlayRef.current.destroy()
          underlayRef.current = null
          onMapStatus?.('高德官方底图加载失败')
        }
      } else {
        underlayRef.current?.disable()
        underlayRef.current = null
        const styled = waitForStyleLoad(map)
        map.setStyle(resolveMapStyle(mapStyle), { diff: false })
        await styled
        enhanceLocalPlaceLabels(map, currentTone())
      }

      readyRef.current = true
      if (rawGeoRef.current) {
        ensureLayer(map, pointSizeRef.current, mapStyle)
        recolorCached(map)
        tryFit(map)
      } else {
        void refresh(map)
      }
    }

    void applyStyle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapStyle])

  useEffect(() => {
    speedCacheRef.current.clear()
    const map = mapRef.current
    if (!map || !readyRef.current) return
    void refresh(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localTracks, useServerMap, timeRange, colorMode, colorFilter])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    applyPaint(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointSize])

  useEffect(() => {
    if (fitToken === 0) return
    pendingFitRef.current = true
    const map = mapRef.current
    if (map && readyRef.current) tryFit(map)
  }, [fitToken])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const handlers = [
      map.dragPan,
      map.scrollZoom,
      map.boxZoom,
      map.dragRotate,
      map.keyboard,
      map.doubleClickZoom,
      map.touchZoomRotate,
      map.touchPitch,
    ]
    for (const h of handlers) {
      if (interactive) h.enable()
      else h.disable()
    }
    const el = map.getCanvasContainer()
    el.style.pointerEvents = interactive ? '' : 'none'
  }, [interactive])

  return (
    <div
      ref={containerRef}
      className={`map-view${interactive ? '' : ' is-frozen'}`}
    />
  )
}

/** 必须在 setStyle 之前调用，避免空样式同步加载完后错过 style.load */
function waitForStyleLoad(map: MapLibreMap): Promise<void> {
  return new Promise((resolve) => {
    map.once('style.load', () => resolve())
  })
}

function ensureLayer(map: MapLibreMap, pointSize: number, style: MapStyleId) {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }
  if (!map.getLayer(LAYER_ID)) {
    map.addLayer({
      id: LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: circlePaint(pointSize, style) as never,
    })

    map.on('click', LAYER_ID, (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      const props = f.properties || {}
      const mapCoords = e.lngLat
        ? ([e.lngLat.lng, e.lngLat.lat] as [number, number])
        : null
      if (!mapCoords) return
      const styleName = map.getStyle()?.name || ''
      const onGcj = styleName.startsWith('amap')
      // 弹窗展示 WGS-84，方便对照 GPX
      const wgs = onGcj
        ? gcj02ToWgs84(mapCoords[0], mapCoords[1])
        : mapCoords
      const title = props.name
        ? `${props.name}${props.pointCount ? ` · ${Number(props.pointCount).toLocaleString()} 点` : ''}`
        : '轨迹点'
      new Popup({
        closeButton: false,
        offset: 10,
        className: 'trace-popup',
      })
        .setLngLat(mapCoords)
        .setHTML(
          `<div class="popup-card"><strong>${escapeHtml(String(title))}</strong><p>${wgs[1].toFixed(5)}, ${wgs[0].toFixed(5)}</p></div>`,
        )
        .addTo(map)
    })

    map.on('mouseenter', LAYER_ID, () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', LAYER_ID, () => {
      map.getCanvas().style.cursor = ''
    })
  }
}

function circlePaint(pointSize: number, style: MapStyleId) {
  const base = Math.max(1, pointSize)
  return {
    'circle-radius': [
      'interpolate',
      ['linear'],
      ['zoom'],
      4,
      Math.max(0.75, base * 0.28),
      7,
      Math.max(1, base * 0.4),
      10,
      Math.max(1.2, base * 0.65),
      13,
      base,
      16,
      base * 1.25,
    ],
    'circle-color': ['get', 'color'],
    'circle-opacity': pointOpacityForStyle(style),
    'circle-stroke-width': 0,
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
