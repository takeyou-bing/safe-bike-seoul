import type { NextRequest } from "next/server";
import { errorResponse, haversineM, numberParam, seoulLatLng } from "@/lib/server/http";
import { getAllStations } from "@/lib/server/seoulBike";
import { rateLimit } from "@/lib/server/rateLimit";

/**
 * GET /api/stations — 따릉이 실시간 대여정보
 *   ?lat=37.528&lng=126.932&radius=1000&limit=50  좌표 주변 대여소 (가까운 순)
 *   (좌표 없이 호출하면 서울 전체 대여소)
 */
export async function GET(request: NextRequest) {
  // IP별 요청 속도 제한 (초과 시 429 + Retry-After)
  const limited = rateLimit(request, "default");
  if (limited) return limited;

  try {
    const params = request.nextUrl.searchParams;
    const center = seoulLatLng(params, false);
    const radius = numberParam(params, "radius", { min: 50, max: 5000, fallback: 1000 })!;
    const limit = numberParam(params, "limit", { min: 1, max: 500, fallback: 50 })!;

    const { stations: all, fetchedAt } = await getAllStations();
    const data = center
      ? all
          .map((s) => ({ ...s, distanceM: Math.round(haversineM(center, s)) }))
          .filter((s) => s.distanceM <= radius)
          .sort((a, b) => a.distanceM - b.distanceM)
          .slice(0, limit)
      : all;

    // fetchedAt: 서울 API에서 실제로 받아 온 시각 (서버 캐시를 거쳐도 원본 조회 시각 유지)
    return Response.json({ data, source: "서울 열린데이터광장 공공자전거 실시간 대여정보", fetchedAt });
  } catch (e) {
    return errorResponse(e, "api/stations");
  }
}
