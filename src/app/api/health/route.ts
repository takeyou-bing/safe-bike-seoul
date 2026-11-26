import { connection } from "next/server";
import { hasServerKey } from "@/lib/server/env";
import { quotaUsage } from "@/lib/server/quota";

/** GET /api/health — 개발 환경에서만 각 인증키의 '설정 여부'만 알려 줍니다 (값은 절대 반환하지 않음). */
export async function GET() {
  await connection();
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  return Response.json({
    ok: true,
    keys: {
      KAKAO_REST_API_KEY: hasServerKey("KAKAO_REST_API_KEY"),
      SEOUL_API_KEY: hasServerKey("SEOUL_API_KEY"),
      DATA_GO_KR_API_KEY: hasServerKey("DATA_GO_KR_API_KEY"),
      NEXT_PUBLIC_KAKAO_JS_KEY: Boolean(process.env.NEXT_PUBLIC_KAKAO_JS_KEY),
    },
    // 오늘(KST) 서비스 전체 외부 API 사용량 / 한도
    quota: quotaUsage(),
  });
}
