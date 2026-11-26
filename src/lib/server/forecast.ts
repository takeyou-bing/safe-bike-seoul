import "server-only";

import type { ForecastData, ForecastSlot, LatLngPoint } from "@/lib/api-types";
import { cached } from "./cache";
import { requireServerKey } from "./env";
import { ApiError, encodeServiceKey, fetchUpstream } from "./http";
import { toKmaGrid } from "./weather";

/**
 * 기상청 단기예보 조회 (공공데이터포털 VilageFcstInfoService_2.0/getVilageFcst)
 * - 발표시각(base_time): 매일 02, 05, 08, 11, 14, 17, 20, 23시 (KST), 발표 약 10분 후부터 조회 가능
 * - 예보시각(fcstDate+fcstTime): 발표 이후 1시간 간격, 최대 약 3~4일
 */
const ENDPOINT = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst";
const LABEL = "기상청 단기예보 API";
const BASE_HOURS = [2, 5, 8, 11, 14, 17, 20, 23];
const AVAILABLE_AFTER_MIN = 10;
const TTL_MS = 30 * 60_000;

type Item = { category: string; fcstDate: string; fcstTime: string; fcstValue: string };
type Resp = { response?: { header: { resultCode: string; resultMsg: string }; body?: { items?: { item?: Item[] } } } };
type Base = { date: string; time: string };

const pad = (n: number) => String(n).padStart(2, "0");
const KST_MS = 9 * 3_600_000;

/** 지금 조회할 수 있는 가장 최근 발표시각과 그 직전 발표시각 (KST) */
export function latestBaseTimes(now = Date.now()): [Base, Base] {
  const fmt = (ms: number, hour: number): Base => {
    const d = new Date(ms);
    return { date: `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`, time: `${pad(hour)}00` };
  };
  const k = new Date(now + KST_MS);
  const minutes = k.getUTCHours() * 60 + k.getUTCMinutes();
  const idx = BASE_HOURS.findLastIndex((h) => h * 60 + AVAILABLE_AFTER_MIN <= minutes);
  const latest = idx >= 0 ? fmt(k.getTime(), BASE_HOURS[idx]) : fmt(k.getTime() - 86_400_000, 23);
  const previous =
    idx > 0 ? fmt(k.getTime(), BASE_HOURS[idx - 1]) : idx === 0 ? fmt(k.getTime() - 86_400_000, 23) : fmt(k.getTime() - 86_400_000, 20);
  return [latest, previous];
}

const toIso = (date: string, time: string) =>
  `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:00+09:00`;

const SKY: Record<string, string> = { "1": "맑음", "3": "구름많음", "4": "흐림" };
const PTY: Record<string, string> = { "0": "없음", "1": "비", "2": "비/눈", "3": "눈", "4": "소나기" };
const num = (v: string | undefined) => (v === undefined || v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));

async function fetchBase(key: string, base: Base, nx: number, ny: number): Promise<Item[] | null> {
  const url = `${ENDPOINT}?serviceKey=${key}&pageNo=1&numOfRows=1500&dataType=JSON&base_date=${base.date}&base_time=${base.time}&nx=${nx}&ny=${ny}`;
  const json = (await fetchUpstream(url, LABEL, undefined, "DATA_GO_KR_API_KEY")) as Resp;
  const header = json.response?.header;
  if (!header) throw new ApiError(502, `${LABEL} 응답 형식을 해석하지 못했습니다.`);
  if (header.resultCode === "03") return null; // NO_DATA: 아직 발표 전
  if (header.resultCode !== "00") throw new ApiError(502, `${LABEL} 오류: ${header.resultCode} ${header.resultMsg}`);
  return json.response?.body?.items?.item ?? [];
}

async function loadForecast(nx: number, ny: number, bases: [Base, Base]): Promise<Omit<ForecastData, "point">> {
  const key = encodeServiceKey(requireServerKey("DATA_GO_KR_API_KEY"));
  const fetchedAt = new Date().toISOString();

  // 최신 발표분이 아직 준비되지 않았으면(NO_DATA) 직전 발표분 사용
  let base = bases[0];
  let items = await fetchBase(key, base, nx, ny);
  if (!items) {
    base = bases[1];
    items = await fetchBase(key, base, nx, ny);
  }
  if (!items || items.length === 0) throw new ApiError(502, `${LABEL}: 해당 격자(${nx}, ${ny})의 예보 자료가 없습니다.`);

  const byTime = new Map<string, Record<string, string>>();
  const daily = new Map<string, { min: number | null; max: number | null }>();
  for (const i of items) {
    if (i.category === "TMN" || i.category === "TMX") {
      const d = daily.get(i.fcstDate) ?? { min: null, max: null };
      if (i.category === "TMN") d.min = num(i.fcstValue);
      else d.max = num(i.fcstValue);
      daily.set(i.fcstDate, d);
      continue;
    }
    const k = `${i.fcstDate}${i.fcstTime}`;
    const slot = byTime.get(k) ?? {};
    slot[i.category] = i.fcstValue;
    byTime.set(k, slot);
  }

  const slots: ForecastSlot[] = [...byTime.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({
      forecastAt: toIso(k.slice(0, 8), k.slice(8, 12)),
      temp: num(v.TMP),
      pop: num(v.POP),
      sky: SKY[v.SKY] ?? "-",
      precipType: PTY[v.PTY] ?? "-",
      precip: v.PCP ?? null,
      humidity: num(v.REH),
      windSpeed: num(v.WSD),
    }));

  return {
    grid: { nx, ny },
    issuedAt: toIso(base.date, base.time),
    slots,
    daily: [...daily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, v]) => ({ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, ...v })),
    fetchedAt,
  };
}

/** 좌표 → 기상청 격자 변환 후 단기예보 조회. 격자·발표시각 단위로 30분 캐시. */
export async function getShortTermForecast(point: LatLngPoint): Promise<ForecastData> {
  const { nx, ny } = toKmaGrid(point.lat, point.lng);
  const bases = latestBaseTimes();
  const data = await cached(`kma-vilage:v2:${nx},${ny}:${bases[0].date}${bases[0].time}`, TTL_MS, () => loadForecast(nx, ny, bases));
  return { point, ...data };
}
