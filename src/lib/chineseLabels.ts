import type { Map as MapLibreMap, ExpressionSpecification } from 'maplibre-gl'

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
] as unknown as ExpressionSpecification

const LOCAL_PLACE_LAYER = 'trace-local-places'
const LOCAL_POI_LAYER = 'trace-local-poi'

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

function openmaptilesSourceId(map: MapLibreMap): string | null {
  const style = map.getStyle()
  if (!style?.sources) return null
  for (const [id, src] of Object.entries(style.sources)) {
    if (!src || typeof src !== 'object') continue
    if ((src as { type?: string }).type !== 'vector') continue
    // OpenFreeMap / OpenMapTiles
    const url = 'url' in src ? String((src as { url?: string }).url || '') : ''
    const tiles =
      'tiles' in src && Array.isArray((src as { tiles?: string[] }).tiles)
        ? (src as { tiles: string[] }).tiles.join(' ')
        : ''
    if (
      id.includes('openmaptiles') ||
      url.includes('openmaptiles') ||
      url.includes('openfreemap') ||
      tiles.includes('openfreemap')
    ) {
      return id
    }
  }
  // 兜底：第一个 vector source
  for (const [id, src] of Object.entries(style.sources)) {
    if (src && typeof src === 'object' && (src as { type?: string }).type === 'vector') {
      return id
    }
  }
  return null
}

export function preferChineseLabels(map: MapLibreMap): void {
  const style = map.getStyle()
  if (!style?.layers) return

  for (const layer of style.layers) {
    if (layer.type !== 'symbol') continue
    const textField = map.getLayoutProperty(layer.id, 'text-field')
    if (!isNameLabelField(textField)) continue
    try {
      map.setLayoutProperty(layer.id, 'text-field', CHINESE_FIRST_TEXT)
    } catch {
      // 个别图层可能不允许改，忽略
    }
    // Liberty 的社区地名带 uppercase，中文场景无意义且挤占显示
    try {
      const transform = map.getLayoutProperty(layer.id, 'text-transform')
      if (transform && transform !== 'none') {
        map.setLayoutProperty(layer.id, 'text-transform', 'none')
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * OpenFreeMap 默认样式几乎不突出 neighbourhood/suburb（小区/片区），
 * 且 POI 要放到很大才出字。这里在矢量底图上补一层社区地名，并提前露出 POI。
 * 数据仍来自 OSM：库里没有的小区名无法凭空出现。
 */
export function enhanceLocalPlaceLabels(
  map: MapLibreMap,
  tone: 'light' | 'dark' = 'light',
): void {
  const sourceId = openmaptilesSourceId(map)
  if (!sourceId) return

  preferChineseLabels(map)

  const textColor = tone === 'dark' ? '#f1f5f9' : '#1a1a1a'
  const haloColor =
    tone === 'dark' ? 'rgba(15,23,42,0.88)' : 'rgba(255,255,255,0.92)'
  const poiColor = tone === 'dark' ? '#cbd5e1' : '#334155'

  // 放大并提前显示原有 place「其他」类（含 neighbourhood）
  for (const id of ['label_other', 'place_other', 'place-other']) {
    if (!map.getLayer(id)) continue
    try {
      map.setLayerZoomRange(id, 11, 24)
      map.setLayoutProperty(id, 'text-size', [
        'interpolate',
        ['linear'],
        ['zoom'],
        11,
        11,
        14,
        14,
        16,
        16,
      ] as ExpressionSpecification)
      map.setLayoutProperty(id, 'text-transform', 'none')
      map.setLayoutProperty(id, 'text-font', ['Noto Sans Regular'])
      map.setLayoutProperty(id, 'text-padding', 4)
    } catch {
      /* ignore */
    }
  }

  // POI：默认 z15+，降到 z13 起，方便看到园区/设施名
  for (const id of ['poi_r1', 'poi_r7', 'poi_r20', 'poi-level-1', 'poi-level-2', 'poi-level-3']) {
    if (!map.getLayer(id)) continue
    try {
      const min = id.includes('20') || id.includes('3') ? 15 : id.includes('7') || id.includes('2') ? 14 : 13
      map.setLayerZoomRange(id, min, 24)
    } catch {
      /* ignore */
    }
  }

  if (map.getLayer(LOCAL_PLACE_LAYER)) {
    try {
      map.removeLayer(LOCAL_PLACE_LAYER)
    } catch {
      /* ignore */
    }
  }
  if (map.getLayer(LOCAL_POI_LAYER)) {
    try {
      map.removeLayer(LOCAL_POI_LAYER)
    } catch {
      /* ignore */
    }
  }

  // 专用社区/片区注记（压过小路名，尽量不被挤掉）
  try {
    map.addLayer({
      id: LOCAL_PLACE_LAYER,
      type: 'symbol',
      source: sourceId,
      'source-layer': 'place',
      minzoom: 12,
      filter: [
        'match',
        ['get', 'class'],
        [
          'neighbourhood',
          'suburb',
          'quarter',
          'hamlet',
          'locality',
          'isolated_dwelling',
          'residential',
        ],
        true,
        false,
      ],
      layout: {
        'text-field': CHINESE_FIRST_TEXT,
        'text-font': ['Noto Sans Regular'],
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          12,
          12,
          14,
          14,
          16,
          17,
        ],
        'text-transform': 'none',
        'text-letter-spacing': 0.02,
        'text-max-width': 10,
        'text-padding': 2,
        'text-allow-overlap': false,
        'text-optional': false,
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
      },
      paint: {
        'text-color': textColor,
        'text-halo-color': haloColor,
        'text-halo-width': 1.6,
        'text-halo-blur': 0.4,
      },
    })
  } catch (e) {
    console.warn('[迹] 无法添加社区注记层', e)
  }

  // 住宅区相关 POI（公园/学校等常与小区名一起有助于定位）
  try {
    map.addLayer({
      id: LOCAL_POI_LAYER,
      type: 'symbol',
      source: sourceId,
      'source-layer': 'poi',
      minzoom: 14,
      filter: [
        'all',
        ['has', 'name'],
        [
          'match',
          ['get', 'class'],
          ['park', 'school', 'college', 'university', 'stadium', 'cemetery', 'zoo'],
          true,
          false,
        ],
      ],
      layout: {
        'text-field': CHINESE_FIRST_TEXT,
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
        'text-transform': 'none',
        'text-max-width': 9,
        'text-padding': 2,
      },
      paint: {
        'text-color': poiColor,
        'text-halo-color': haloColor,
        'text-halo-width': 1.4,
      },
    })
  } catch {
    /* ignore */
  }
}
