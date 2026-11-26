import type { NextRequest } from "next/server";
import { getShortTermForecast } from "@/lib/server/forecast";
import { errorResponse, seoulLatLng } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rateLimit";

/**
 * GET /api/forecast?lat=37.5284&lng=126.9327
 * 좌표를 기상청 격자(nx, ny)로 바꿔 단기예보(기온 TMP, 강수확률 POP 등)를 조회합니다.
 * 응답의 issuedAt은 발표시각, slots[].forecastAt은 예보시각입니다.
 */
export async function GET(request: NextRequest) {
  // IP별 요청 속도 제한 (초과 시 429 + Retry-After)
  const limited = rateLimit(request, "default");
  if (limited) return limited;

  try {
    const point = seoulLatLng(request.nextUrl.searchParams, true)!;
    const data = await getShortTermForecast(point);
    return Response.json({ data, source: "기상청 단기예보 조회서비스", fetchedAt: data.fetchedAt });
  } catch (e) {
    return errorResponse(e, "api/forecast");
  }
}
