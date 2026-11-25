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
import { preferChineseLabels } from '../lib/chineseLabels'
import { MAP_STYLES } from '../lib/mapStyles'
import { buildMergedDisplayGeoJSON } from '../lib/buildMapData'
import { fetchMapGeoJSON } from '../lib/loadDeviceGpx'
import {
  mapTone,
  pointOpacityForTone,
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
  const speedCacheRef = useRef(new Map<string, SpeedClassId[]>())
  const lastBboxRef = useRef<[number, number, number, number] | null>(null)
  const rawGeoRef = useRef<GeoJSON.FeatureCollection | null>(null)
  const loadSeqRef = useRef(0)
  const pendingFitRef = useRef(false)

  localRef.current = localTracks
  colorModeRef.current = colorMode
  colorFilterRef.current = colorFilter
  timeRangeRef.current = timeRange
  useServerRef.current = useServerMap
  mapStyleRef.current = mapStyle
  pointSizeRef.current = pointSize

  const currentTone = (): MapTone => mapTone(mapStyleRef.current)

  const tryFit = (map: MapLibreMap) => {
    if (!pendingFitRef.current) return
    const bbox = lastBboxRef.current
    if (!bbox) return
    pendingFitRef.current = false
    const wide = window.innerWidth > 860
    map.fitBounds(
      [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[3]],
      ],
      {
        padding: wide
          ? { top: 80, bottom: 80, left: 360, right: 40 }
          : { top: 56, bottom: 100, left: 24, right: 24 },
        duration: 600,
        maxZoom: 14,
      },
    )
  }

  const applyPaint = (map: MapLibreMap) => {
    if (!map.getLayer(LAYER_ID)) return
    const tone = currentTone()
    const paint = circlePaint(pointSizeRef.current, tone)
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
    rawGeoRef.current = data
    const colored = recolorFeatureCollection(data, currentTone())
    ensureLayer(map, pointSizeRef.current, currentTone())
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
    const colored = recolorFeatureCollection(rawGeoRef.current, currentTone())
    ;(map.getSource(SOURCE_ID) as GeoJSONSource).setData(colored)
    applyPaint(map)
  }

  const refresh = async (map: MapLibreMap) => {
    const seq = ++loadSeqRef.current
    const tone = currentTone()
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
            tone,
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
      tone,
    )
    applyData(map, data, null)
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLES[mapStyle]?.url ?? MAP_STYLES.positron.url,
      center: [116.397, 39.908],
      zoom: 4,
      attributionControl: false,
      fadeDuration: 0,
      maxPitch: 0,
      refreshExpiredTiles: false,
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
      preferChineseLabels(map)
      readyRef.current = true
      void refresh(map)
    })

    map.on('error', (e) => {
      console.error('MapLibre error:', e.error)
    })

    mapRef.current = map

    return () => {
      readyRef.current = false
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    readyRef.current = false
    map.setStyle(MAP_STYLES[mapStyle]?.url ?? MAP_STYLES.positron.url)
    map.once('style.load', () => {
      preferChineseLabels(map)
      readyRef.current = true
      // 底图切换：图层没了，用缓存数据重上色；无缓存则重新拉
      if (rawGeoRef.current) {
        ensureLayer(map, pointSizeRef.current, currentTone())
        recolorCached(map)
        tryFit(map)
      } else {
        void refresh(map)
      }
    })
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

function ensureLayer(map: MapLibreMap, pointSize: number, tone: MapTone) {
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
      paint: circlePaint(pointSize, tone) as never,
    })

    map.on('click', LAYER_ID, (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      const props = f.properties || {}
      const coords = e.lngLat
        ? ([e.lngLat.lng, e.lngLat.lat] as [number, number])
        : null
      if (!coords) return
      const title = props.name
        ? `${props.name}${props.pointCount ? ` · ${Number(props.pointCount).toLocaleString()} 点` : ''}`
        : '轨迹点'
      new Popup({
        closeButton: false,
        offset: 10,
        className: 'trace-popup',
      })
        .setLngLat(coords)
        .setHTML(
          `<div class="popup-card"><strong>${escapeHtml(String(title))}</strong><p>${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}</p></div>`,
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

function circlePaint(pointSize: number, tone: MapTone) {
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
    'circle-opacity': pointOpacityForTone(tone),
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
