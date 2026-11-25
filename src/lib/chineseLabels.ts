import type { Map as MapLibreMap } from 'maplibre-gl'

/**
 * 地名统一优先中文译名（国内外皆然）：
 * OpenFreeMap / OpenMapTiles 提供 name:zh / name:zh-Hans 等字段。
 * 有中文则显示中文（巴黎、东京），没有再退回本地名；国内同时去掉拼音。
 */
const CHINESE_FIRST_TEXT = [
  'coalesce',
  ['get', 'name:zh-Hans'],
  ['get', 'name:zh'],
  ['get', 'name:zh-Hant'],
  ['get', 'name_zh'],
  // 国内等本地汉字（不含拼音 latin）
  ['get', 'name:nonlatin'],
  ['get', 'name'],
] as unknown[]

function isNameLabelField(textField: unknown): boolean {
  if (textField == null) return false
  const s = JSON.stringify(textField)
  // 路盾牌等用 ref，不要动
  if (s.includes('"ref"') && !s.includes('name')) return false
  return (
    s.includes('name:latin') ||
    s.includes('name:nonlatin') ||
    s.includes('name_en') ||
    s.includes('name:en') ||
    s.includes('name_zh') ||
    s.includes('name:zh') ||
    s.includes('"name"')
  )
}

export function preferChineseLabels(map: MapLibreMap): void {
  const style = map.getStyle()
  if (!style?.layers) return

  for (const layer of style.layers) {
    if (layer.type !== 'symbol') continue
    const textField = map.getLayoutProperty(layer.id, 'text-field')
    if (!isNameLabelField(textField)) continue
    try {
      map.setLayoutProperty(layer.id, 'text-field', CHINESE_FIRST_TEXT as never)
    } catch {
      // 个别图层可能不允许改，忽略
    }
  }
}
