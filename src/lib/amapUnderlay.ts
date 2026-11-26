import type { Map as MapLibreMap } from 'maplibre-gl'
import type { MapStyleId } from '../types'
import { loadAmapSdk, type AMapMap, type AMapNS } from './amapLoader'
import { MAP_STYLES } from './mapStyles'

/** 高德瓦片 256、MapLibre 世界宽按 512 算，同比例尺 zoom 差 1 */
const ZOOM_OFFSET = 1
const MIN_ZOOM = 2
const MAX_ZOOM = 20

function officialStyleUrl(id: MapStyleId): string | null {
  const theme = MAP_STYLES[id]?.amapTheme
  return theme ? `amap://styles/${theme}` : null
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

function isSatellite(id: MapStyleId) {
  return id === 'amap-sat-road'
}

/**
 * 官方高德底图垫在 MapLibre 下：轨迹仍由 MapLibre 画，视野同步到 AMap。
 * 注意：本项目在高德模式下 MapLibre 中心已是 GCJ-02，同步时不再二次纠偏。
 */
export class AmapUnderlay {
  private map: MapLibreMap
  private host: HTMLDivElement | null = null
  private amap: AMapMap | null = null
  private AMap: AMapNS | null = null
  private frame = 0
  private destroyed = false
  private lastView: {
    center: [number, number]
    zoom: number
    pitch: number
    rotation: number
  } | null = null
  private onViewChange = () => this.requestSync()
  private onResize = () => {
    this.amap?.resize()
    this.requestSync()
  }
  private resizeObserver: ResizeObserver | null = null
  /** 当前是卫星图层时，切回矢量要先还原官方默认层（含文字） */
  private satelliteOn = false

  constructor(map: MapLibreMap) {
    this.map = map
  }

  async enable(styleId: MapStyleId): Promise<boolean> {
    if (this.destroyed) return false
    const AMap = await loadAmapSdk()
    if (!AMap || this.destroyed) return false
    this.AMap = AMap

    if (!this.amap) {
      await this.attach(AMap)
    }
    if (!this.amap || this.destroyed) return false

    this.applyBasemap(styleId)
    this.applyView()
    return true
  }

  setStyle(styleId: MapStyleId) {
    if (!this.amap || !this.AMap) return
    this.applyBasemap(styleId)
    this.applyView()
  }

  disable() {
    this.teardownAmap()
  }

  destroy() {
    this.destroyed = true
    this.teardownAmap()
  }

  private async attach(AMap: AMapNS) {
    const container = this.map.getContainer()
    this.map.getCanvas().style.background = 'transparent'
    const canvasContainer = container.querySelector(
      '.maplibregl-canvas-container',
    ) as HTMLElement | null
    if (canvasContainer) canvasContainer.style.zIndex = '1'

    const host = document.createElement('div')
    host.className = 'map-view__amap'
    host.setAttribute('aria-hidden', 'true')
    container.insertBefore(host, container.firstChild)
    this.host = host

    await this.waitForSize()
    if (this.destroyed) return

    const view = this.readView()
    this.amap = new AMap.Map(host, {
      viewMode: '2D',
      zoom: view.zoom,
      center: view.center,
      pitch: 0,
      rotation: 0,
      zooms: [MIN_ZOOM, MAX_ZOOM],
      mapStyle: 'amap://styles/normal',
      showLabel: true,
      showBuildingBlock: false,
      showIndoorMap: false,
      dragEnable: false,
      zoomEnable: true,
      rotateEnable: false,
      pitchEnable: false,
      doubleClickZoom: false,
      scrollWheel: false,
      keyboardEnable: false,
      touchZoom: false,
      jogEnable: false,
      animateEnable: false,
      resizeEnable: false,
      isHotspot: false,
    })

    for (const name of ['move', 'zoom', 'rotate', 'pitch', 'render'] as const) {
      this.map.on(name, this.onViewChange)
    }
    this.map.on('resize', this.onResize)
    this.resizeObserver = new ResizeObserver(this.onResize)
    this.resizeObserver.observe(container)
  }

  private applyBasemap(styleId: MapStyleId) {
    if (!this.amap || !this.AMap) return
    if (isSatellite(styleId)) {
      const layers: unknown[] = [new this.AMap.TileLayer.Satellite()]
      this.amap.setLayers(layers)
      this.satelliteOn = true
      return
    }
    // setLayers(createDefaultLayer()) 会换掉官方默认层，文字标注一起没了。
    // 矢量样式只 setMapStyle，沿用原版图层（含路名、地名）。
    if (this.satelliteOn) {
      const base = this.AMap.createDefaultLayer?.()
      if (base) this.amap.setLayers([base])
      this.satelliteOn = false
    }
    const vector = officialStyleUrl(styleId) || 'amap://styles/normal'
    this.amap.setMapStyle(vector)
    this.amap.setStatus?.({ showLabel: true })
  }

  private readView() {
    const c = this.map.getCenter()
    return {
      // 高德模式下 MapLibre 已是 GCJ，直接同步
      center: [c.lng, c.lat] as [number, number],
      zoom: clamp(this.map.getZoom() + ZOOM_OFFSET, MIN_ZOOM, MAX_ZOOM),
      pitch: 0,
      rotation: -this.map.getBearing(),
    }
  }

  private requestSync() {
    if (this.destroyed || !this.amap || this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.applyView()
    })
  }

  private applyView() {
    if (this.destroyed || !this.amap) return
    const view = this.readView()
    const last = this.lastView
    const rotationChanged =
      !last || Math.abs(last.rotation - view.rotation) > 1e-3
    const cameraChanged =
      !last ||
      Math.abs(last.zoom - view.zoom) > 1e-4 ||
      Math.abs(last.center[0] - view.center[0]) > 1e-7 ||
      Math.abs(last.center[1] - view.center[1]) > 1e-7
    if (!rotationChanged && !cameraChanged) return
    this.lastView = view
    try {
      if (rotationChanged) this.amap.setRotation(view.rotation, true)
      if (cameraChanged) {
        this.amap.setZoomAndCenter(view.zoom, view.center, true)
      }
    } catch {
      /* SDK 偶发 */
    }
  }

  private async waitForSize() {
    if (!this.host) return
    for (let i = 0; i < 20; i++) {
      if (this.destroyed) return
      if (this.host.clientWidth > 0 && this.host.clientHeight > 0) return
      await new Promise((r) => setTimeout(r, 50))
    }
  }

  private teardownAmap() {
    for (const name of ['move', 'zoom', 'rotate', 'pitch', 'render'] as const) {
      this.map.off(name, this.onViewChange)
    }
    this.map.off('resize', this.onResize)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    if (this.frame) {
      cancelAnimationFrame(this.frame)
      this.frame = 0
    }
    try {
      this.amap?.destroy()
    } catch {
      /* ignore */
    }
    this.amap = null
    this.host?.remove()
    this.host = null
    this.lastView = null
    this.map.getCanvas().style.background = ''
  }
}
