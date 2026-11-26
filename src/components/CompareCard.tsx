import type { ReactNode } from "react";
import type { Place } from "@/lib/places";
import type { BikeRouteMode, BikeRouteResults, BikeStation, ForecastData } from "@/lib/api-types";
import { fmtDateTime, fmtTimeSec, upcomingSlots } from "@/lib/format";
import { ROUTE_ACCIDENT_RADIUS_M, type RouteAccident } from "@/lib/route";
import { Card } from "./Card";
import { ROUTE_COLOR } from "./KakaoMap";

const MODES = ["BIKE_ONLY", "SHORTEST"] as const;
const MODE_LABEL: Record<BikeRouteMode, string> = { BIKE_ONLY: "자전거도로 우선", SHORTEST: "최단 경로" };

/** 받침 유무에 따라 주격 조사 '이/가' 선택 (예: 자전거도로 우선이, 최단 경로가) */
const subj = (word: string) => {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return `${word}${code >= 0 && code <= 11171 && code % 28 !== 0 ? "이" : "가"}`;
};

const km = (m: number) => (m / 1000).toFixed(1);
const minutes = (sec: number) => Math.max(1, Math.round(sec / 60));

type Req<T> = { data?: T; loading: boolean; error?: string; fetchedAt?: string };

/** 경로별 주변 사고다발지역 요약 (값만 집계, 위험도 판정은 하지 않음) */
function summarize(spots: RouteAccident[]) {
  return {
    count: spots.length,
    severe: spots.filter((s) => s.deaths > 0 || s.seriousInjuries > 0).length,
    accidents: spots.reduce((n, s) => n + s.accidents, 0),
    casualties: spots.reduce((n, s) => n + s.casualties, 0),
  };
}

function Skeleton() {
  return <span className="inline-block h-4 w-12 animate-pulse rounded bg-zinc-200 align-middle" />;
}

export function CompareCard({
  originName,
  startStation,
  isAutoStart,
  destination,
  mode,
  onModeChange,
  routes,
  accidentsByMode,
  accidents,
  stationsFetchedAt,
  noStartReason,
  forecast,
  nowMs,
}: {
  /** 출발 대여소가 없을 때의 이유 (대여소 API 오류 / 불러오는 중 / 주변에 없음) */
  noStartReason: { kind: "error" | "loading" | "empty"; text: string };
  originName: string;
  startStation: BikeStation | null;
  isAutoStart: boolean;
  destination: Place;
  mode: BikeRouteMode;
  onModeChange: (m: BikeRouteMode) => void;
  routes: Req<BikeRouteResults>;
  accidentsByMode: Record<BikeRouteMode, RouteAccident[]>;
  accidents: Req<{ year: number }>;
  stationsFetchedAt?: string;
  forecast: Req<ForecastData>;
  nowMs: number | null;
}) {
  const results = routes.loading || routes.error ? undefined : routes.data;
  const ok = (m: BikeRouteMode) => {
    const r = results?.[m];
    return r && "route" in r ? r.route : undefined;
  };
  const sums = { BIKE_ONLY: summarize(accidentsByMode.BIKE_ONLY), SHORTEST: summarize(accidentsByMode.SHORTEST) };
  const accidentsReady = Boolean(accidents.data) && !accidents.error;
  const now = upcomingSlots(forecast.data?.slots, nowMs)[0];

  // 사실만 나란히 서술 (어느 경로가 '안전'하다고 판정하지 않음)
  const a = ok("BIKE_ONLY");
  const b = ok("SHORTEST");
  const facts: string[] = [];
  if (a && b) {
    const diff = Math.abs(a.distanceM - b.distanceM);
    facts.push(
      diff < 50
        ? "두 경로의 거리는 거의 같습니다."
        : `거리는 ${subj(a.distanceM < b.distanceM ? MODE_LABEL.BIKE_ONLY : MODE_LABEL.SHORTEST)} ${km(diff)}km 짧습니다.`,
    );
    if (accidentsReady) {
      facts.push(
        `경로 ${ROUTE_ACCIDENT_RADIUS_M}m 이내 사고다발지역은 ${MODE_LABEL.BIKE_ONLY} ${sums.BIKE_ONLY.count}곳, ${MODE_LABEL.SHORTEST} ${sums.SHORTEST.count}곳입니다.`,
      );
    }
  }

  const cell = (m: BikeRouteMode, render: () => ReactNode, needsAccidents = false) => {
    const r = results?.[m];
    if (routes.loading || !results) return <Skeleton />;
    if (!r || !("route" in r)) return <span className="text-xs text-zinc-400">-</span>;
    if (needsAccidents) {
      if (accidents.loading && !accidents.data) return <Skeleton />;
      if (!accidentsReady) return <span className="text-xs text-zinc-400">정보 없음</span>;
    }
    return render();
  };

  return (
    <Card
      title="경로 비교"
      icon="⚖️"
      badge={
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 ring-1 ring-zinc-300">참고용 정보</span>
      }
    >
      {!startStation ? (
        noStartReason.kind === "error" ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p className="font-semibold">따릉이 대여소 정보를 불러오지 못해 경로를 비교할 수 없습니다.</p>
            <p className="mt-1 text-xs">{noStartReason.text}</p>
          </div>
        ) : (
          <p className={`rounded-xl px-3 py-3 text-sm ${noStartReason.kind === "loading" ? "bg-zinc-50 text-zinc-500" : "bg-amber-50 text-amber-900"}`}>
            {noStartReason.text}
          </p>
        )
      ) : (
        <>
          <p className="mb-2 text-sm text-zinc-700">
            <span className="font-semibold text-green-700">🚲 {startStation.name}</span>
            <span className="mx-1.5 text-zinc-400">→</span>
            <span className="font-semibold text-rose-700">{destination.name}</span>
            {isAutoStart && <span className="ml-1 text-[11px] text-zinc-500">(출발지에서 가장 가까운 대여 가능 대여소)</span>}
          </p>
          {startStation.bikes === 0 && (
            <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
              ⚠️ 이 대여소는 지금 대여 가능한 자전거가 0대입니다 (조회 {fmtTimeSec(stationsFetchedAt).slice(0, 5)} 기준). 다른 대여소를
              고르는 것을 고려하세요.
            </p>
          )}

          {routes.error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p className="font-semibold">자전거 경로를 조회하지 못했습니다.</p>
              <p className="mt-1 text-xs">{routes.error}</p>
              <p className="mt-2 text-[11px] text-red-700/80">임의의 경로는 표시하지 않습니다.</p>
            </div>
          ) : (
            <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
              <caption className="sr-only">경로별 거리·소요 시간·주변 사고다발지역 비교</caption>
              <thead>
                <tr>
                  <th scope="col" className="w-[34%] pb-1 text-left text-[11px] font-medium text-zinc-500">
                    항목
                  </th>
                  {MODES.map((m) => (
                    <th key={m} scope="col" className="pb-1 pl-1">
                      <button
                        type="button"
                        aria-pressed={m === mode}
                        onClick={() => onModeChange(m)}
                        className={`w-full rounded-lg border-2 px-1.5 py-1 text-xs font-bold transition ${
                          m === mode ? "bg-white shadow-sm" : "border-transparent bg-zinc-100 opacity-70 hover:opacity-100"
                        }`}
                        style={{ color: ROUTE_COLOR[m], borderColor: m === mode ? ROUTE_COLOR[m] : undefined }}
                      >
                        {MODE_LABEL[m]}
                        {m === mode && <span className="block text-[10px] font-medium text-zinc-500">지도에 표시 중</span>}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="[&_td]:border-t [&_td]:border-zinc-100 [&_td]:py-1.5 [&_th]:border-t [&_th]:border-zinc-100 [&_th]:py-1.5">
                <tr>
                  <th scope="row" className="text-left text-xs font-medium text-zinc-600">
                    거리
                  </th>
                  {MODES.map((m) => (
                    <td key={m} className="pl-2 font-bold text-zinc-900">
                      {cell(m, () => <>{km(ok(m)!.distanceM)} km</>)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className="text-left text-xs font-medium text-zinc-600">
                    예상 소요
                  </th>
                  {MODES.map((m) => (
                    <td key={m} className="pl-2 text-zinc-800">
                      {cell(m, () => <>약 {minutes(ok(m)!.durationSec)}분</>)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className="text-left text-xs font-medium text-zinc-600">
                    주변 사고다발지역
                    <span className="block text-[10px] font-normal text-zinc-400">경로 {ROUTE_ACCIDENT_RADIUS_M}m 이내</span>
                  </th>
                  {MODES.map((m) => (
                    <td key={m} className="pl-2 font-bold text-zinc-900">
                      {cell(m, () => <>{sums[m].count}곳</>, true)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className="text-left text-xs font-medium text-zinc-600">
                    사망·중상 발생 지점
                  </th>
                  {MODES.map((m) => (
                    <td key={m} className="pl-2 text-zinc-800">
                      {cell(m, () => <>{sums[m].severe}곳</>, true)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className="text-left text-xs font-medium text-zinc-600">
                    해당 지점 사고·사상자
                  </th>
                  {MODES.map((m) => (
                    <td key={m} className="pl-2 text-xs text-zinc-700">
                      {cell(m, () => <>{sums[m].accidents}건 · {sums[m].casualties}명</>, true)}
                    </td>
                  ))}
                </tr>
                {MODES.some((m) => results?.[m] && "error" in results[m]) && (
                  <tr>
                    <th scope="row" className="text-left text-xs font-medium text-red-700">
                      조회 실패
                    </th>
                    {MODES.map((m) => {
                      const r = results?.[m];
                      return (
                        <td key={m} className="pl-2 text-[11px] text-red-700">
                          {r && "error" in r ? r.error : ""}
                        </td>
                      );
                    })}
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {facts.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-zinc-700">
              {facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-zinc-50 p-2">
              <div className="text-[11px] text-zinc-500">출발 대여소 대여 가능</div>
              <div className="font-bold text-zinc-900">
                {startStation.bikes}대 <span className="font-normal text-zinc-500">/ 거치대 {startStation.docks}개</span>
              </div>
            </div>
            <div className="rounded-lg bg-zinc-50 p-2">
              <div className="text-[11px] text-zinc-500">
                {originName} 날씨{now ? ` (${fmtDateTime(now.forecastAt).split(" ").pop()} 예보)` : ""}
              </div>
              <div className="font-bold text-zinc-900">
                {forecast.error ? (
                  <span className="font-normal text-zinc-400">정보 없음</span>
                ) : now ? (
                  <>
                    {now.temp ?? "-"}° · 강수확률 {now.pop ?? "-"}%
                  </>
                ) : (
                  <Skeleton />
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
        <p className="font-semibold">⚠️ 이 비교는 실제 안전성을 판단하거나 보장하지 않습니다</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>
            사고다발지역은 {accidents.data ? `${accidents.data.year}년 기준 ` : ""}과거 통계입니다. 주변 사고다발지역이 적다고 그 경로가
            더 안전하다는 뜻은 아닙니다.
          </li>
          <li>현재 교통량, 공사, 노면 상태, 조명, 시간대, 개인의 주행 습관은 반영되지 않았습니다.</li>
          <li>실제 도로 상황과 교통 신호를 직접 확인하고, 안전모를 착용하세요.</li>
        </ul>
      </div>

      <div className="mt-3">
        <div className="mb-1 text-[11px] font-semibold text-zinc-500">정보 출처와 기준 시각 (한국 시간)</div>
        <dl className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 text-[11px]">
          <div className="grid grid-cols-[4.5rem_1fr] gap-2 px-2.5 py-1.5">
            <dt className="font-semibold text-zinc-700">따릉이</dt>
            <dd className="text-zinc-600">
              서울 열린데이터광장 공공자전거 실시간 대여정보
              <br />
              <span className="text-zinc-900">조회 {fmtTimeSec(stationsFetchedAt)}</span>
              <span className="text-zinc-400"> · API가 측정시각을 제공하지 않아 조회 시각 표시</span>
            </dd>
          </div>
          <div className="grid grid-cols-[4.5rem_1fr] gap-2 px-2.5 py-1.5">
            <dt className="font-semibold text-zinc-700">자전거 경로</dt>
            <dd className="text-zinc-600">
              카카오맵 자전거 경로 API
              <br />
              <span className="text-zinc-900">조회 {routes.fetchedAt && !routes.loading ? fmtDateTime(routes.fetchedAt) : "-"}</span>
            </dd>
          </div>
          <div className="grid grid-cols-[4.5rem_1fr] gap-2 px-2.5 py-1.5">
            <dt className="font-semibold text-zinc-700">사고다발지역</dt>
            <dd className="text-zinc-600">
              한국도로교통공단 자전거 교통사고 다발지역정보
              <br />
              <span className="text-zinc-900">{accidents.data ? `${accidents.data.year}년 기준 (과거 통계)` : "-"}</span>
              <span className="text-zinc-400"> · 조회 {fmtDateTime(accidents.fetchedAt)}</span>
            </dd>
          </div>
          <div className="grid grid-cols-[4.5rem_1fr] gap-2 px-2.5 py-1.5">
            <dt className="font-semibold text-zinc-700">날씨</dt>
            <dd className="text-zinc-600">
              기상청 단기예보 · 격자 {forecast.data ? `(${forecast.data.grid.nx}, ${forecast.data.grid.ny})` : "-"}
              <br />
              <span className="text-zinc-900">
                발표 {fmtDateTime(forecast.data?.issuedAt)} · 예보 {now ? fmtDateTime(now.forecastAt) : "-"}
              </span>
            </dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}
