"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_DESTINATION, DEFAULT_ORIGIN, type Place } from "@/lib/places";
import type { AccidentData, BikeRoute, BikeRouteMode, BikeRouteResults, BikeStation, ForecastData } from "@/lib/api-types";
import { fmtDateTime, fmtTimeSec } from "@/lib/format";
import { accidentsNearPath } from "@/lib/route";
import { useApi } from "@/lib/useApi";
import { CompareCard } from "./CompareCard";
import { AccidentCard, StationCard, WeatherCard } from "./InfoCards";
import KakaoMap, { ROUTE_COLOR, SEVERITY_COLOR, type Selection } from "./KakaoMap";
import { SearchPanel } from "./SearchPanel";

const AUTO_REFRESH_MS = 60_000;

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export default function SafeBikeApp() {
  const [trip, setTrip] = useState<{ origin: Place; destination: Place }>({
    origin: DEFAULT_ORIGIN,
    destination: DEFAULT_DESTINATION,
  });
  const [mode, setMode] = useState<BikeRouteMode>("BIKE_ONLY");
  const [selected, setSelected] = useState<Selection>(null);
  const [radius, setRadius] = useState(1000);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  /** 모바일에서 지도 범례 펼침 여부 (데스크톱은 항상 펼침) */
  const [legendOpen, setLegendOpen] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  /** 날씨 카드가 '지금 이후' 예보시각을 고를 때 쓰는 현재 시각 (1분마다 갱신) */
  // 서버 프리렌더 시점의 시각이 박히지 않도록 처음엔 null, 브라우저에서 마운트 직후 설정
  const [nowMs, setNowMs] = useState<number | null>(null);
  /** 사용자가 직접 고른 출발 대여소 (없으면 가장 가까운 대여 가능 대여소를 자동 선택) */
  const [chosenStart, setChosenStart] = useState<BikeStation | null>(null);

  // 실시간 따릉이: 서울 전체(지도 표시용) + 출발지 주변(거리순 검색)
  const all = useApi<BikeStation[]>("/api/stations", refreshToken);
  const nearbyUrl = `/api/stations?lat=${trip.origin.lat}&lng=${trip.origin.lng}&radius=${radius}&limit=100`;
  const nearby = useApi<BikeStation[]>(nearbyUrl, refreshToken);
  const nearbyList = useMemo(() => nearby.data ?? [], [nearby.data]);

  // 자동 선택: 현재 출발지 반경 안에 있고 자전거가 남아 있는 가장 가까운 대여소
  const autoStart = useMemo(
    () => nearbyList.find((s) => s.bikes > 0 && distanceM(trip.origin, s) <= radius + 50) ?? null,
    [nearbyList, trip.origin, radius],
  );
  // 직접 고른 대여소는 새로 받아 온 데이터에서 다시 찾아 대여 가능 대수를 최신으로 유지
  const startStation = useMemo(() => {
    if (!chosenStart) return autoStart;
    return nearbyList.find((s) => s.id === chosenStart.id) ?? all.data?.find((s) => s.id === chosenStart.id) ?? chosenStart;
  }, [chosenStart, autoStart, nearbyList, all.data]);

  // 카카오맵 자전거 경로 API: 출발 대여소 → 목적지 (자전거도로 우선 + 최단 경로)
  const routeUrl = startStation
    ? `/api/bike-route?startLat=${startStation.lat}&startLng=${startStation.lng}&endLat=${trip.destination.lat}&endLng=${trip.destination.lng}`
    : null;
  const routeReq = useApi<BikeRouteResults>(routeUrl);
  const routeResults = routeReq.loading || routeReq.error ? undefined : routeReq.data;

  const routes = useMemo(() => {
    const out: Partial<Record<BikeRouteMode, BikeRoute>> = {};
    if (routeResults) {
      for (const m of ["BIKE_ONLY", "SHORTEST"] as const) {
        const r = routeResults[m];
        if ("route" in r) out[m] = r.route;
      }
    }
    return out;
  }, [routeResults]);
  const activeRoute = routes[mode];

  // 한국도로교통공단 자전거 교통사고 다발지역 (최신 기준연도 자동 확인, 과거 사고 통계)
  const accidentReq = useApi<AccidentData>("/api/accidents");
  const accidentSpots = useMemo(() => accidentReq.data?.spots ?? [], [accidentReq.data]);
  // 두 경로 각각의 주변 사고다발지역 (비교표용), 지도·목록은 선택한 경로 기준
  const accidentsByMode = useMemo(
    () => ({
      BIKE_ONLY: routes.BIKE_ONLY ? accidentsNearPath(routes.BIKE_ONLY.path, accidentSpots) : [],
      SHORTEST: routes.SHORTEST ? accidentsNearPath(routes.SHORTEST.path, accidentSpots) : [],
    }),
    [routes, accidentSpots],
  );
  const routeAccidents = useMemo(() => (activeRoute ? accidentsByMode[mode] : []), [activeRoute, accidentsByMode, mode]);
  // 기상청 단기예보: 출발지 좌표 → 격자 변환은 서버에서 (서버 캐시 30분, 대여소 새로고침 주기에 맞춰 재요청)
  const forecast = useApi<ForecastData>(`/api/forecast?lat=${trip.origin.lat}&lng=${trip.origin.lng}`, refreshToken);

  const routeAccidentIds = useMemo(() => new Set(routeAccidents.map((a) => a.id)), [routeAccidents]);

  // 1분마다 대여소 자동 새로고침 (탭이 보일 때만). 경로는 출발·도착이 바뀔 때만 조회.
  useEffect(() => {
    const first = window.setTimeout(() => setNowMs(Date.now()), 0);
    const id = window.setInterval(() => {
      setNowMs(Date.now());
      if (document.visibilityState === "visible") setRefreshToken((t) => t + 1);
    }, AUTO_REFRESH_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);

  const handleSearch = useCallback((origin: Place, destination: Place) => {
    setTrip({ origin, destination });
    setChosenStart(null);
    setSelected(null);
  }, []);

  const handleChooseStart = useCallback((s: BikeStation) => {
    setChosenStart(s);
    setSelected(null);
  }, []);

  // 지도에서 선택한 항목을 목록에서도 보이도록 스크롤
  useEffect(() => {
    if (!selected) return;
    document.getElementById(`${selected.kind}-${selected.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  return (
    <div className="flex h-dvh flex-col bg-zinc-100 text-zinc-900 lg:flex-row">
      <aside className="order-2 flex h-[55dvh] w-full flex-col border-zinc-200 bg-zinc-50 lg:order-1 lg:h-full lg:w-[400px] lg:shrink-0 lg:border-r">
        <header className="border-b border-zinc-200 bg-white px-4 py-3">
          <h1 className="text-xl font-extrabold tracking-tight">
            <span aria-hidden="true">🚲 </span>Safe Bike Seoul
          </h1>
          <p className="text-xs text-zinc-500">따릉이·자전거 경로·사고다발지역·날씨 정보를 한 화면에서 비교</p>
          <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            모든 정보는 공공·카카오 API의 실제 데이터입니다. 사고다발지역은{" "}
            {accidentReq.data ? `${accidentReq.data.year}년 기준 ` : ""}
            <strong className="font-semibold">과거 사고 통계</strong>이며, 이 화면은 경로의 실제 안전성을 판단하지 않습니다.
          </div>
        </header>

        {/* relative: 안쪽의 absolute 요소(스크린리더용 표 캡션, 검색 목록 등)가 스크롤 영역 밖으로 나가 페이지 전체를 늘리지 않도록 */}
        <div className="relative min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          <SearchPanel
            initialOrigin={DEFAULT_ORIGIN}
            initialDestination={DEFAULT_DESTINATION}
            mode={mode}
            onModeChange={setMode}
            onSearch={handleSearch}
          />
          <CompareCard
            originName={trip.origin.name}
            startStation={startStation}
            isAutoStart={!chosenStart && Boolean(autoStart)}
            destination={trip.destination}
            mode={mode}
            onModeChange={setMode}
            routes={routeReq}
            accidentsByMode={accidentsByMode}
            accidents={accidentReq}
            stationsFetchedAt={nearby.fetchedAt ?? all.fetchedAt}
            noStartReason={
              nearby.error
                ? { kind: "error", text: nearby.error }
                : nearby.loading && !nearby.data
                  ? { kind: "loading", text: "출발지 주변 따릉이 대여소를 찾는 중입니다…" }
                  : {
                      kind: "empty",
                      text: `${trip.origin.name} 반경 ${radius >= 1000 ? `${radius / 1000}km` : `${radius}m`} 안에 자전거가 남아 있는 대여소가 없습니다. 아래에서 반경을 넓히거나 직접 대여소를 고르세요.`,
                    }
            }
            forecast={forecast}
            nowMs={nowMs}
          />
          <StationCard
            originName={trip.origin.name}
            stations={nearby.data}
            totalCount={all.data?.length}
            radius={radius}
            onRadiusChange={setRadius}
            onlyAvailable={onlyAvailable}
            onOnlyAvailableChange={setOnlyAvailable}
            loading={nearby.loading}
            error={nearby.error}
            fetchedAt={nearby.fetchedAt}
            onRefresh={() => setRefreshToken((t) => t + 1)}
            selected={selected}
            onSelect={setSelected}
            startId={startStation?.id ?? null}
            onChooseStart={handleChooseStart}
          />
          <AccidentCard
            accidents={routeAccidents}
            hasRoute={Boolean(activeRoute)}
            year={accidentReq.data?.year}
            totalCount={accidentReq.data?.spots.length}
            criteria={accidentReq.data?.criteria}
            loading={accidentReq.loading}
            error={accidentReq.error}
            selected={selected}
            onSelect={setSelected}
          />
          <WeatherCard originName={trip.origin.name} data={forecast.data} loading={forecast.loading} error={forecast.error} nowMs={nowMs} />
        </div>
      </aside>

      <main className="relative order-1 h-[45dvh] min-h-0 flex-1 lg:order-2 lg:h-full">
        <KakaoMap
          origin={trip.origin}
          destination={trip.destination}
          startStation={startStation}
          routes={routes}
          activeMode={mode}
          accidentSpots={accidentSpots}
          accidentYear={accidentReq.data?.year}
          routeAccidentIds={routeAccidentIds}
          stations={all.data}
          nearby={nearbyList}
          stationsFetchedAt={all.fetchedAt ?? nearby.fetchedAt}
          selected={selected}
          onSelect={setSelected}
          onChooseStart={handleChooseStart}
          overlayTopLeft={
            <>
              <div className="flex flex-wrap gap-1 lg:gap-1.5">
                <StatusChip
                  tone="emerald"
                  error={Boolean(all.error)}
                  text={`🚲 따릉이${all.data ? ` ${all.data.length.toLocaleString()}곳 · 조회 ${fmtTimeSec(all.fetchedAt).slice(0, 5)}` : all.error ? " 불러오기 실패" : " 불러오는 중"}`}
                />
                <StatusChip
                  tone="sky"
                  error={Boolean(routeReq.error)}
                  text={
                    routeReq.loading
                      ? "🛣️ 경로 조회 중…"
                      : routeReq.error
                        ? "🛣️ 경로 조회 실패"
                        : activeRoute
                          ? `🛣️ 카카오맵 경로 · 조회 ${fmtTimeSec(routeReq.fetchedAt).slice(0, 5)}`
                          : "🛣️ 경로 없음"
                  }
                />
                <StatusChip
                  tone="zinc"
                  error={Boolean(accidentReq.error)}
                  text={`⚠️ 사고다발지역${accidentReq.data ? ` · ${accidentReq.data.year}년 기준 과거 통계` : accidentReq.error ? " 불러오기 실패" : " 불러오는 중"}`}
                />
                <StatusChip
                  tone="indigo"
                  error={Boolean(forecast.error)}
                  text={`🌡️ 기상청${forecast.data ? ` ${fmtDateTime(forecast.data.issuedAt).split(" ").pop()} 발표` : forecast.error ? " 불러오기 실패" : " 불러오는 중"}`}
                />
              </div>
              {all.error && (
                <div className="max-w-xs rounded-lg bg-red-600/95 px-2.5 py-1.5 text-[11px] text-white shadow lg:text-xs">
                  지도용 대여소 정보를 불러오지 못했습니다: {all.error}
                </div>
              )}
            </>
          }
        />

        <div className="absolute bottom-2 left-2 z-10 max-w-[calc(100%-1rem)] rounded-xl bg-white/95 text-xs text-zinc-700 shadow-md lg:bottom-3 lg:left-3">
          {/* 모바일에서는 접어서 지도를 가리지 않게, 데스크톱에서는 항상 펼침 */}
          <button
            type="button"
            onClick={() => setLegendOpen((v) => !v)}
            aria-expanded={legendOpen}
            className="flex min-h-8 items-center gap-1 px-3 py-1.5 font-semibold text-zinc-900 lg:hidden"
          >
            범례 {legendOpen ? "▾" : "▸"}
          </button>
          <div className={`${legendOpen ? "block" : "hidden"} px-3 pb-3 lg:block lg:pt-3`}>
            <div className="mb-1.5 hidden font-semibold text-zinc-900 lg:block">범례</div>
            <ul className="space-y-1">
              {(["BIKE_ONLY", "SHORTEST"] as const).map((m) => (
                <li key={m} className="flex items-center gap-2">
                  <span className="h-1.5 w-5 rounded-full" style={{ background: ROUTE_COLOR[m], opacity: m === mode ? 1 : 0.5 }} />
                  {m === "BIKE_ONLY" ? "자전거도로 우선" : "최단 경로"}
                  {m === mode ? " (선택)" : ""}
                </li>
              ))}
              <li className="flex items-center gap-2">
                <span className="flex gap-0.5">
                  <span className="rounded-full border-2 border-green-600 px-1 text-[10px] font-bold text-green-700">3+</span>
                  <span className="rounded-full border-2 border-amber-600 px-1 text-[10px] font-bold text-amber-700">1-2</span>
                  <span className="rounded-full border-2 border-zinc-500 px-1 text-[10px] font-bold text-zinc-600">0</span>
                </span>
                따릉이 대여 가능 대수
              </li>
              <li className="flex items-center gap-2">
                <span className="flex gap-0.5">
                  {(["high", "medium", "low"] as const).map((s) => (
                    <span
                      key={s}
                      className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-extrabold text-white"
                      style={{ background: SEVERITY_COLOR[s] }}
                    >
                      n
                    </span>
                  ))}
                </span>
                사고다발지역 · 사고 건수
              </li>
            </ul>
            <p className="mt-1.5 text-[10px] leading-snug text-zinc-500">
              빨강 사망·주황 중상·노랑 경상 발생
              <br />
              {accidentReq.data ? `${accidentReq.data.year}년 기준 ` : ""}과거 사고 통계 (한국도로교통공단)
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

const CHIP_TONE = {
  emerald: "bg-emerald-600/95",
  sky: "bg-sky-600/95",
  zinc: "bg-zinc-700/95",
  indigo: "bg-indigo-600/95",
} as const;

/** 지도 위 데이터 상태 칩. 오류면 빨간색. 모바일에서는 작게 */
function StatusChip({ tone, text, error }: { tone: keyof typeof CHIP_TONE; text: string; error?: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow lg:px-3 lg:py-1 lg:text-xs ${error ? "bg-red-600/95" : CHIP_TONE[tone]}`}
    >
      {text}
    </span>
  );
}
