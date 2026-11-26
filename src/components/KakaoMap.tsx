"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Place } from "@/lib/places";
import type { AccidentSpot, BikeRoute, BikeRouteMode, BikeStation } from "@/lib/api-types";
import { loadKakaoMaps } from "@/lib/kakaoLoader";

export type Selection = { kind: "station" | "accident"; id: string } | null;

type Props = {
  origin: Place;
  destination: Place;
  /** 출발 대여소 */
  startStation: BikeStation | null;
  /** 카카오맵 자전거 경로 API로 받은 실제 경로 (실패한 모드는 없음) */
  routes: Partial<Record<BikeRouteMode, BikeRoute>>;
  activeMode: BikeRouteMode;
  /** 서울 자전거 교통사고 다발지역 (한국도로교통공단, 과거 사고 통계) */
  accidentSpots: AccidentSpot[];
  accidentYear?: number;
  /** 활성 경로 주변 사고다발지역 id */
  routeAccidentIds: Set<string>;
  /** 서울 전체 실시간 대여소 (아직 못 불러왔으면 undefined) */
  stations: BikeStation[] | undefined;
  /** 출발지 주변 대여소 (거리순) */
  nearby: BikeStation[];
  stationsFetchedAt?: string;
  selected: Selection;
  onSelect: (selection: Selection) => void;
  onChooseStart: (station: BikeStation) => void;
  /** 지도 왼쪽 위에 표시할 상태 칩 (확대 안내와 같은 세로 흐름에 배치해 겹치지 않게 함) */
  overlayTopLeft?: ReactNode;
};

const APP_KEY = process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? "";
const SEOUL_CENTER = { lat: 37.535, lng: 126.99 };
/** 이 레벨 이하(더 확대)일 때 화면 안의 모든 대여소를 표시 */
export const ALL_STATIONS_MAX_LEVEL = 5;

export const ROUTE_COLOR: Record<BikeRouteMode, string> = { BIKE_ONLY: "#2563eb", SHORTEST: "#7c3aed" };
/** 피해 정도별 색: 사망자 있음 / 중상자 있음 / 경상·부상신고 */
export const SEVERITY_COLOR: Record<AccidentSpot["severity"], string> = { high: "#b91c1c", medium: "#ea580c", low: "#d97706" };

type View = { level: number; south: number; west: number; north: number; east: number };

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function html(markup: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.innerHTML = markup.trim();
  return wrap.firstElementChild as HTMLElement;
}

export function availabilityColor(bikes: number): string {
  return bikes === 0 ? "#71717a" : bikes <= 2 ? "#d97706" : "#16a34a";
}

function stationMarker(s: BikeStation, emphasized: boolean, active: boolean): HTMLElement {
  const color = availabilityColor(s.bikes);
  return html(`
    <button type="button" title="${esc(s.name)} · 대여 가능 ${s.bikes}대" style="
      display:flex;align-items:center;gap:3px;cursor:pointer;white-space:nowrap;
      padding:${emphasized || active ? "3px 8px" : "1px 5px"};border-radius:999px;
      font:700 ${emphasized || active ? 12 : 10}px/1.2 system-ui,sans-serif;
      border:2px solid ${color};
      background:${active ? color : "#fff"};color:${active ? "#fff" : color};
      opacity:${emphasized || active ? 1 : 0.85};
      box-shadow:0 1px 4px rgba(0,0,0,.25);
      transform:${active ? "scale(1.15)" : "none"};">
      <span aria-hidden="true">🚲</span>${s.bikes}
    </button>`);
}

function accidentMarker(a: AccidentSpot, year: number | undefined, onRoute: boolean, active: boolean): HTMLElement {
  const size = active ? 30 : onRoute ? 26 : 20;
  return html(`
    <button type="button" title="${esc(a.name)} · ${year ?? ""}년 기준 자전거 사고 ${a.accidents}건 (과거 통계)" style="
      width:${size}px;height:${size}px;cursor:pointer;
      display:flex;align-items:center;justify-content:center;
      border-radius:50%;border:2px solid #fff;
      background:${SEVERITY_COLOR[a.severity]};color:#fff;
      font:800 ${Math.round(size * 0.48)}px/1 system-ui,sans-serif;
      opacity:${onRoute || active ? 1 : 0.55};
      box-shadow:0 1px 4px rgba(0,0,0,.35);">${a.accidents}</button>`);
}

function pinMarker(label: string, color: string): HTMLElement {
  return html(`
    <div style="display:flex;flex-direction:column;align-items:center;pointer-events:none;">
      <div style="padding:4px 10px;border-radius:999px;background:${color};color:#fff;
        font:700 12px/1.2 system-ui,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.3);white-space:nowrap;">${esc(label)}</div>
      <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid ${color};"></div>
    </div>`);
}

function dotMarker(label: string, color: string): HTMLElement {
  return html(`
    <div title="${esc(label)}" style="pointer-events:none;width:14px;height:14px;border-radius:50%;
      background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);"></div>`);
}

function infoBubble(
  title: string,
  lines: string[],
  footer: { text: string; color: string },
  action?: { label: string; onClick: () => void },
): HTMLElement {
  const el = html(`
    <div style="position:relative;margin-bottom:6px;min-width:190px;max-width:260px;padding:10px 12px;
      background:#fff;border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.25);
      font:12px/1.5 system-ui,sans-serif;color:#27272a;">
      <div style="font-weight:700;font-size:13px;margin-bottom:2px;">${esc(title)}</div>
      ${lines.map((l) => `<div>${esc(l)}</div>`).join("")}
      <div style="margin-top:4px;font-size:11px;color:${footer.color};">${esc(footer.text)}</div>
    </div>`);
  if (action) {
    const btn = html(`
      <button type="button" style="margin-top:8px;width:100%;padding:6px 0;border:0;border-radius:8px;cursor:pointer;
        background:#16a34a;color:#fff;font:700 12px/1.2 system-ui,sans-serif;">${esc(action.label)}</button>`);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      action.onClick();
    });
    el.appendChild(btn);
  }
  return el;
}

const timeLabel = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }) : "";

export default function KakaoMap({
  origin,
  destination,
  startStation,
  routes,
  activeMode,
  accidentSpots,
  accidentYear,
  routeAccidentIds,
  stations,
  nearby,
  stationsFetchedAt,
  selected,
  onSelect,
  onChooseStart,
  overlayTopLeft,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<kakao.maps.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  const onChooseStartRef = useRef(onChooseStart);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(APP_KEY ? "loading" : "error");
  const [error, setError] = useState(APP_KEY ? "" : "NEXT_PUBLIC_KAKAO_JS_KEY 환경 변수가 설정되지 않았습니다.");
  const [view, setView] = useState<View | null>(null);
  /** 지도 로드 실패 시 안내에 보여 줄 현재 주소 (카카오에 등록해야 하는 값) */
  const [pageOrigin, setPageOrigin] = useState<string | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onChooseStartRef.current = onChooseStart;
  }, [onSelect, onChooseStart]);

  // SDK 로드 및 지도 생성
  useEffect(() => {
    if (!APP_KEY) return;
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    let detach: (() => void) | null = null;

    loadKakaoMaps(APP_KEY)
      .then(() => {
        const container = containerRef.current;
        if (cancelled || !container) return;
        const map = new kakao.maps.Map(container, {
          center: new kakao.maps.LatLng(SEOUL_CENTER.lat, SEOUL_CENTER.lng),
          level: 7,
        });
        map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);

        const onIdle = () => {
          const b = map.getBounds();
          const sw = b.getSouthWest();
          const ne = b.getNorthEast();
          setView({ level: map.getLevel(), south: sw.getLat(), west: sw.getLng(), north: ne.getLat(), east: ne.getLng() });
        };
        kakao.maps.event.addListener(map, "idle", onIdle);
        detach = () => kakao.maps.event.removeListener(map, "idle", onIdle);

        observer = new ResizeObserver(() => map.relayout());
        observer.observe(container);
        mapRef.current = map;
        setStatus("ready");
        onIdle();
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setPageOrigin(window.location.origin);
        setStatus("error");
      });

    return () => {
      cancelled = true;
      observer?.disconnect();
      detach?.();
      mapRef.current = null;
    };
  }, []);

  const findStation = useMemo(() => {
    const byId = new Map<string, BikeStation>();
    stations?.forEach((s) => byId.set(s.id, s));
    nearby.forEach((s) => byId.set(s.id, s)); // 거리 정보가 있는 쪽 우선
    return (id: string) => byId.get(id);
  }, [stations, nearby]);

  // 지도 범위: 경로가 있으면 경로 전체, 없으면 출발지·출발 대여소·목적지
  const fitKey = [
    routes.BIKE_ONLY ? `${routes.BIKE_ONLY.distanceM}:${routes.BIKE_ONLY.path.length}` : "",
    routes.SHORTEST ? `${routes.SHORTEST.distanceM}:${routes.SHORTEST.path.length}` : "",
    origin.id,
    destination.id,
    startStation?.id ?? "",
  ].join("|");
  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map) return;
    const bounds = new kakao.maps.LatLngBounds();
    const add = (p: { lat: number; lng: number }) => bounds.extend(new kakao.maps.LatLng(p.lat, p.lng));
    const paths = [routes.BIKE_ONLY?.path, routes.SHORTEST?.path].filter((p): p is NonNullable<typeof p> => Boolean(p));
    if (paths.length) paths.forEach((p) => p.forEach(add));
    else [origin, destination, startStation].forEach((p) => p && add(p));
    add(origin);
    map.setBounds(bounds, 80, 60, 80, 60);
    // fitKey가 바뀔 때만 범위를 다시 맞춤 (사용자가 옮긴 지도를 매번 되돌리지 않도록)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, fitKey]);

  // 선택한 항목으로 지도 이동 (선택이 바뀔 때만)
  const selectedKey = selected ? `${selected.kind}:${selected.id}` : "";
  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map || !selectedKey) return;
    const sep = selectedKey.indexOf(":");
    const kind = selectedKey.slice(0, sep);
    const id = selectedKey.slice(sep + 1);
    const item = kind === "station" ? findStation(id) : accidentSpots.find((a) => a.id === id);
    if (item) map.panTo(new kakao.maps.LatLng(item.lat, item.lng));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, selectedKey]);

  // 실제 자전거 경로 · 출발지/출발 대여소/목적지 · 사고다발지역(한국도로교통공단, 과거 통계)
  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map) return;

    const drawn: { setMap(m: kakao.maps.Map | null): void }[] = [];
    const ll = (p: { lat: number; lng: number }) => new kakao.maps.LatLng(p.lat, p.lng);
    const select = (s: Selection) => onSelectRef.current(s);

    // 비활성 경로를 먼저(아래), 활성 경로를 나중(위)에 그림
    const order: BikeRouteMode[] = activeMode === "BIKE_ONLY" ? ["SHORTEST", "BIKE_ONLY"] : ["BIKE_ONLY", "SHORTEST"];
    for (const mode of order) {
      const r = routes[mode];
      if (!r) continue;
      const path = r.path.map(ll);
      const active = mode === activeMode;
      if (active) {
        drawn.push(new kakao.maps.Polyline({ map, path, strokeWeight: 10, strokeColor: "#ffffff", strokeOpacity: 0.95, zIndex: 2 }));
      }
      drawn.push(
        new kakao.maps.Polyline({
          map,
          path,
          strokeWeight: active ? 6 : 4,
          strokeColor: ROUTE_COLOR[mode],
          strokeOpacity: active ? 0.95 : 0.55,
          strokeStyle: active ? "solid" : "shortdash",
          zIndex: active ? 3 : 1,
        }),
      );
    }

    accidentSpots.forEach((a) => {
      const active = selected?.kind === "accident" && selected.id === a.id;
      const onRoute = routeAccidentIds.has(a.id);
      // 경로 주변·선택한 다발지역은 실제 범위(폴리곤)도 표시
      if ((onRoute || active) && a.polygons.length) {
        drawn.push(
          new kakao.maps.Polygon({
            map,
            path: a.polygons.map((ring) => ring.map(ll)),
            strokeWeight: 2,
            strokeColor: SEVERITY_COLOR[a.severity],
            strokeOpacity: 0.9,
            fillColor: SEVERITY_COLOR[a.severity],
            fillOpacity: active ? 0.3 : 0.18,
            zIndex: 0,
          }),
        );
      }
      const content = accidentMarker(a, accidentYear, onRoute, active);
      content.addEventListener("click", () => select(active ? null : { kind: "accident", id: a.id }));
      drawn.push(new kakao.maps.CustomOverlay({ map, position: ll(a), content, zIndex: active ? 20 : onRoute ? 7 : 5, clickable: true }));
    });

    drawn.push(new kakao.maps.CustomOverlay({ map, position: ll(origin), content: dotMarker(`출발지 · ${origin.name}`, "#2563eb"), zIndex: 9 }));
    if (startStation) {
      drawn.push(
        new kakao.maps.CustomOverlay({ map, position: ll(startStation), content: pinMarker(`출발 대여소 · ${startStation.name}`, "#16a34a"), yAnchor: 1.45, zIndex: 12 }),
      );
    }
    drawn.push(new kakao.maps.CustomOverlay({ map, position: ll(destination), content: pinMarker(`도착 · ${destination.name}`, "#e11d48"), yAnchor: 1, zIndex: 10 }));

    if (selected?.kind === "accident") {
      const a = accidentSpots.find((x) => x.id === selected.id);
      if (a) {
        const injuries = [
          a.deaths ? `사망 ${a.deaths}` : null,
          a.seriousInjuries ? `중상 ${a.seriousInjuries}` : null,
          a.minorInjuries ? `경상 ${a.minorInjuries}` : null,
          a.injuryReports ? `부상신고 ${a.injuryReports}` : null,
        ].filter(Boolean);
        drawn.push(
          new kakao.maps.CustomOverlay({
            map,
            position: ll(a),
            content: infoBubble(
              a.name,
              [`${a.district} · 자전거 사고 ${a.accidents}건`, `사상자 ${a.casualties}명${injuries.length ? ` (${injuries.join(", ")})` : ""}`],
              { text: `※ ${accidentYear ?? ""}년 기준 과거 사고 통계 (한국도로교통공단)`, color: "#b45309" },
            ),
            yAnchor: 1.3,
            zIndex: 30,
          }),
        );
      }
    }

    return () => drawn.forEach((o) => o.setMap(null));
  }, [status, routes, activeMode, accidentSpots, accidentYear, routeAccidentIds, origin, destination, startStation, selected]);

  // 실시간 따릉이 대여소: 출발지 주변·출발 대여소는 항상, 나머지는 충분히 확대했을 때 화면 안의 것만 표시
  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map || !view) return;

    const drawn: kakao.maps.CustomOverlay[] = [];
    const ll = (p: { lat: number; lng: number }) => new kakao.maps.LatLng(p.lat, p.lng);
    const select = (s: Selection) => onSelectRef.current(s);
    const nearbyIds = new Set(nearby.map((s) => s.id));
    const selectedId = selected?.kind === "station" ? selected.id : null;

    const pad = 0.002;
    const inView = (s: BikeStation) =>
      s.lat >= view.south - pad && s.lat <= view.north + pad && s.lng >= view.west - pad && s.lng <= view.east + pad;

    const visible = new Map<string, BikeStation>();
    nearby.forEach((s) => visible.set(s.id, s));
    if (startStation) visible.set(startStation.id, findStation(startStation.id) ?? startStation);
    if (view.level <= ALL_STATIONS_MAX_LEVEL) stations?.forEach((s) => inView(s) && !visible.has(s.id) && visible.set(s.id, s));
    if (selectedId && !visible.has(selectedId)) {
      const s = findStation(selectedId);
      if (s) visible.set(s.id, s);
    }

    visible.forEach((s) => {
      const active = s.id === selectedId;
      const emphasized = nearbyIds.has(s.id) || s.id === startStation?.id;
      const content = stationMarker(s, emphasized, active);
      content.addEventListener("click", () => select(active ? null : { kind: "station", id: s.id }));
      drawn.push(new kakao.maps.CustomOverlay({ map, position: ll(s), content, zIndex: active ? 20 : emphasized ? 6 : 4, clickable: true }));
    });

    if (selectedId) {
      const s = findStation(selectedId);
      if (s) {
        const lines = [`대여 가능 ${s.bikes}대 · 거치대 ${s.docks}개`];
        if (s.distanceM !== undefined) lines.push(`출발지에서 ${s.distanceM.toLocaleString()}m`);
        const isStart = s.id === startStation?.id;
        drawn.push(
          new kakao.maps.CustomOverlay({
            map,
            position: ll(s),
            content: infoBubble(
              s.name,
              lines,
              { text: `● 실시간 · ${timeLabel(stationsFetchedAt)} 기준${isStart ? " · 현재 출발 대여소" : ""}`, color: "#15803d" },
              isStart ? undefined : { label: "이 대여소에서 출발", onClick: () => onChooseStartRef.current(s) },
            ),
            yAnchor: 1.25,
            zIndex: 30,
            clickable: true,
          }),
        );
      }
    }

    return () => drawn.forEach((o) => o.setMap(null));
  }, [status, view, stations, nearby, selected, findStation, stationsFetchedAt, startStation]);

  const zoomHint = status === "ready" && view && view.level > ALL_STATIONS_MAX_LEVEL;

  return (
    <div className="relative h-full w-full bg-zinc-200">
      <div ref={containerRef} className="h-full w-full" />

      {/* 상태 칩 → 확대 안내 순서로 쌓아 화면 폭과 관계없이 겹치지 않게 함. 오른쪽은 확대/축소 버튼 자리 */}
      <div className="pointer-events-none absolute left-2 top-2 z-10 flex max-w-[calc(100%-4rem)] flex-col items-start gap-1 lg:left-3 lg:top-3 lg:gap-1.5">
        {overlayTopLeft}
        {zoomHint && (
          <div className="rounded-full bg-zinc-900/80 px-2 py-0.5 text-[10px] text-white shadow lg:px-3 lg:py-1 lg:text-xs">
            확대하면 화면 안의 모든 따릉이 대여소가 표시됩니다
          </div>
        )}
      </div>

      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-100/80 text-sm text-zinc-600">
          <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
          카카오맵을 불러오는 중…
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-100 p-6">
          <div className="max-w-md rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-700 shadow-sm">
            <p className="mb-2 text-base font-semibold text-zinc-900">지도를 표시할 수 없습니다</p>
            <p className="mb-3 text-red-600">{error}</p>
            <p className="mb-1 font-medium text-zinc-800">가장 흔한 원인과 해결 방법</p>
            <ul className="list-disc space-y-1.5 pl-5 text-zinc-600">
              <li>
                <b>이 주소가 카카오에 등록되지 않음:</b> Kakao Developers › [앱] › [플랫폼 키] › [JavaScript 키] › [JavaScript SDK
                도메인]에 {pageOrigin ? "다음 주소를" : "현재 주소를"} 추가하세요.
                {pageOrigin && (
                  <code className="my-1 block w-fit rounded bg-zinc-100 px-1.5 py-0.5 font-semibold text-zinc-900">{pageOrigin}</code>
                )}
                <span className="text-zinc-500">포트 번호까지 일치해야 합니다.</span>
              </li>
              <li>
                <code>NEXT_PUBLIC_KAKAO_JS_KEY</code>에 JavaScript 키(REST 키 아님)가 들어 있는지 확인하세요. 배포 환경에서 값을
                바꿨다면 다시 배포해야 반영됩니다.
              </li>
              <li>Kakao Developers › [카카오맵] › [사용 설정]이 ON인지 확인하세요.</li>
            </ul>
            <p className="mt-3 text-xs text-zinc-500">왼쪽 패널의 정보는 지도 없이도 확인할 수 있습니다.</p>
          </div>
        </div>
      )}
    </div>
  );
}
