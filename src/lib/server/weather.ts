import "server-only";

import type { WeatherNow } from "@/lib/api-types";
import { cached } from "./cache";
import { requireServerKey } from "./env";
import { ApiError, encodeServiceKey, fetchUpstream } from "./http";

/** 위경도 → 기상청 격자(nx, ny) 변환 (기상청 Lambert Conformal Conic 공식) */
export function toKmaGrid(lat: number, lng: number): { nx: number; ny: number } {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
  const DEGRAD = Math.PI / 180;
  const re = RE / GRID;
  const slat1 = SLAT1 * DEGRAD, slat2 = SLAT2 * DEGRAD, olon = OLON * DEGRAD, olat = OLAT * DEGRAD;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lng * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5) };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** KST 기준 발표 시각 계산. 초단기실황은 매시 정각 자료가 약 40분 후, 초단기예보는 매시 30분 자료가 약 45분 후 제공됩니다. */
export function kmaBaseTimes(now = new Date()) {
  const kst = (ms: number) => new Date(ms + 9 * 3600_000);
  const fmt = (d: Date, mm: string) => ({
    date: `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}${mm}`,
  });
  const k = kst(now.getTime());
  const ncst = kst(now.getTime() - (k.getUTCMinutes() < 40 ? 3600_000 : 0));
  const fcst = kst(now.getTime() - (k.getUTCMinutes() < 45 ? 3600_000 : 0));
  return { ncst: fmt(ncst, "00"), fcst: fmt(fcst, "30") };
}

type KmaItem = { category: string; obsrValue?: string; fcstValue?: string; fcstDate?: string; fcstTime?: string };
type KmaResponse = { response?: { header: { resultCode: string; resultMsg: string }; body?: { items: { item: KmaItem[] } } } };

const KMA = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0";

async function kma(op: string, base: { date: string; time: string }, nx: number, ny: number): Promise<KmaItem[]> {
  const key = encodeServiceKey(requireServerKey("DATA_GO_KR_API_KEY"));
  const url = `${KMA}/${op}?serviceKey=${key}&pageNo=1&numOfRows=100&dataType=JSON&base_date=${base.date}&base_time=${base.time}&nx=${nx}&ny=${ny}`;
  const json = (await fetchUpstream(url, "기상청 API", undefined, "DATA_GO_KR_API_KEY")) as KmaResponse;
  const header = json.response?.header;
  if (!header || header.resultCode !== "00") throw new ApiError(502, `기상청 API 오류: ${header ? `${header.resultCode} ${header.resultMsg}` : "알 수 없는 응답"}`);
  return json.response?.body?.items.item ?? [];
}

const PTY: Record<string, string> = { "0": "없음", "1": "비", "2": "비/눈", "3": "눈", "5": "빗방울", "6": "빗방울눈날림", "7": "눈날림" };
const SKY: Record<string, string> = { "1": "맑음", "3": "구름많음", "4": "흐림" };
const DIRS = ["북", "북북동", "북동", "동북동", "동", "동남동", "남동", "남남동", "남", "남남서", "남서", "서남서", "서", "서북서", "북서", "북북서"];

const num = (v: string | undefined) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

/** 서울 평균 미세먼지 (에어코리아). 별도 활용신청이 필요하므로 실패해도 날씨는 반환합니다. */
async function seoulAir(): Promise<NonNullable<WeatherNow["air"]>> {
  const key = encodeServiceKey(requireServerKey("DATA_GO_KR_API_KEY"));
  const url = `https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty?serviceKey=${key}&returnType=json&numOfRows=100&pageNo=1&sidoName=${encodeURIComponent("서울")}&ver=1.0`;
  type AirResp = {
    response?: {
      header: { resultCode: string; resultMsg: string };
      body?: { items: { pm10Value: string; pm25Value: string; dataTime: string }[] };
    };
  };
  const json = (await fetchUpstream(url, "에어코리아 API", undefined, "DATA_GO_KR_API_KEY")) as AirResp;
  const header = json.response?.header;
  if (!header || header.resultCode !== "00") throw new ApiError(502, `에어코리아 API 오류: ${header?.resultMsg ?? "알 수 없는 응답"}`);
  const items = json.response?.body?.items ?? [];
  const avg = (vals: (number | null)[]) => {
    const ok = vals.filter((v): v is number => v !== null);
    return ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : null;
  };
  return {
    pm10: avg(items.map((i) => num(i.pm10Value))),
    pm25: avg(items.map((i) => num(i.pm25Value))),
    measuredAt: items[0]?.dataTime ?? null,
  };
}

type Base = { date: string; time: string };

/** 격자·발표시각 단위로 10분 캐시 */
export function getWeather(nx: number, ny: number, ncstBase: Base, fcstBase: Base): Promise<WeatherNow> {
  const key = `weather:${nx},${ny}:${ncstBase.date}${ncstBase.time}:${fcstBase.date}${fcstBase.time}`;
  return cached(key, 600_000, () => loadWeather(nx, ny, ncstBase, fcstBase));
}

async function loadWeather(nx: number, ny: number, ncstBase: Base, fcstBase: Base): Promise<WeatherNow> {
  const warnings: string[] = [];
  const [ncst, fcst, air] = await Promise.all([
    kma("getUltraSrtNcst", ncstBase, nx, ny),
    kma("getUltraSrtFcst", fcstBase, nx, ny).catch((e: unknown) => {
      warnings.push(e instanceof ApiError ? e.message : "초단기예보를 불러오지 못했습니다.");
      return [] as KmaItem[];
    }),
    seoulAir().catch((e: unknown) => {
      warnings.push(e instanceof ApiError ? e.message : "미세먼지 정보를 불러오지 못했습니다.");
      return null;
    }),
  ]);

  const now = Object.fromEntries(ncst.map((i) => [i.category, i.obsrValue]));
  const vec = num(now.VEC);

  const slots = new Map<string, Record<string, string>>();
  for (const i of fcst) {
    const k = `${i.fcstDate}${i.fcstTime}`;
    const slot = slots.get(k) ?? {};
    slot[i.category] = i.fcstValue ?? "";
    slots.set(k, slot);
  }
  const hourly = [...slots.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({
      time: `${k.slice(8, 10)}:${k.slice(10, 12)}`,
      temp: num(v.T1H),
      sky: SKY[v.SKY] ?? "-",
      precipType: PTY[v.PTY] ?? "-",
      rain1h: v.RN1 ?? null,
    }));

  const d = ncstBase.date;
  return {
    observedAt: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${ncstBase.time.slice(0, 2)}:00:00+09:00`,
    grid: { nx, ny },
    temp: num(now.T1H),
    humidity: num(now.REH),
    rain1h: now.RN1 ?? null,
    precipType: PTY[now.PTY ?? "0"] ?? "-",
    windSpeed: num(now.WSD),
    windDir: vec === null ? null : DIRS[Math.floor((vec + 11.25) / 22.5) % 16],
    hourly,
    air,
    warnings,
  };
}
