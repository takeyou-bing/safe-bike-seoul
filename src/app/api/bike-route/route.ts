import type { NextRequest } from "next/server";
import type { BikeRouteMode, BikeRouteResults } from "@/lib/api-types";
import { ApiError, errorResponse, numberParam } from "@/lib/server/http";
import { getBikeRoute } from "@/lib/server/kakaoBikeRoute";
import { rateLimit } from "@/lib/server/rateLimit";

const MODES: BikeRouteMode[] = ["BIKE_ONLY", "SHORTEST"];

const point = (params: URLSearchParams, prefix: "start" | "end") => ({
  lat: numberParam(params, `${prefix}Lat`, { min: 37.0, max: 38.0 }),
  lng: numberParam(params, `${prefix}Lng`, { min: 126.5, max: 127.5 }),
});

/**
 * GET /api/bike-route?startLat=&startLng=&endLat=&endLng=
 * 카카오맵 자전거 경로 API로 '자전거도로 우선(BIKE_ONLY)'과 '최단 경로(SHORTEST)'를 함께 조회합니다.
 * 경로를 임의로 만들지 않으며, 실패하면 모드별 실패 사유를 돌려줍니다.
 */
export async function GET(request: NextRequest) {
  // IP별 요청 속도 제한 (초과 시 429 + Retry-After)
  const limited = rateLimit(request, "bike-route");
  if (limited) return limited;

  try {
    const params = request.nextUrl.searchParams;
    const start = point(params, "start");
    const end = point(params, "end");
    if (start.lat === undefined || start.lng === undefined || end.lat === undefined || end.lng === undefined) {
      throw new ApiError(400, "startLat, startLng, endLat, endLng 값을 모두 입력하세요.");
    }
    const s = { lat: start.lat, lng: start.lng };
    const e = { lat: end.lat, lng: end.lng };

    const settled = await Promise.allSettled(MODES.map((m) => getBikeRoute(s, e, m)));

    // 두 모드 모두 인증·권한·한도 등 같은 이유로 실패하면 그 오류를 그대로 응답
    const failures = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failures.length === MODES.length) {
      const first = failures[0].reason;
      if (first instanceof ApiError && first.status !== 422) return errorResponse(first, "api/bike-route");
    }

    const data = Object.fromEntries(
      settled.map((r, i) => [
        MODES[i],
        r.status === "fulfilled"
          ? { route: r.value }
          : { error: r.reason instanceof ApiError ? r.reason.message : "경로를 조회하지 못했습니다." },
      ]),
    ) as BikeRouteResults;

    for (const f of failures) {
      if (!(f.reason instanceof ApiError)) console.error(`[api/bike-route] 예상치 못한 오류: ${f.reason instanceof Error ? f.reason.name : typeof f.reason}`);
    }

    // fetchedAt: 성공한 경로 중 카카오 API에서 가장 먼저 받아 온 시각 (캐시를 거쳐도 원본 조회 시각 유지)
    const times = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value.fetchedAt] : [])).sort();
    return Response.json({ data, source: "카카오맵 자전거 경로 API", fetchedAt: times[0] ?? new Date().toISOString() });
  } catch (err) {
    return errorResponse(err, "api/bike-route");
  }
}
