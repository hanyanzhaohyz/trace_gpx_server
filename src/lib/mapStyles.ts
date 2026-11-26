import type { StyleSpecification } from 'maplibre-gl'
import type { MapStyleId } from '../types'

export interface MapStyleOption {
  id: MapStyleId
  label: string
  hint: string
  /** 按钮上的示意色 */
  swatch: string
  /** MapLibre style URL，或内联 style */
  style: string | StyleSpecification
  /** 高德等国内图：轨迹需 WGS84→GCJ-02 */
  gcj02?: boolean
  /** 官方 JS API 样式名，如 normal / grey；有值则走官方底图 */
  amapTheme?: string
}

/** 官方样式一览：https://developer.amap.com/api/javascript-api-v2/guide/map/map-style */
const AMAP_THEMES: {
  id: MapStyleId
  label: string
  theme: string
  swatch: string
}[] = [
  { id: 'amap-normal', label: '标准', theme: 'normal', swatch: '#f3efe4' },
  { id: 'amap-light', label: '月光银', theme: 'light', swatch: '#e8eef3' },
  { id: 'amap-whitesmoke', label: '远山黛', theme: 'whitesmoke', swatch: '#f4f4f2' },
  { id: 'amap-fresh', label: '草色青', theme: 'fresh', swatch: '#d7f0dc' },
  { id: 'amap-grey', label: '雅士灰', theme: 'grey', swatch: '#d5d5d5' },
  { id: 'amap-dark', label: '幻影黑', theme: 'dark', swatch: '#1b1b1b' },
  { id: 'amap-macaron', label: '马卡龙', theme: 'macaron', swatch: '#f3b6d0' },
  { id: 'amap-darkblue', label: '极夜蓝', theme: 'darkblue', swatch: '#0c1c33' },
]

/** 高德底图由官方 JS API 绘制，MapLibre 只留透明画布给轨迹 */
function amapCanvas(id: string): StyleSpecification {
  return {
    version: 8,
    name: id,
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': 'rgba(0,0,0,0)' },
      },
    ],
  }
}

/** 多种底图。高德项只走官方 JS API，不附带免 key 栅格 */
export const MAP_STYLE_LIST: MapStyleOption[] = [
  ...AMAP_THEMES.map((item) => ({
    id: item.id,
    label: item.label,
    hint: `官方 amap://styles/${item.theme}`,
    swatch: item.swatch,
    style: amapCanvas(item.id),
    gcj02: true,
    amapTheme: item.theme,
  })),
  {
    id: 'amap-sat-road',
    label: '卫星',
    hint: '官方卫星影像',
    swatch: 'linear-gradient(135deg,#1a3a2a 0%,#ffe082 100%)',
    style: amapCanvas('amap-sat-road'),
    gcj02: true,
  },
  {
    id: 'positron',
    label: '浅色简约',
    hint: 'OpenFreeMap Positron',
    swatch: '#e8eef3',
    style: 'https://tiles.openfreemap.org/styles/positron',
  },
  {
    id: 'bright',
    label: '明亮清晰',
    hint: 'OpenFreeMap Bright',
    swatch: '#fff3e0',
    style: 'https://tiles.openfreemap.org/styles/bright',
  },
  {
    id: 'dark',
    label: '深色夜景',
    hint: 'OpenFreeMap Dark',
    swatch: '#1a1f2e',
    style: 'https://tiles.openfreemap.org/styles/dark',
  },
  {
    id: 'fiord',
    label: '峡湾蓝',
    hint: 'OpenFreeMap Fiord',
    swatch: '#2c3e50',
    style: 'https://tiles.openfreemap.org/styles/fiord',
  },
]

export const MAP_STYLES: Record<MapStyleId, MapStyleOption> = Object.fromEntries(
  MAP_STYLE_LIST.map((s) => [s.id, s]),
) as Record<MapStyleId, MapStyleOption>

export const DEFAULT_MAP_STYLE: MapStyleId = 'amap-normal'

export function resolveMapStyle(
  id: MapStyleId,
): string | StyleSpecification {
  return MAP_STYLES[id]?.style ?? MAP_STYLES['amap-normal'].style
}

export function styleUsesGcj02(id: MapStyleId): boolean {
  return Boolean(MAP_STYLES[id]?.gcj02)
}

export function isAmapStyleId(id: MapStyleId): boolean {
  return styleUsesGcj02(id)
}
