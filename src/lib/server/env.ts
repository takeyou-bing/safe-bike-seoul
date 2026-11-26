import "server-only";

import { ApiError } from "./http";

/**
 * 서버 전용 API 키.
 * - 이름에 NEXT_PUBLIC_ 접두사가 없으므로 Next.js가 브라우저 번들에 넣지 않습니다.
 * - 이 모듈은 "server-only"를 import하므로 클라이언트 컴포넌트에서 import하면 빌드가 실패합니다.
 */
export type ServerKeyName = "KAKAO_REST_API_KEY" | "SEOUL_API_KEY" | "DATA_GO_KR_API_KEY";

const LABEL: Record<ServerKeyName, string> = {
  KAKAO_REST_API_KEY: "카카오 REST API",
  SEOUL_API_KEY: "서울 열린데이터광장",
  DATA_GO_KR_API_KEY: "공공데이터포털",
};

export function hasServerKey(name: ServerKeyName): boolean {
  return Boolean(process.env[name]?.trim());
}

/** 키가 없으면 키 값 대신 변수 이름만 담은 503 오류를 던집니다. */
export function requireServerKey(name: ServerKeyName): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ApiError(503, `${LABEL[name]} 인증키(${name})가 서버에 설정되지 않았습니다.`);
  return value;
}

// 서버 키를 실수로 NEXT_PUBLIC_ 접두사로 만든 경우 경고 (값은 출력하지 않음)
for (const name of Object.keys(LABEL)) {
  if (process.env[`NEXT_PUBLIC_${name}`]) {
    console.warn(`[env] NEXT_PUBLIC_${name} 이(가) 설정되어 있습니다. 이 값은 브라우저에 노출됩니다. 접두사를 제거하세요.`);
  }
}
