import { colorForSpeedTone } from './palette'
import type { MapStyleId } from '../types'

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
    color: colorForSpeedTone('walk'),
    minKmh: 0,
    maxKmh: 6,
  },
  {
    id: 'car',
    label: '驾车',
    hint: '6–140 km/h',
    color: colorForSpeedTone('car'),
    minKmh: 6,
    maxKmh: 140,
  },
  {
    id: 'plane',
    label: '飞行',
    hint: '> 140 km/h',
    color: colorForSpeedTone('plane'),
    minKmh: 140,
    maxKmh: Infinity,
  },
]

export function colorForSpeed(
  id: SpeedClassId,
  style: MapStyleId = 'amap-normal',
): string {
  return colorForSpeedTone(id, style)
}

export function classifySpeedKmh(kmh: number | null | undefined): SpeedClassId {
  if (kmh == null || !Number.isFinite(kmh) || kmh < 0) return 'unknown'
  if (kmh < 6) return 'walk'
  if (kmh <= 140) return 'car'
  return 'plane'
}
