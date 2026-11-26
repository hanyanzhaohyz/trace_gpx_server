import type { MapStyleId } from '../types'
import type { SpeedClassId } from './speedClass'

/** 底图明暗：地名描边等仍按浅/深两档 */
export type MapTone = 'light' | 'dark'

export function mapTone(style: MapStyleId): MapTone {
  return style === 'dark' ||
    style === 'fiord' ||
    style === 'amap-dark' ||
    style === 'amap-darkblue' ||
    style === 'amap-sat-road'
    ? 'dark'
    : 'light'
}

type SpeedPaint = Record<SpeedClassId, string>

interface StylePaint {
  /** 年份色，相邻年冷暖交替，并避开底图主色 */
  years: readonly string[]
  speed: SpeedPaint
  opacity: number
}

function paint(
  years: readonly string[],
  speed: SpeedPaint,
  opacity: number,
): StylePaint {
  return { years, speed, opacity }
}

/**
 * 每套底图单独配色：浅纸用沉色，深底和影像用柔光，
 * 并躲开底图本身的主色（薄荷底少用绿，黄底少用黄，酒红底用金与灰绿）。
 */
const STYLE_PAINT: Record<MapStyleId, StylePaint> = {
  'amap-normal': paint(
    ['#1E5C45', '#C45C38', '#2A4A7A', '#A67C2D', '#6A3D82', '#B4234E'],
    { walk: '#1E5C45', car: '#2A4A7A', plane: '#C45C38', unknown: '#6E675C' },
    0.76,
  ),
  'amap-light': paint(
    ['#1A5E66', '#C46A42', '#2C4C88', '#8E7030', '#5A457E', '#A33B58'],
    { walk: '#1A5E66', car: '#2C4C88', plane: '#C46A42', unknown: '#66707A' },
    0.76,
  ),
  'amap-whitesmoke': paint(
    ['#3A6554', '#B85A46', '#3A4E74', '#8A7040', '#684C74', '#9E4A5E'],
    { walk: '#3A6554', car: '#3A4E74', plane: '#B85A46', unknown: '#6A6E68' },
    0.78,
  ),
  'amap-fresh': paint(
    ['#8E3A4C', '#243E68', '#A36B28', '#4A3C74', '#6E4030', '#1E4E58'],
    { walk: '#1E4E58', car: '#243E68', plane: '#A36B28', unknown: '#5C685C' },
    0.8,
  ),
  'amap-grey': paint(
    ['#0E6E52', '#D4653A', '#1E4F9E', '#C4922A', '#6A3AA4', '#C2185B'],
    { walk: '#0E6E52', car: '#1E4F9E', plane: '#D4653A', unknown: '#5C6168' },
    0.8,
  ),
  'amap-dark': paint(
    ['#7DDEC4', '#F0B48A', '#9EC0E8', '#F0D08A', '#D4B0E4', '#FF9BB8'],
    { walk: '#7DDEC4', car: '#9EC0E8', plane: '#F0B48A', unknown: '#A8A8A8' },
    0.82,
  ),
  'amap-macaron': paint(
    ['#0F6E6A', '#1E3A6E', '#6B5420', '#3E4A28', '#4A3568', '#8C4A2A'],
    { walk: '#0F6E6A', car: '#1E3A6E', plane: '#8C4A2A', unknown: '#6A5860' },
    0.82,
  ),
  'amap-darkblue': paint(
    ['#9EE7E0', '#F2C2A0', '#A9CFFF', '#F6E3A0', '#E2C2F2', '#FFB3C7'],
    { walk: '#9EE7E0', car: '#A9CFFF', plane: '#F2C2A0', unknown: '#B4C0CC' },
    0.86,
  ),
  'amap-sat-road': paint(
    ['#FFE08A', '#5EE0A0', '#7EC8FF', '#FF8A5B', '#E2B0FF', '#FF6B8A'],
    { walk: '#B6F25C', car: '#4CC3FF', plane: '#FFB020', unknown: '#F2F2F2' },
    0.92,
  ),
  positron: paint(
    ['#1F5C58', '#C45C48', '#2E4C86', '#A07A2E', '#5C3E86', '#A33A58'],
    { walk: '#1F5C58', car: '#2E4C86', plane: '#C45C48', unknown: '#667078' },
    0.76,
  ),
  bright: paint(
    ['#146B4A', '#D05A32', '#274E96', '#B08A1E', '#643C96', '#C2185B'],
    { walk: '#146B4A', car: '#274E96', plane: '#D05A32', unknown: '#6A645C' },
    0.76,
  ),
  dark: paint(
    ['#6ED0C4', '#F0B48A', '#8FB4E0', '#E6C98A', '#D2A8E0', '#FF8FB0'],
    { walk: '#6ED0C4', car: '#8FB4E0', plane: '#F0B48A', unknown: '#B0B0B0' },
    0.82,
  ),
  fiord: paint(
    ['#F0C9A0', '#E8A07A', '#F3E0B0', '#C9D6A8', '#E7B8C8', '#8FD0C4'],
    { walk: '#8FD0C4', car: '#F3E0B0', plane: '#E8A07A', unknown: '#C4CCD4' },
    0.84,
  ),
}

const FALLBACK_STYLE: MapStyleId = 'amap-normal'

function stylePaint(style: MapStyleId): StylePaint {
  return STYLE_PAINT[style] ?? STYLE_PAINT[FALLBACK_STYLE]
}

/** 浅色标准底的年份色，供旧调用默认值 */
export const YEAR_COLORS = STYLE_PAINT[FALLBACK_STYLE].years

export function colorForYearTone(
  year: number | null | undefined,
  style: MapStyleId = FALLBACK_STYLE,
): string {
  const palette = stylePaint(style).years
  if (year == null || !Number.isFinite(year)) return stylePaint(style).speed.unknown
  const idx =
    ((year - 2020) % palette.length + palette.length) % palette.length
  return palette[idx]
}

export function colorForSpeedTone(
  id: SpeedClassId,
  style: MapStyleId = FALLBACK_STYLE,
): string {
  return stylePaint(style).speed[id] ?? stylePaint(style).speed.unknown
}

export function paintFeatureColor(
  props: GeoJSON.GeoJsonProperties,
  style: MapStyleId,
): string {
  const unknown = stylePaint(style).speed.unknown
  if (!props) return unknown
  if (props.kind === 'year' || props.year != null) {
    const y = Number(props.year)
    return colorForYearTone(Number.isFinite(y) ? y : null, style)
  }
  if (props.kind === 'speed' || props.speedClass) {
    return colorForSpeedTone(String(props.speedClass) as SpeedClassId, style)
  }
  return typeof props.color === 'string' ? props.color : unknown
}

export function recolorFeatureCollection(
  data: GeoJSON.FeatureCollection,
  style: MapStyleId,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: data.features.map((f) => ({
      ...f,
      properties: {
        ...(f.properties || {}),
        color: paintFeatureColor(f.properties, style),
      },
    })),
  }
}

export function pointOpacityForStyle(style: MapStyleId): number {
  return stylePaint(style).opacity
}
