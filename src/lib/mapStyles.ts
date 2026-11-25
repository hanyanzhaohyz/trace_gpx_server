import type { MapStyleId } from '../types'

export interface MapStyleOption {
  id: MapStyleId
  label: string
  hint: string
  /** 按钮上的示意色 */
  swatch: string
  url: string
}

/** 多种免费 MapLibre 底图，方便挑选观感 */
export const MAP_STYLE_LIST: MapStyleOption[] = [
  {
    id: 'positron',
    label: '浅色简约',
    hint: 'OpenFreeMap Positron',
    swatch: '#e8eef3',
    url: 'https://tiles.openfreemap.org/styles/positron',
  },
  {
    id: 'bright',
    label: '明亮清晰',
    hint: 'OpenFreeMap Bright',
    swatch: '#fff3e0',
    url: 'https://tiles.openfreemap.org/styles/bright',
  },
  {
    id: 'dark',
    label: '深色夜景',
    hint: 'OpenFreeMap Dark',
    swatch: '#1a1f2e',
    url: 'https://tiles.openfreemap.org/styles/dark',
  },
  {
    id: 'fiord',
    label: '峡湾蓝',
    hint: 'OpenFreeMap Fiord',
    swatch: '#2c3e50',
    url: 'https://tiles.openfreemap.org/styles/fiord',
  },
]

export const MAP_STYLES: Record<MapStyleId, MapStyleOption> = Object.fromEntries(
  MAP_STYLE_LIST.map((s) => [s.id, s]),
) as Record<MapStyleId, MapStyleOption>

export const DEFAULT_MAP_STYLE: MapStyleId = 'positron'
