/**
 * WGS-84 ↔ GCJ-02（火星坐标）转换。
 * 高德/腾讯等国内图商底图用 GCJ-02；GPX 一般是 WGS-84，叠图前必须转换。
 */

const PI = Math.PI
const A = 6378245.0
const EE = 0.00669342162296594323

function outOfChina(lat: number, lon: number): boolean {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(x: number, y: number): number {
  let ret =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x))
  ret +=
    ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) /
    3.0
  ret +=
    ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0
  ret +=
    ((160.0 * Math.sin((y / 12.0) * PI) + 320.0 * Math.sin((y * PI) / 30.0)) *
      2.0) /
    3.0
  return ret
}

function transformLon(x: number, y: number): number {
  let ret =
    300.0 +
    x +
    2.0 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x))
  ret +=
    ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) /
    3.0
  ret +=
    ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0
  ret +=
    ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) *
      2.0) /
    3.0
  return ret
}

function delta(lat: number, lon: number): [number, number] {
  let dLat = transformLat(lon - 105.0, lat - 35.0)
  let dLon = transformLon(lon - 105.0, lat - 35.0)
  const radLat = (lat / 180.0) * PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI)
  dLon = (dLon * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI)
  return [dLat, dLon]
}

/** @returns [lon, lat] GCJ-02 */
export function wgs84ToGcj02(lon: number, lat: number): [number, number] {
  if (outOfChina(lat, lon)) return [lon, lat]
  const [dLat, dLon] = delta(lat, lon)
  return [lon + dLon, lat + dLat]
}

/** @returns [lon, lat] WGS-84 */
export function gcj02ToWgs84(lon: number, lat: number): [number, number] {
  if (outOfChina(lat, lon)) return [lon, lat]
  const [dLat, dLon] = delta(lat, lon)
  return [lon - dLon, lat - dLat]
}

function transformPosition(
  pos: GeoJSON.Position,
  fn: (lon: number, lat: number) => [number, number],
): GeoJSON.Position {
  const [lon, lat, ...rest] = pos
  const [nLon, nLat] = fn(lon, lat)
  return rest.length ? [nLon, nLat, ...rest] : [nLon, nLat]
}

function transformCoords(
  coords: GeoJSON.Position | GeoJSON.Position[] | GeoJSON.Position[][] | GeoJSON.Position[][][],
  fn: (lon: number, lat: number) => [number, number],
): typeof coords {
  if (typeof coords[0] === 'number') {
    return transformPosition(coords as GeoJSON.Position, fn)
  }
  return (coords as GeoJSON.Position[]).map((c) =>
    transformCoords(c as never, fn),
  ) as typeof coords
}

export function transformFeatureCollection(
  fc: GeoJSON.FeatureCollection,
  fn: (lon: number, lat: number) => [number, number],
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => {
      if (!f.geometry || !('coordinates' in f.geometry)) return f
      return {
        ...f,
        geometry: {
          ...f.geometry,
          coordinates: transformCoords(
            f.geometry.coordinates as never,
            fn,
          ) as never,
        },
      }
    }),
  }
}

export function featureCollectionToGcj02(
  fc: GeoJSON.FeatureCollection,
): GeoJSON.FeatureCollection {
  return transformFeatureCollection(fc, wgs84ToGcj02)
}

/** bbox: [west, south, east, north] */
export function bboxToGcj02(
  bbox: [number, number, number, number],
): [number, number, number, number] {
  const [w, s, e, n] = bbox
  const corners = [
    wgs84ToGcj02(w, s),
    wgs84ToGcj02(e, s),
    wgs84ToGcj02(w, n),
    wgs84ToGcj02(e, n),
  ]
  return [
    Math.min(...corners.map((c) => c[0])),
    Math.min(...corners.map((c) => c[1])),
    Math.max(...corners.map((c) => c[0])),
    Math.max(...corners.map((c) => c[1])),
  ]
}
