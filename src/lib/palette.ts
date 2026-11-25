import type { MapStyleId } from '../types'
import type { SpeedClassId } from './speedClass'

/** 底图明暗：决定轨迹点配色 */
export type MapTone = 'light' | 'dark'

export function mapTone(style: MapStyleId): MapTone {
  return style === 'dark' || style === 'fiord' ? 'dark' : 'light'
}

/**
 * 年份色：相邻年份（含首尾环回）冷暖交替、色相拉开，
 * 避免 2025/2026 这类接壤年都落在青绿系里难分。
 * 浅底用深沉色，深底用柔光色。
 */
export const YEAR_COLORS_BY_TONE: Record<MapTone, readonly string[]> = {
  light: [
    '#0B6E4F', // bottle green  — 2020 / 2026
    '#C45D3A', // terracotta    — 2021
    '#2E5090', // lapis         — 2022
    '#B8860B', // antique gold  — 2023
    '#6B3FA0', // amethyst      — 2024
    '#C2185B', // raspberry     — 2025（相对 2026 绿强对比）
  ],
  dark: [
    '#5FBFB0', // seafoam       — 2020 / 2026
    '#E8A87C', // sand coral    — 2021
    '#7BA3D4', // mist blue     — 2022
    '#E6C07B', // champagne     — 2023
    '#C9A0DC', // soft orchid   — 2024
    '#FF7AA2', // rose bloom    — 2025（相对 2026 青绿强对比）
  ],
}

/** 步行 / 驾车 / 飞行：冷绿、钴蓝、暖橙，三类一眼可辨 */
export const SPEED_COLORS_BY_TONE: Record<
  MapTone,
  Record<SpeedClassId, string>
> = {
  light: {
    walk: '#0B6E4F', // bottle green
    car: '#1D4ED8', // cobalt
    plane: '#C2410C', // burnt orange
    unknown: '#6B7280',
  },
  dark: {
    walk: '#5FBFB0', // seafoam
    car: '#60A5FA', // sky blue
    plane: '#FB923C', // soft orange
    unknown: '#9CA3AF',
  },
}

export const FALLBACK_COLOR: Record<MapTone, string> = {
  light: '#6B7280',
  dark: '#9CA3AF',
}

export function colorForYearTone(
  year: number | null | undefined,
  tone: MapTone,
): string {
  const palette = YEAR_COLORS_BY_TONE[tone]
  if (year == null || !Number.isFinite(year)) return FALLBACK_COLOR[tone]
  const idx =
    ((year - 2020) % palette.length + palette.length) % palette.length
  return palette[idx]
}

export function colorForSpeedTone(
  id: SpeedClassId,
  tone: MapTone,
): string {
  return SPEED_COLORS_BY_TONE[tone][id] ?? FALLBACK_COLOR[tone]
}

/** 按 feature 语义属性上色（忽略服务端自带 color） */
export function paintFeatureColor(
  props: GeoJSON.GeoJsonProperties,
  tone: MapTone,
): string {
  if (!props) return FALLBACK_COLOR[tone]
  if (props.kind === 'year' || props.year != null) {
    const y = Number(props.year)
    return colorForYearTone(Number.isFinite(y) ? y : null, tone)
  }
  if (props.kind === 'speed' || props.speedClass) {
    return colorForSpeedTone(String(props.speedClass) as SpeedClassId, tone)
  }
  return typeof props.color === 'string' ? props.color : FALLBACK_COLOR[tone]
}

export function recolorFeatureCollection(
  data: GeoJSON.FeatureCollection,
  tone: MapTone,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: data.features.map((f) => ({
      ...f,
      properties: {
        ...(f.properties || {}),
        color: paintFeatureColor(f.properties, tone),
      },
    })),
  }
}

/** 点不透明度：浅底略实、深底略透，避免发灰或刺眼 */
export function pointOpacityForTone(tone: MapTone): number {
  return tone === 'dark' ? 0.78 : 0.72
}
