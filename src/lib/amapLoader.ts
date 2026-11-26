/** 高德 JS API 2.0 加载（官方要求在线加载，禁止打包进 bundle） */

export interface AmapConfig {
  configured: boolean
  key?: string
  serviceHost?: string
  reason?: string
}

type TileLayerCtor = {
  new (opts?: Record<string, unknown>): unknown
  Satellite: new (opts?: Record<string, unknown>) => unknown
  RoadNet: new (opts?: Record<string, unknown>) => unknown
}

export type AMapNS = {
  Map: new (
    container: string | HTMLElement,
    opts?: Record<string, unknown>,
  ) => AMapMap
  TileLayer: TileLayerCtor
  /** JS API 2.0：取回默认矢量底图（setLayers 换成卫星后要靠它还原） */
  createDefaultLayer?: () => unknown
}

export type AMapMap = {
  setZoomAndCenter: (
    zoom: number,
    center: [number, number],
    immediately?: boolean,
  ) => void
  setPitch: (pitch: number, immediately?: boolean) => void
  setRotation: (rotation: number, immediately?: boolean) => void
  setMapStyle: (style: string) => void
  setLayers: (layers: unknown[]) => void
  setFeatures?: (features: string | string[]) => void
  setStatus?: (status: { showLabel?: boolean }) => void
  resize: () => void
  destroy: () => void
  on: (event: string, handler: () => void) => void
}

declare global {
  interface Window {
    _AMapSecurityConfig?: {
      securityJsCode?: string
      serviceHost?: string
    }
    AMapLoader?: {
      load: (opts: {
        key: string
        version?: string
        plugins?: string[]
      }) => Promise<AMapNS>
    }
  }
}

let configPromise: Promise<AmapConfig> | null = null
let sdkPromise: Promise<AMapNS> | null = null

export function fetchAmapConfig(): Promise<AmapConfig> {
  if (!configPromise) {
    configPromise = fetch('/api/amap/config')
      .then((r) => r.json() as Promise<AmapConfig>)
      .catch(() => ({
        configured: false,
        reason: '无法读取 /api/amap/config',
      }))
  }
  return configPromise
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${src}"]`,
    )
    if (existing) {
      if (window.AMapLoader) {
        resolve()
        return
      }
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () =>
        reject(new Error(`加载失败: ${src}`)),
      )
      return
    }
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => reject(new Error(`加载失败: ${src}`))
    document.head.appendChild(el)
  })
}

/** 加载官方 AMap；未配置 Key 时返回 null */
export async function loadAmapSdk(): Promise<AMapNS | null> {
  const cfg = await fetchAmapConfig()
  if (!cfg.configured || !cfg.key) return null

  if (!sdkPromise) {
    sdkPromise = (async () => {
      // 官方校验：必须是 http(s)://主机/_AMapService，且作为一级路径。
      // 相对路径 /_AMapService 会弹出「请以 _AMapService 作为一级路由」。
      const serviceHost = `${location.origin}/_AMapService`
      window._AMapSecurityConfig = { serviceHost }
      await loadScript('https://webapi.amap.com/loader.js')
      if (!window.AMapLoader) {
        throw new Error('AMapLoader 未就绪')
      }
      return window.AMapLoader.load({
        key: cfg.key!,
        version: '2.0',
      })
    })().catch((err) => {
      sdkPromise = null
      throw err
    })
  }
  return sdkPromise
}
