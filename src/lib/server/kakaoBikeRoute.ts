import "server-only";

import type { BikeRoute, BikeRouteMode, LatLngPoint } from "@/lib/api-types";
import { cached } from "./cache";
import { requireServerKey } from "./env";
import { ApiError, fetchUpstream } from "./http";
import { explainKakaoError } from "./kakaoErrors";
import { consumeQuota } from "./quota";

/**
 * 카카오맵 REST API — 자전거 경로 조회
 * GET https://dapi.kakao.com/v2/routing/bicycle
 * 문서: https://developers.kakao.com/docs/ko/kakaomap/rest-api
 */
const ENDPOINT = "https://dapi.kakao.com/v2/routing/bicycle";
const LABEL = "카카오맵 자전거 경로 API";
const TTL_MS = 10 * 60_000;

type Step = { properties: { distance: number; time: number; guidance?: string }; path?: { points?: [number, number][] } };
type KakaoBikeResponse = {
  status: string;
  route?: {
    properties: { totalDistance: number; totalTime: number; landingUrl?: string };
    legs: { steps: Step[] }[];
  };
};

/** status 값별 안내 (응답 HTTP 200 본문에 담겨 옴) */
const STATUS_MESSAGE: Record<string, string> = {
  SAME_POINT: "출발지와 도착지가 같습니다.",
  START_LINK_NOT_FOUND: "출발 대여소 근처에서 자전거로 갈 수 있는 길을 찾지 못했습니다.",
  END_LINK_NOT_FOUND: "목적지 근처에서 자전거로 갈 수 있는 길을 찾지 못했습니다.",
  TOO_MANY_SEARCH_LINK: "경로 탐색 범위가 너무 넓어 경로를 찾지 못했습니다.",
  TOO_FAR_AWAY: "출발지와 목적지 사이가 너무 멀어 자전거 경로를 제공하지 않습니다.",
  ROUTE_RESULT_NOT_FOUND: "조건에 맞는 자전거 경로가 없습니다.",
};

async function loadRoute(start: LatLngPoint, end: LatLngPoint, mode: BikeRouteMode): Promise<BikeRoute> {
  const key = requireServerKey("KAKAO_REST_API_KEY");
  const params = new URLSearchParams({
    start_x: String(start.lng),
    start_y: String(start.lat),
    end_x: String(end.lng),
    end_y: String(end.lat),
    route_mode: mode,
  });

  // 캐시에 없어 카카오를 실제로 부를 때만 서비스 전체 일일 한도에서 1건 차감
  consumeQuota("kakao-bike-route");

  let json: KakaoBikeResponse;
  try {
    json = (await fetchUpstream(`${ENDPOINT}?${params}`, LABEL, { headers: { Authorization: `KakaoAK ${key}` } })) as KakaoBikeResponse;
  } catch (e) {
    throw e instanceof ApiError ? explainKakaoError(e, "자전거 경로 API", "무료 1,000건") : e;
  }

  if (json.status !== "OK" || !json.route) {
    throw new ApiError(422, STATUS_MESSAGE[json.status] ?? `자전거 경로를 조회하지 못했습니다 (status: ${String(json.status).slice(0, 40)}).`);
  }

  const path: LatLngPoint[] = [];
  for (const leg of json.route.legs ?? []) {
    for (const step of leg.steps ?? []) {
      for (const [x, y] of step.path?.points ?? []) {
        const last = path[path.length - 1];
        if (!last || last.lat !== y || last.lng !== x) path.push({ lat: y, lng: x });
      }
    }
  }
  if (path.length < 2) throw new ApiError(502, `${LABEL} 응답에 경로 좌표가 없습니다.`);

  return {
    mode,
    distanceM: json.route.properties.totalDistance,
    durationSec: json.route.properties.totalTime,
    landingUrl: json.route.properties.landingUrl?.startsWith("https://map.kakao.com/") ? json.route.properties.landingUrl : undefined,
    path,
    fetchedAt: new Date().toISOString(),
  };
}

const round = (n: number) => n.toFixed(6);

/** 같은 출발·도착·모드는 10분간 캐시 (자전거 경로 API 일일 무료 한도 1,000건 절약) */
export function getBikeRoute(start: LatLngPoint, end: LatLngPoint, mode: BikeRouteMode): Promise<BikeRoute> {
  const key = `kakao-bike:v2:${mode}:${round(start.lat)},${round(start.lng)}>${round(end.lat)},${round(end.lng)}`;
  return cached(key, TTL_MS, () => loadRoute(start, end, mode));
}
