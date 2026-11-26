// API Route 응답 타입 (클라이언트·서버 공용, 비밀 정보 없음)

export type ApiResponse<T> = { data: T; source: string; fetchedAt: string } | { error: string };

export type PlaceResult = {
  id: string;
  name: string;
  address: string;
  roadAddress: string;
  category: string;
  lat: number;
  lng: number;
};

export type LatLngPoint = { lat: number; lng: number };

/** 카카오맵 자전거 경로 route_mode: 자전거도로 우선 / 최단 경로 */
export type BikeRouteMode = "BIKE_ONLY" | "SHORTEST";

export type BikeRoute = {
  mode: BikeRouteMode;
  distanceM: number;
  durationSec: number;
  landingUrl?: string;
  path: LatLngPoint[];
  /** 카카오 API에서 실제로 받아 온 시각 */
  fetchedAt: string;
};

/** /api/bike-route 응답: 모드별로 성공한 경로 또는 실패 사유 */
export type BikeRouteResults = Record<BikeRouteMode, { route: BikeRoute } | { error: string }>;

export type BikeStation = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  bikes: number;
  docks: number;
  distanceM?: number;
};

export type AccidentSpot = {
  id: string;
  name: string;
  district: string;
  lat: number;
  lng: number;
  accidents: number;
  casualties: number;
  deaths: number;
  seriousInjuries: number;
  minorInjuries: number;
  injuryReports: number;
  severity: "high" | "medium" | "low";
  /** 다발지역 범위 (EPSG:4326 외곽선) */
  polygons: LatLngPoint[][];
  distanceM?: number;
};

/** /api/accidents 응답 data */
export type AccidentData = {
  year: number;
  latestYear: number;
  criteria: string;
  spots: AccidentSpot[];
  /** 도로교통공단 API에서 실제로 받아 온 시각 */
  fetchedAt: string;
};

/** 기상청 단기예보 한 시각 (예보시각 기준) */
export type ForecastSlot = {
  /** 예보시각 (KST ISO, 예: 2026-11-24T21:00:00+09:00) */
  forecastAt: string;
  temp: number | null; // TMP 1시간 기온 ℃
  pop: number | null; // POP 강수확률 %
  sky: string; // SKY 맑음/구름많음/흐림
  precipType: string; // PTY 없음/비/비·눈/눈/소나기
  precip: string | null; // PCP 1시간 강수량 (예: "강수없음", "1mm 미만")
  humidity: number | null; // REH %
  windSpeed: number | null; // WSD m/s
};

/** /api/forecast 응답 data */
export type ForecastData = {
  point: LatLngPoint;
  grid: { nx: number; ny: number };
  /** 발표시각 (KST ISO) — 기상청이 예보를 발표한 시각 */
  issuedAt: string;
  slots: ForecastSlot[];
  daily: { date: string; min: number | null; max: number | null }[];
  /** 기상청 API에서 실제로 받아 온 시각 */
  fetchedAt: string;
};

export type WeatherNow = {
  observedAt: string; // KST ISO
  grid: { nx: number; ny: number };
  temp: number | null;
  humidity: number | null;
  rain1h: string | null;
  precipType: string;
  windSpeed: number | null;
  windDir: string | null;
  hourly: { time: string; temp: number | null; sky: string; precipType: string; rain1h: string | null }[];
  air: { pm10: number | null; pm25: number | null; measuredAt: string | null } | null;
  warnings: string[];
};
