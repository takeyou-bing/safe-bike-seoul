import "server-only";

import { ApiError } from "./http";

/**
 * 카카오 공통 오류 코드 → 원인과 해결 방법.
 * apiName: 권한·한도 안내에 쓸 API 이름 (예: "자전거 경로 API", "장소 검색 API")
 */
export function explainKakaoError(e: ApiError, apiName: string, dailyQuota?: string): ApiError {
  const code = typeof e.upstream?.code === "number" ? e.upstream.code : Number(e.upstream?.code);
  const http = e.upstream?.httpStatus;
  const reasons: Record<number, string> = {
    [-401]: "카카오 REST API 키가 유효하지 않거나 다른 앱의 키입니다. .env의 KAKAO_REST_API_KEY를 확인하세요.",
    [-3]: "카카오맵 API 사용 설정이 꺼져 있습니다. Kakao Developers › 내 애플리케이션 › 카카오맵 › 사용 설정을 ON으로 바꾸세요.",
    [-5]: `이 앱에 ${apiName} 호출 권한이 없습니다. Kakao Developers의 앱 권한·유료 API 설정을 확인하세요.`,
    [-10]: `${apiName}의 일일 호출 한도${dailyQuota ? `(${dailyQuota})` : ""}를 초과했습니다. 내일 다시 시도하거나 유료 사용 설정을 하세요.`,
    [-11]: "유료 API의 일/월 사용 한도를 초과했습니다.",
    [-13]: "앱이 장기 미이용 상태입니다. Kakao Developers에서 앱 상태를 확인하세요.",
  };
  const reason = reasons[code] ?? (http === 401 ? reasons[-401] : undefined);
  if (!reason) return e;
  const detail = [http ? `HTTP ${http}` : null, e.upstream?.code !== undefined ? String(e.upstream.code) : null].filter(Boolean).join(", ");
  return new ApiError(code === -10 || code === -11 ? 429 : 502, `${reason} (카카오 응답: ${detail})`, e.upstream);
}
