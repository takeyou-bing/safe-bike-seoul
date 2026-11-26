import "server-only";

import type { AccidentSpot, LatLngPoint } from "@/lib/api-types";
import { cached } from "./cache";
import { requireServerKey } from "./env";
import { ApiError, encodeServiceKey, fetchUpstream } from "./http";

/**
 * 한국도로교통공단 자전거 교통사고 다발지역 (공공데이터포털)
 * GET https://apis.data.go.kr/B552061/frequentzoneBicycle/getRestFrequentzoneBicycle
 * - 대상: 1년간 발생한 가해·피해 차종이 자전거인 교통사고
 * - 선정: 대상사고 4건 이상(사망사고 포함 시 3건 이상) 발생 지점
 * - searchYearCd: 조회 연도 (공식 문서상 조회 가능 기간 2012~2025)
 */

/** 서울시 자치구 코드 (guGun 값) */
export const SEOUL_GU: Record<string, string> = {
  "110": "종로구", "140": "중구", "170": "용산구", "200": "성동구", "215": "광진구",
  "230": "동대문구", "260": "중랑구", "290": "성북구", "305": "강북구", "320": "도봉구",
  "350": "노원구", "380": "은평구", "410": "서대문구", "440": "마포구", "470": "양천구",
  "500": "강서구", "530": "구로구", "545": "금천구", "560": "영등포구", "590": "동작구",
  "620": "관악구", "650": "서초구", "680": "강남구", "710": "송파구", "740": "강동구",
};

/** 최신 연도 확인용 표본 자치구 (사고다발지역이 꾸준히 있는 곳) */
const PROBE_GU = ["680", "560", "440", "710"];
const FIRST_YEAR = 2012;
const DAY_MS = 86_400_000;
const LABEL = "도로교통공단 자전거 사고다발지역 API";

type Item = {
  afos_fid: number | string;
  spot_nm: string;
  occrrnc_cnt: number | string;
  caslt_cnt: number | string;
  dth_dnv_cnt: number | string;
  se_dnv_cnt: number | string;
  sl_dnv_cnt: number | string;
  wnd_dnv_cnt?: number | string;
  la_crd: number | string;
  lo_crd: number | string;
  geom_json?: string;
};
type Resp = { resultCode: string; resultMsg: string; items?: { item?: Item[] | Item } | "" };

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** geom_json(EPSG:4326 Polygon/MultiPolygon) → 외곽선 목록 */
function parsePolygon(geom: string | undefined): LatLngPoint[][] {
  if (!geom) return [];
  try {
    const g = JSON.parse(geom) as { type: string; coordinates: unknown };
    const polygons = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? (g.coordinates as unknown[]) : [];
    return (polygons as number[][][][])
      .map((rings) => rings[0] ?? [])
      .map((outer) => outer.filter((c) => c.length >= 2).map(([lng, lat]) => ({ lat, lng })))
      .filter((ring) => ring.length >= 3);
  } catch {
    return [];
  }
}

async function fetchGu(key: string, year: number, gu: string): Promise<{ noData: boolean; spots: AccidentSpot[] }> {
  const url = `https://apis.data.go.kr/B552061/frequentzoneBicycle/getRestFrequentzoneBicycle?ServiceKey=${key}&searchYearCd=${year}&siDo=11&guGun=${gu}&type=json&numOfRows=100&pageNo=1`;
  const json = (await fetchUpstream(url, LABEL, undefined, "DATA_GO_KR_API_KEY")) as Resp;
  if (json.resultCode === "03") return { noData: true, spots: [] };
  if (json.resultCode !== "00") throw new ApiError(502, `${LABEL} 오류: ${json.resultCode} ${json.resultMsg}`);

  const raw = json.items && typeof json.items === "object" ? json.items.item : undefined;
  const items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
  const spots = items.map((i): AccidentSpot => {
    const deaths = n(i.dth_dnv_cnt);
    const serious = n(i.se_dnv_cnt);
    return {
      id: String(i.afos_fid),
      name: i.spot_nm.replace(/^서울(특별시)?\s*/, "").trim(),
      district: SEOUL_GU[gu],
      lat: n(i.la_crd),
      lng: n(i.lo_crd),
      accidents: n(i.occrrnc_cnt),
      casualties: n(i.caslt_cnt),
      deaths,
      seriousInjuries: serious,
      minorInjuries: n(i.sl_dnv_cnt),
      injuryReports: n(i.wnd_dnv_cnt),
      // 임의 점수 대신 실제 피해 정도로 구분: 사망자 있음 / 중상자 있음 / 그 외(경상·부상신고)
      severity: deaths > 0 ? "high" : serious > 0 ? "medium" : "low",
      polygons: parsePolygon(i.geom_json),
    };
  });
  return { noData: false, spots: spots.filter((s) => s.lat > 0 && s.lng > 0) };
}

/** 데이터가 있는 가장 최근 연도. 올해부터 거꾸로 표본 자치구를 조회해 확인합니다. (하루 캐시) */
export function getLatestAccidentYear(): Promise<number> {
  return cached("accidents:latest-year", DAY_MS, async () => {
    const key = encodeServiceKey(requireServerKey("DATA_GO_KR_API_KEY"));
    const thisYear = new Date().getFullYear();
    for (let year = thisYear; year >= Math.max(FIRST_YEAR, thisYear - 6); year--) {
      const results = await Promise.all(PROBE_GU.map((gu) => fetchGu(key, year, gu)));
      if (results.some((r) => !r.noData)) return year;
    }
    throw new ApiError(502, `${LABEL}: 최근 ${7}년 안에 조회 가능한 연도를 찾지 못했습니다.`);
  });
}

/** 서울시 자전거 사고다발지역 (연도별)과 조회 시각. 하루 단위 캐시. */
export function getSeoulAccidentSpots(year: number, guCodes: string[]): Promise<{ spots: AccidentSpot[]; fetchedAt: string }> {
  return cached(`accidents:v3:${year}:${guCodes.join(",")}`, DAY_MS, () => loadAccidentSpots(year, guCodes));
}

async function loadAccidentSpots(year: number, guCodes: string[]): Promise<{ spots: AccidentSpot[]; fetchedAt: string }> {
  const key = encodeServiceKey(requireServerKey("DATA_GO_KR_API_KEY"));
  const fetchedAt = new Date().toISOString();
  const results = await Promise.allSettled(guCodes.map((gu) => fetchGu(key, year, gu)));
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed.length === results.length) {
    throw failed[0]?.reason instanceof ApiError ? failed[0].reason : new ApiError(502, `${LABEL}를 불러오지 못했습니다.`);
  }
  // 일부만 실패하면 불완전한 자료를 하루 동안 캐시하지 않도록 오류 처리
  if (failed.length) throw new ApiError(502, `${LABEL}: ${failed.length}개 자치구 조회에 실패했습니다. 잠시 후 다시 시도하세요.`);

  const seen = new Set<string>();
  const spots = results
    .flatMap((r) => (r as PromiseFulfilledResult<{ spots: AccidentSpot[] }>).value.spots)
    .filter((s) => !seen.has(s.id) && Boolean(seen.add(s.id)));
  return { spots, fetchedAt };
}
