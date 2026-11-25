import { SPEED_COLORS_BY_TONE, type MapTone } from './palette'

/** 按瞬时速度划分：步行 / 驾车 / 飞行 */

export type SpeedClassId = 'walk' | 'car' | 'plane' | 'unknown'

/** year=按文件名年份；speed=按移动速度 */
export type PointColorMode = 'year' | 'speed'

export interface SpeedClassMeta {
  id: SpeedClassId
  label: string
  /** 展示用说明 */
  hint: string
  /** 默认浅底色，图例请用 colorForSpeed */
  color: string
  /** km/h 下界（含） */
  minKmh: number
  /** km/h 上界（不含）；Infinity 表示无上界 */
  maxKmh: number
}

export const SPEED_CLASSES: SpeedClassMeta[] = [
  {
    id: 'walk',
    label: '步行',
    hint: '< 6 km/h',
    color: SPEED_COLORS_BY_TONE.light.walk,
    minKmh: 0,
    maxKmh: 6,
  },
  {
    id: 'car',
    label: '驾车',
    hint: '6–140 km/h',
    color: SPEED_COLORS_BY_TONE.light.car,
    minKmh: 6,
    maxKmh: 140,
  },
  {
    id: 'plane',
    label: '飞行',
    hint: '> 140 km/h',
    color: SPEED_COLORS_BY_TONE.light.plane,
    minKmh: 140,
    maxKmh: Infinity,
  },
]

/** @deprecated 用 colorForSpeed(id, tone) */
export const SPEED_CLASS_COLOR: Record<SpeedClassId, string> =
  SPEED_COLORS_BY_TONE.light

export function colorForSpeed(
  id: SpeedClassId,
  tone: MapTone = 'light',
): string {
  return SPEED_COLORS_BY_TONE[tone][id]
}

export function classifySpeedKmh(kmh: number | null | undefined): SpeedClassId {
  if (kmh == null || !Number.isFinite(kmh) || kmh < 0) return 'unknown'
  if (kmh < 6) return 'walk'
  if (kmh <= 140) return 'car'
  return 'plane'
}
