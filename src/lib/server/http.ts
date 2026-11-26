import "server-only";

import { unstable_rethrow } from "next/navigation";

/** 클라이언트에 그대로 보여 줘도 되는 메시지만 담는 오류. 키나 요청 URL을 넣지 마세요. */
export class ApiError extends Error {
  /** 429일 때 클라이언트에 알려 줄 재시도 대기 시간(초) */
  retryAfterSec?: number;

  constructor(
    public status: number,
    message: string,
    /** 외부 API가 돌려준 오류 코드 (예: 카카오 -3, -5, -10) */
    public upstream?: { httpStatus: number; code?: number | string },
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 8_000;

/** 공공데이터포털 공통 오류(returnReasonCode) → 원인과 조치 */
const DATA_GO_KR_REASON: Record<string, { status: number; text: string }> = {
  "12": { status: 502, text: "해당 오픈 API 서비스가 없거나 폐기되었습니다." },
  "20": { status: 502, text: "이 API에 대한 활용신청이 승인되지 않았습니다. 공공데이터포털에서 활용신청 상태를 확인하세요." },
  "22": { status: 429, text: "오늘 호출 가능한 횟수를 초과했습니다. 내일 다시 시도하세요." },
  "30": { status: 502, text: "등록되지 않은 인증키입니다." },
  "31": { status: 502, text: "인증키 사용 기간이 만료되었습니다. 공공데이터포털에서 연장 신청하세요." },
  "32": { status: 502, text: "등록되지 않은 IP에서 호출했습니다." },
};

/** 서울 열린데이터광장 공통 오류 코드 → 원인 */
const SEOUL_CODE: Record<string, { status: number; text: string }> = {
  "INFO-100": { status: 502, text: "인증키가 유효하지 않습니다." },
  "ERROR-300": { status: 502, text: "필수 값이 누락되었습니다." },
  "ERROR-301": { status: 502, text: "파일 타입 값이 누락되었거나 유효하지 않습니다." },
  "ERROR-500": { status: 502, text: "서울시 서버 오류입니다. 잠시 후 다시 시도하세요." },
  "ERROR-600": { status: 502, text: "서울시 데이터베이스 연결 오류입니다. 잠시 후 다시 시도하세요." },
};

const cdata = (s: string | undefined) => s?.replace(/^<!\[CDATA\[|\]\]>$/g, "").trim();

/**
 * 공공데이터포털(JSON/XML 공통 오류 헤더)과 서울 열린데이터광장(XML RESULT) 오류를 해석합니다.
 * 해당 형식이 아니면 null.
 */
function parsePortalError(text: string, label: string, httpStatus: number, keyName?: string): ApiError | null {
  const keyHint = keyName ? ` .env의 ${keyName}를 확인하세요.` : "";

  // 공공데이터포털: {"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg","returnAuthMsg","returnReasonCode"}}} 또는 같은 구조의 XML
  let reasonCode: string | undefined;
  let errMsg: string | undefined;
  if (text.includes("OpenAPI_ServiceResponse")) {
    try {
      const h = (JSON.parse(text) as { OpenAPI_ServiceResponse?: { cmmMsgHeader?: Record<string, string> } }).OpenAPI_ServiceResponse?.cmmMsgHeader;
      reasonCode = h?.returnReasonCode;
      errMsg = h?.returnAuthMsg ?? h?.errMsg;
    } catch {
      reasonCode = text.match(/<returnReasonCode>([^<]+)<\/returnReasonCode>/)?.[1];
      errMsg = text.match(/<returnAuthMsg>([^<]+)<\/returnAuthMsg>/)?.[1] ?? text.match(/<errMsg>([^<]+)<\/errMsg>/)?.[1];
    }
  }
  if (reasonCode || errMsg) {
    const known = reasonCode ? DATA_GO_KR_REASON[reasonCode] : undefined;
    const needsKey = reasonCode === "30" || reasonCode === "31" || reasonCode === "20";
    return new ApiError(
      known?.status ?? 502,
      `${label}: ${known?.text ?? "공공데이터포털 오류입니다."}${needsKey ? keyHint : ""} (사유 코드 ${reasonCode ?? "-"}: ${redactSecrets(errMsg ?? "")})`,
      { httpStatus, code: reasonCode },
    );
  }

  // 서울 열린데이터광장 XML: <RESULT><CODE>INFO-100</CODE><MESSAGE>...</MESSAGE></RESULT>
  const code = cdata(text.match(/<CODE>([\s\S]*?)<\/CODE>/)?.[1]);
  if (code) {
    const message = cdata(text.match(/<MESSAGE>([\s\S]*?)<\/MESSAGE>/)?.[1]) ?? "";
    const known = SEOUL_CODE[code];
    return new ApiError(
      known?.status ?? 502,
      `${label}: ${known?.text ?? redactSecrets(message).slice(0, 120)}${code === "INFO-100" ? keyHint : ""} (${code})`,
      { httpStatus, code },
    );
  }
  return null;
}

/**
 * 외부 API 호출. 요청 URL에 인증키가 들어갈 수 있으므로
 * 오류 메시지·로그에는 URL을 절대 포함하지 않습니다.
 * keyName을 주면 인증 오류 안내에 확인할 .env 변수 이름을 덧붙입니다.
 */
export async function fetchUpstream(url: string, label: string, init?: RequestInit, keyName?: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new ApiError(
      504,
      timedOut
        ? `${label} 서버가 ${TIMEOUT_MS / 1000}초 안에 응답하지 않았습니다. 잠시 후 다시 시도하세요.`
        : `${label} 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.`,
    );
  }

  const text = await res.text();

  // 공공데이터포털·서울 열린데이터광장의 공통 오류 형식 (HTTP 200으로 올 때도 있음)
  const portal = parsePortalError(text, label, res.status, keyName);
  if (portal) throw portal;

  if (text.trimStart().startsWith("<")) {
    const reason = text.match(/<resultMsg>([^<]+)<\/resultMsg>/)?.[1] ?? `HTTP ${res.status}`;
    throw new ApiError(502, `${label} 오류: ${redactSecrets(reason)}`);
  }

  if (!res.ok) {
    // 카카오 등은 {"code": -3, "msg": "..."} 형태로 오류를 돌려줍니다. (키 값은 포함되지 않음)
    // 일부 응답(예: 잘못된 키 401)은 {"errorType", "message"} 형태이며 메시지에 키 값을 그대로 담기도 하므로 지웁니다.
    let code: number | string | undefined;
    let msg: string | undefined;
    try {
      const body = JSON.parse(text) as { code?: number | string; msg?: string; errorType?: string; message?: string };
      code = body.code ?? body.errorType;
      const raw = typeof body.msg === "string" ? body.msg : typeof body.message === "string" ? body.message : undefined;
      msg = raw ? redactSecrets(raw).slice(0, 200) : undefined;
    } catch {
      /* JSON이 아닌 오류 응답 */
    }
    const detail = [`HTTP ${res.status}`, code !== undefined ? `code ${code}` : null, msg].filter(Boolean).join(", ");
    const what = res.status === 401 || res.status === 403 ? "인증·권한 오류" : "응답 오류";
    throw new ApiError(502, `${label} ${what} (${detail})`, { httpStatus: res.status, code });
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(502, `${label} 응답을 해석하지 못했습니다.`);
  }
}

/** 외부 오류 메시지에서 인증키처럼 보이는 문자열(20자 이상 영숫자·인코딩 문자)을 가립니다. */
export function redactSecrets(text: string): string {
  return text.replace(/[A-Za-z0-9_\-+/=%]{20,}/g, "[가림]").replace(/appKey\([^)]*\)/gi, "appKey([가림])");
}

/** 공공데이터포털 키는 '인코딩'/'디코딩' 두 형태가 있어, 이미 인코딩된 키는 그대로 사용합니다. */
export function encodeServiceKey(key: string): string {
  return /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);
}

export function errorResponse(e: unknown, tag: string): Response {
  // Next.js 내부 제어용 오류(프리렌더 중단 등)는 다시 던져 Next.js가 처리하게 함
  unstable_rethrow(e);
  if (e instanceof ApiError) {
    if (e.status >= 500 || e.status === 429) console.error(`[${tag}] ${e.message}`);
    const headers: Record<string, string> = {};
    if (e.retryAfterSec) headers["Retry-After"] = String(e.retryAfterSec);
    return Response.json({ error: e.message }, { status: e.status, headers });
  }
  // 예상치 못한 오류는 상세 내용(스택·URL)을 응답에 넣지 않습니다.
  console.error(`[${tag}] 예상치 못한 오류: ${e instanceof Error ? e.name : typeof e}`);
  return Response.json({ error: "서버 내부 오류가 발생했습니다." }, { status: 500 });
}

export function numberParam(params: URLSearchParams, name: string, opts: { min: number; max: number; fallback?: number }): number | undefined {
  const raw = params.get(name);
  if (raw === null || raw === "") {
    if (opts.fallback !== undefined) return opts.fallback;
    return undefined;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < opts.min || n > opts.max) {
    throw new ApiError(400, `${name} 값은 ${opts.min}~${opts.max} 사이의 숫자여야 합니다.`);
  }
  return n;
}

/** 서울 근처 좌표만 허용 */
export function seoulLatLng(params: URLSearchParams, required: boolean): { lat: number; lng: number } | null {
  const lat = numberParam(params, "lat", { min: 37.0, max: 38.0 });
  const lng = numberParam(params, "lng", { min: 126.5, max: 127.5 });
  if (lat === undefined || lng === undefined) {
    if (required || lat !== undefined || lng !== undefined) throw new ApiError(400, "lat, lng 값을 함께 입력하세요.");
    return null;
  }
  return { lat, lng };
}

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
