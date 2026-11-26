import type { NextRequest } from "next/server";
import { errorResponse, seoulLatLng } from "@/lib/server/http";
import { getWeather, kmaBaseTimes, toKmaGrid } from "@/lib/server/weather";
import { rateLimit } from "@/lib/server/rateLimit";

const SEOUL_CITY_HALL = { lat: 37.5663, lng: 126.9779 };

/** GET /api/weather?lat=37.5663&lng=126.9779 — 기상청 초단기실황·예보 + 서울 평균 미세먼지 (좌표 생략 시 서울시청) */
export async function GET(request: NextRequest) {
  // IP별 요청 속도 제한 (초과 시 429 + Retry-After)
  const limited = rateLimit(request, "default");
  if (limited) return limited;

  try {
    const point = seoulLatLng(request.nextUrl.searchParams, false) ?? SEOUL_CITY_HALL;
    const { nx, ny } = toKmaGrid(point.lat, point.lng);
    const { ncst, fcst } = kmaBaseTimes();
    const data = await getWeather(nx, ny, ncst, fcst);
    return Response.json({ data, source: "기상청 단기예보 조회서비스, 에어코리아", fetchedAt: new Date().toISOString() });
  } catch (e) {
    return errorResponse(e, "api/weather");
  }
}
