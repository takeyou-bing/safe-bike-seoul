import type { PlaceResult } from "@/lib/api-types";

export type LatLng = { lat: number; lng: number };

/** 출발지·목적지로 쓰는 장소 (카카오 장소 검색 결과) */
export type Place = LatLng & {
  id: string;
  name: string;
  address: string;
  category?: string;
};

export function toPlace(p: PlaceResult): Place {
  return { id: p.id, name: p.name, address: p.roadAddress || p.address, category: p.category || undefined, lat: p.lat, lng: p.lng };
}

/** 처음 화면의 출발지·목적지 (카카오 장소 검색에서 받은 실제 좌표) */
export const DEFAULT_ORIGIN: Place = {
  id: "10952963",
  name: "여의도한강공원",
  address: "서울 영등포구 여의도동 85",
  lat: 37.52638860108943,
  lng: 126.93512931714196,
};

export const DEFAULT_DESTINATION: Place = {
  id: "11331488",
  name: "서울숲",
  address: "서울 성동구 성수동1가 678-1",
  lat: 37.5443222301513,
  lng: 127.037617759165,
};
