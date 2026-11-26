import type { AccidentSpot, LatLngPoint } from "@/lib/api-types";

/** 경로에서 이 거리 안에 있는 사고다발지역을 '경로 주변'으로 표시 */
export const ROUTE_ACCIDENT_RADIUS_M = 300;

export type RouteAccident = AccidentSpot & { distanceM: number };

const M_PER_DEG_LAT = 110_540;
const mPerDegLng = (lat0: number) => 111_320 * Math.cos((lat0 * Math.PI) / 180);

/** 점에서 경로(폴리라인)까지의 최단 거리(m)와, 가장 가까운 지점의 경로상 위치(0~1). */
function nearestOnPath(p: LatLngPoint, path: LatLngPoint[]): { distanceM: number; along: number } {
  const kx = mPerDegLng(p.lat);
  const qx = p.lng * kx;
  const qy = p.lat * M_PER_DEG_LAT;
  let best = { distanceM: Infinity, along: 0 };
  for (let i = 0; i < path.length - 1; i++) {
    const ax = path[i].lng * kx, ay = path[i].lat * M_PER_DEG_LAT;
    const bx = path[i + 1].lng * kx, by = path[i + 1].lat * M_PER_DEG_LAT;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((qx - ax) * dx + (qy - ay) * dy) / len2));
    const d = Math.hypot(qx - (ax + t * dx), qy - (ay + t * dy));
    if (d < best.distanceM) best = { distanceM: d, along: (i + t) / (path.length - 1) };
  }
  return best;
}

/**
 * 경로 주변 사고다발지역 (경로 진행 순서).
 * 거리는 다발지역 중심점 또는 범위(폴리곤 꼭짓점) 중 경로에 가장 가까운 점 기준입니다.
 */
export function accidentsNearPath(path: LatLngPoint[], spots: AccidentSpot[]): RouteAccident[] {
  if (path.length < 2) return [];
  return spots
    .map((s) => {
      const candidates = [s, ...s.polygons.flat()];
      let best = { distanceM: Infinity, along: 0 };
      for (const c of candidates) {
        const r = nearestOnPath(c, path);
        if (r.distanceM < best.distanceM) best = r;
      }
      return { s, ...best };
    })
    .filter((x) => x.distanceM <= ROUTE_ACCIDENT_RADIUS_M)
    .sort((x, y) => x.along - y.along)
    .map(({ s, distanceM }) => ({ ...s, distanceM: Math.round(distanceM) }));
}
