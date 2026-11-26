import type { NextRequest } from "next/server";
import type { AccidentData } from "@/lib/api-types";
import { getLatestAccidentYear, getSeoulAccidentSpots, SEOUL_GU } from "@/lib/server/accidents";
import { ApiError, errorResponse, haversineM, numberParam, seoulLatLng } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";

const CRITERIA = "1년간 발생한 자전거 관련 교통사고가 4건 이상(사망사고 포함 시 3건 이상)인 지점";

/**
 * GET /api/accidents — 서울시 자전거 교통사고 다발지역 (한국도로교통공단, 과거 사고 통계)
 *   ?year=2025        조회 연도 (생략 시 데이터가 있는 최신 연도를 자동 확인)
 *   ?gu=440,560       자치구 코드(쉼표 구분, 생략 시 서울 전체)
 *   ?lat=&lng=&radius= 좌표 주변만
 */
export async function GET(request: NextRequest) {
  // IP별 요청 속도 제한 (초과 시 429 + Retry-After)
  const limited = rateLimit(request, "default");
  if (limited) return limited;

  try {
    const params = request.nextUrl.searchParams;
    const latestYear = await getLatestAccidentYear();
    const year = numberParam(params, "year", { min: 2012, max: latestYear, fallback: latestYear })!;

    const guParam = params.get("gu");
    const gu = guParam ? guParam.split(",").map((g) => g.trim()) : Object.keys(SEOUL_GU);
    const unknown = gu.filter((g) => !(g in SEOUL_GU));
    if (unknown.length) throw new ApiError(400, `알 수 없는 자치구 코드: ${unknown.join(", ").slice(0, 60)}`);

    const center = seoulLatLng(params, false);
    const radius = numberParam(params, "radius", { min: 50, max: 10000, fallback: 2000 })!;

    const snapshot = await getSeoulAccidentSpots(year, [...new Set(gu)].sort());
    let spots = snapshot.spots;
    if (center) {
      spots = spots
        .map((a) => ({ ...a, distanceM: Math.round(haversineM(center, a)) }))
        .filter((a) => a.distanceM <= radius)
        .sort((a, b) => a.distanceM - b.distanceM);
    }

    const data: AccidentData = { year, latestYear, criteria: CRITERIA, spots, fetchedAt: snapshot.fetchedAt };
    return Response.json({ data, source: "한국도로교통공단 자전거 교통사고 다발지역정보", fetchedAt: snapshot.fetchedAt });
  } catch (e) {
    return errorResponse(e, "api/accidents");
  }
}
