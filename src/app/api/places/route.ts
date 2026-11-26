import type { NextRequest } from "next/server";
import { ApiError, errorResponse } from "@/lib/server/http";
import { searchPlaces } from "@/lib/server/kakao";
import { rateLimit } from "@/lib/server/rateLimit";

/** GET /api/places?query=여의도 — 카카오 장소 검색 (서울 범위) */
export async function GET(request: NextRequest) {
  // IP별 요청 속도 제한 (초과 시 429 + Retry-After)
  const limited = rateLimit(request, "places");
  if (limited) return limited;

  try {
    const query = request.nextUrl.searchParams.get("query")?.trim() ?? "";
    if (query.length < 1 || query.length > 50) throw new ApiError(400, "query는 1~50자로 입력하세요.");
    const data = await searchPlaces(query);
    return Response.json({ data, source: "카카오 로컬 API", fetchedAt: new Date().toISOString() });
  } catch (e) {
    return errorResponse(e, "api/places");
  }
}
