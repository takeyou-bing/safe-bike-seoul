import "server-only";

import type { BikeStation } from "@/lib/api-types";
import { cached } from "./cache";
import { requireServerKey } from "./env";
import { ApiError, fetchUpstream } from "./http";

type Row = {
  stationId: string;
  stationName: string;
  stationLatitude: string;
  stationLongitude: string;
  parkingBikeTotCnt: string;
  rackTotCnt: string;
};

type Result = { CODE: string; MESSAGE: string };

type BikeListResponse = {
  rentBikeStatus?: { list_total_count: number; RESULT: Result; row: Row[] };
  // 오류·데이터 없음일 때는 래퍼 없이 오거나 RESULT로 감싸져 옵니다.
  RESULT?: Result;
  CODE?: string;
  MESSAGE?: string;
};

const PAGE = 1000;
const BATCH = 4;
const MAX_PAGES = 12;
const TTL_MS = 60_000;
const LABEL = "서울시 따릉이 API";

/** 한 페이지(최대 1,000건) 조회. 범위를 넘으면(INFO-200) 빈 배열. */
async function fetchPage(key: string, start: number): Promise<Row[]> {
  // 서울 열린데이터광장은 인증키가 URL 경로에 들어가므로 URL을 로그·오류에 남기지 않습니다.
  const url = `http://openapi.seoul.go.kr:8088/${encodeURIComponent(key)}/json/bikeList/${start}/${start + PAGE - 1}/`;
  const json = (await fetchUpstream(url, LABEL, undefined, "SEOUL_API_KEY")) as BikeListResponse;

  const result = json.rentBikeStatus?.RESULT ?? json.RESULT ?? (json.CODE ? { CODE: json.CODE, MESSAGE: json.MESSAGE ?? "" } : null);
  if (result?.CODE === "INFO-200") return [];
  if (!result || result.CODE !== "INFO-000" || !json.rentBikeStatus) {
    throw new ApiError(502, `${LABEL} 오류: ${result ? `${result.CODE} ${result.MESSAGE}` : "알 수 없는 응답"}`);
  }
  return json.rentBikeStatus.row;
}

export type StationSnapshot = {
  stations: BikeStation[];
  /** 서울 API에서 실제로 받아 온 시각 (bikeList 응답에는 측정시각 필드가 없음) */
  fetchedAt: string;
};

async function loadAllStations(): Promise<StationSnapshot> {
  const key = requireServerKey("SEOUL_API_KEY");
  const fetchedAt = new Date().toISOString();

  // list_total_count는 요청한 구간의 건수만 알려 주므로, 1,000건 미만 페이지가 나올 때까지 4페이지씩 병렬 조회
  const rows: Row[] = [];
  for (let page = 0; page < MAX_PAGES; page += BATCH) {
    const batch = await Promise.all(Array.from({ length: BATCH }, (_, i) => fetchPage(key, (page + i) * PAGE + 1)));
    let lastPageReached = false;
    for (const pageRows of batch) {
      rows.push(...pageRows);
      if (pageRows.length < PAGE) {
        lastPageReached = true;
        break;
      }
    }
    if (lastPageReached) break;
  }

  const seen = new Set<string>();
  const stations = rows
    .filter((r) => !seen.has(r.stationId) && Boolean(seen.add(r.stationId)))
    .map((r) => ({
      id: r.stationId,
      name: r.stationName.replace(/^\d+\.\s*/, "").trim(),
      lat: Number(r.stationLatitude),
      lng: Number(r.stationLongitude),
      bikes: Number(r.parkingBikeTotCnt) || 0,
      docks: Number(r.rackTotCnt) || 0,
    }))
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng) && s.lat > 0 && s.lng > 0);
  return { stations, fetchedAt };
}

/** 서울시 공공자전거(따릉이) 실시간 대여정보 전체와 조회 시각. 서버에서 1분간 캐시. */
export function getAllStations(): Promise<StationSnapshot> {
  return cached("seoul-bike:all:v2", TTL_MS, loadAllStations);
}
