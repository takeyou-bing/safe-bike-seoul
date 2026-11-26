import "server-only";

import type { PlaceResult } from "@/lib/api-types";
import { cached } from "./cache";
import { requireServerKey } from "./env";
import { ApiError, fetchUpstream } from "./http";
import { explainKakaoError } from "./kakaoErrors";
import { consumeQuota } from "./quota";

// 서울시 범위 (경도,위도 좌하단, 우상단)
const SEOUL_RECT = "126.76,37.41,127.19,37.72";

type KakaoKeywordResponse = {
  documents: {
    id: string;
    place_name: string;
    address_name: string;
    road_address_name: string;
    category_group_name: string;
    x: string;
    y: string;
  }[];
};

/** 카카오 로컬 키워드 검색 (서울 범위). 검색어별 1시간 캐시. */
export function searchPlaces(query: string): Promise<PlaceResult[]> {
  return cached(`kakao-places:${query}`, 3_600_000, () => loadPlaces(query));
}

async function loadPlaces(query: string): Promise<PlaceResult[]> {
  const key = requireServerKey("KAKAO_REST_API_KEY");
  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&rect=${SEOUL_RECT}&size=15`;
  consumeQuota("kakao-local");

  let json: KakaoKeywordResponse;
  try {
    json = (await fetchUpstream(url, "카카오 장소 검색", { headers: { Authorization: `KakaoAK ${key}` } })) as KakaoKeywordResponse;
  } catch (e) {
    throw e instanceof ApiError ? explainKakaoError(e, "장소 검색 API") : e;
  }

  return (json.documents ?? []).map((d) => ({
    id: d.id,
    name: d.place_name,
    address: d.address_name,
    roadAddress: d.road_address_name,
    category: d.category_group_name,
    lat: Number(d.y),
    lng: Number(d.x),
  }));
}
