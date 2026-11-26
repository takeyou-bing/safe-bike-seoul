import type { AccidentSpot, BikeStation, ForecastData, ForecastSlot } from "@/lib/api-types";
import { ROUTE_ACCIDENT_RADIUS_M, type RouteAccident } from "@/lib/route";
import { Card, LiveBadge } from "./Card";
import { availabilityColor, type Selection } from "./KakaoMap";

/** 피해 정도 (실제 사상자 구성 기준) */
const SEVERITY: Record<AccidentSpot["severity"], { label: string; className: string }> = {
  high: { label: "사망사고 발생", className: "bg-red-100 text-red-800 ring-red-200" },
  medium: { label: "중상 발생", className: "bg-orange-100 text-orange-700 ring-orange-200" },
  low: { label: "경상·부상", className: "bg-amber-50 text-amber-800 ring-amber-200" },
};

function ApiBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-200">{label}</span>
  );
}

const KST: Intl.DateTimeFormatOptions = { timeZone: "Asia/Seoul" };
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("ko-KR", { ...KST, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const fmtHour = (iso: string) => `${new Date(iso).toLocaleString("ko-KR", { ...KST, hour: "2-digit", hour12: false }).replace("시", "")}시`;
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { ...KST, month: "numeric", day: "numeric", weekday: "short" });

function weatherIcon(s: ForecastSlot) {
  if (s.precipType === "비" || s.precipType === "소나기") return "🌧️";
  if (s.precipType === "눈") return "🌨️";
  if (s.precipType === "비/눈") return "🌨️";
  if (s.sky === "맑음") return "☀️";
  if (s.sky === "구름많음") return "⛅";
  if (s.sky === "흐림") return "☁️";
  return "🌡️";
}

const popColor = (pop: number | null) =>
  pop === null ? "text-zinc-400" : pop >= 60 ? "text-blue-700 font-bold" : pop >= 30 ? "text-blue-600" : "text-zinc-500";

function TimeChip({ label, value, tone }: { label: string; value: string; tone: "issued" | "forecast" }) {
  return (
    <div className={`flex-1 rounded-lg px-2.5 py-1.5 ${tone === "issued" ? "bg-zinc-100" : "bg-sky-50 ring-1 ring-sky-200"}`}>
      <div className={`text-[10px] font-semibold ${tone === "issued" ? "text-zinc-500" : "text-sky-700"}`}>{label}</div>
      <div className="text-xs font-bold text-zinc-900">{value}</div>
    </div>
  );
}

export function WeatherCard({
  originName,
  data,
  loading,
  error,
  nowMs,
}: {
  originName: string;
  data: ForecastData | undefined;
  loading: boolean;
  error?: string;
  /** 현재 시각 (브라우저에서 1분마다 갱신, 마운트 전에는 null) */
  nowMs: number | null;
}) {
  // 현재 시각이 속한 시간대 이후의 예보만 사용 (발표 직후에는 첫 예보시각이 다음 정시)
  const hourStart = nowMs === null ? Infinity : Math.floor(nowMs / 3_600_000) * 3_600_000;
  const upcoming = (data?.slots ?? []).filter((s) => new Date(s.forecastAt).getTime() >= hourStart);
  const now = upcoming[0];
  const next = upcoming.slice(0, 12);
  const maxPop6h = Math.max(-1, ...upcoming.slice(0, 6).map((s) => s.pop ?? -1));
  const today = data?.daily ?? [];

  return (
    <Card title="출발지 날씨" icon="🌡️" badge={<ApiBadge label="기상청 단기예보" />}>
      <p className="mb-2 text-xs text-zinc-600">
        📍 <span className="font-semibold text-blue-700">{originName}</span>
        {data && (
          <span className="text-zinc-500">
            {" "}
            · 기상청 격자 ({data.grid.nx}, {data.grid.ny})
          </span>
        )}
      </p>

      {error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">단기예보를 불러오지 못했습니다: {error}</p>
      ) : !data || !now ? (
        <div className="space-y-2" aria-label="불러오는 중">
          <div className="h-10 animate-pulse rounded-lg bg-zinc-100" />
          <div className="h-16 animate-pulse rounded-lg bg-zinc-100" />
          {!loading && data && <p className="text-xs text-zinc-500">표시할 수 있는 예보시각이 없습니다.</p>}
        </div>
      ) : (
        <>
          <div className="mb-3 flex gap-2">
            <TimeChip label="발표시각 (기상청 발표)" value={fmtDateTime(data.issuedAt)} tone="issued" />
            <TimeChip label="예보시각 (아래 날씨의 시각)" value={fmtDateTime(now.forecastAt)} tone="forecast" />
          </div>

          <div className={`flex items-center gap-4 ${loading ? "opacity-60" : ""}`}>
            <div className="text-5xl" aria-hidden="true">
              {weatherIcon(now)}
            </div>
            <div className="flex-1">
              <div className="text-3xl font-extrabold text-zinc-900">{now.temp ?? "-"}°</div>
              <div className="text-sm text-zinc-600">
                {now.sky}
                {now.precipType !== "없음" && ` · ${now.precipType}`}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-zinc-500">강수확률</div>
              <div className={`text-2xl ${popColor(now.pop)}`}>{now.pop ?? "-"}%</div>
            </div>
          </div>

          <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-zinc-50 py-1.5">
              <dt className="text-zinc-500">강수량</dt>
              <dd className="font-medium text-zinc-800">{now.precip ?? "-"}</dd>
            </div>
            <div className="rounded-lg bg-zinc-50 py-1.5">
              <dt className="text-zinc-500">습도</dt>
              <dd className="font-medium text-zinc-800">{now.humidity ?? "-"}%</dd>
            </div>
            <div className="rounded-lg bg-zinc-50 py-1.5">
              <dt className="text-zinc-500">풍속</dt>
              <dd className="font-medium text-zinc-800">{now.windSpeed ?? "-"}m/s</dd>
            </div>
          </dl>

          <div className="mt-3">
            <div className="mb-1 text-[11px] font-semibold text-zinc-500">시간별 예보 (예보시각 · 기온 · 강수확률)</div>
            <ol className="flex gap-1 overflow-x-auto pb-1">
              {next.map((s, i) => {
                const newDay = i > 0 && fmtDay(s.forecastAt) !== fmtDay(next[i - 1].forecastAt);
                return (
                  <li
                    key={s.forecastAt}
                    className={`min-w-[3.25rem] shrink-0 rounded-lg px-1 py-1.5 text-center text-xs ${i === 0 ? "bg-sky-50 ring-1 ring-sky-200" : "bg-zinc-50"}`}
                  >
                    <div className="text-[10px] text-zinc-400">{newDay || i === 0 ? fmtDay(s.forecastAt) : " "}</div>
                    <div className="font-medium text-zinc-600">{fmtHour(s.forecastAt)}</div>
                    <div className="my-0.5 text-base" aria-hidden="true">
                      {weatherIcon(s)}
                    </div>
                    <div className="font-semibold text-zinc-900">{s.temp ?? "-"}°</div>
                    <div className={popColor(s.pop)}>{s.pop ?? "-"}%</div>
                  </li>
                );
              })}
            </ol>
          </div>

          {today.length > 0 && (
            <p className="mt-2 text-[11px] text-zinc-600">
              {today
                .slice(0, 3)
                .map((d) => `${fmtDay(`${d.date}T12:00:00+09:00`)} 최저 ${d.min ?? "-"}° / 최고 ${d.max ?? "-"}°`)
                .join(" · ")}
            </p>
          )}

          <p
            className={`mt-3 rounded-xl px-3 py-2 text-sm font-medium ${
              maxPop6h >= 60 ? "bg-blue-50 text-blue-800" : maxPop6h >= 30 ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"
            }`}
          >
            {maxPop6h >= 60
              ? `☔ 앞으로 6시간 안에 강수확률이 ${maxPop6h}%까지 올라갑니다. 우비를 챙기세요.`
              : maxPop6h >= 30
                ? `🌂 앞으로 6시간 최고 강수확률 ${maxPop6h}%. 비 가능성이 있어요.`
                : `🌤️ 앞으로 6시간 최고 강수확률은 ${Math.max(0, maxPop6h)}%입니다.`}
          </p>
        </>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
        발표시각은 기상청이 예보를 발표한 시각(하루 8회: 02·05·08·11·14·17·20·23시), 예보시각은 그 예보가 가리키는 시각입니다. 출처:
        기상청 단기예보 조회서비스
      </p>
    </Card>
  );
}

export function AccidentCard({
  accidents,
  hasRoute,
  year,
  totalCount,
  criteria,
  loading,
  error,
  selected,
  onSelect,
}: {
  accidents: RouteAccident[];
  hasRoute: boolean;
  year?: number;
  totalCount?: number;
  criteria?: string;
  loading: boolean;
  error?: string;
  selected: Selection;
  onSelect: (s: Selection) => void;
}) {
  return (
    <Card
      title="경로 주변 사고다발지역"
      icon="⚠️"
      badge={
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 ring-1 ring-zinc-300">
          {year ? `${year}년 기준 · 과거 사고` : "과거 사고 통계"}
        </span>
      }
    >
      <div className="mb-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-700">
        <p className="font-semibold text-zinc-900">📅 과거 사고 통계입니다</p>
        <p className="mt-1">
          한국도로교통공단이 {year ? <b>{year}년 기준</b> : "과거"} 자전거 교통사고를 분석해 선정한 다발지역입니다. 지금 사고가 났거나
          실시간 위험을 뜻하지 않으며, 현재 도로 상황은 다를 수 있습니다.
        </p>
        {criteria && <p className="mt-1 text-zinc-500">선정 기준: {criteria}</p>}
      </div>

      {error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">사고다발지역 정보를 불러오지 못했습니다: {error}</p>
      ) : loading && totalCount === undefined ? (
        <ul className="space-y-2" aria-label="불러오는 중">
          {[0, 1].map((i) => (
            <li key={i} className="h-14 animate-pulse rounded-xl bg-zinc-100" />
          ))}
        </ul>
      ) : !hasRoute ? (
        <p className="rounded-xl bg-zinc-50 px-3 py-2 text-sm text-zinc-500">경로를 조회하면 경로 주변 사고다발지역을 보여 드립니다.</p>
      ) : accidents.length === 0 ? (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          선택한 경로 {ROUTE_ACCIDENT_RADIUS_M}m 이내에 사고다발지역이 없습니다.
        </p>
      ) : (
        <>
          <p className="mb-1.5 text-xs text-zinc-500">
            경로 {ROUTE_ACCIDENT_RADIUS_M}m 이내 {accidents.length}곳 · 경로 진행 순서
          </p>
          <ul className="space-y-2">
            {accidents.map((a) => {
              const active = selected?.kind === "accident" && selected.id === a.id;
              const sev = SEVERITY[a.severity];
              const injuries = [
                a.deaths ? `사망 ${a.deaths}` : null,
                a.seriousInjuries ? `중상 ${a.seriousInjuries}` : null,
                a.minorInjuries ? `경상 ${a.minorInjuries}` : null,
                a.injuryReports ? `부상신고 ${a.injuryReports}` : null,
              ].filter(Boolean);
              return (
                <li key={a.id} id={`accident-${a.id}`}>
                  <button
                    type="button"
                    onClick={() => onSelect(active ? null : { kind: "accident", id: a.id })}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      active ? "border-red-400 bg-red-50" : "border-zinc-200 hover:bg-zinc-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold text-zinc-900">{a.name}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${sev.className}`}>
                        {sev.label}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-zinc-700">
                      자전거 사고 <b>{a.accidents}건</b> · 사상자 {a.casualties}명
                      {injuries.length > 0 && <span className="text-zinc-500"> ({injuries.join(", ")})</span>}
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      {a.district} · 경로에서 {a.distanceM === 0 ? "경로가 지나감" : `${a.distanceM}m`}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className="mt-2 text-[11px] text-zinc-500">
        출처: 한국도로교통공단 자전거 교통사고 다발지역정보
        {totalCount !== undefined && year && <> · 서울 전체 {totalCount}곳 ({year}년 기준)</>}
      </p>
    </Card>
  );
}

export const RADIUS_OPTIONS = [500, 1000, 2000] as const;

const timeLabel = (iso?: string) =>
  iso ? new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "-";

export function StationCard({
  originName,
  stations,
  totalCount,
  radius,
  onRadiusChange,
  onlyAvailable,
  onOnlyAvailableChange,
  loading,
  error,
  fetchedAt,
  onRefresh,
  selected,
  onSelect,
  startId,
  onChooseStart,
}: {
  originName: string;
  stations: BikeStation[] | undefined;
  totalCount: number | undefined;
  radius: number;
  onRadiusChange: (r: number) => void;
  onlyAvailable: boolean;
  onOnlyAvailableChange: (v: boolean) => void;
  loading: boolean;
  error?: string;
  fetchedAt?: string;
  onRefresh: () => void;
  selected: Selection;
  onSelect: (s: Selection) => void;
  startId: string | null;
  onChooseStart: (s: BikeStation) => void;
}) {
  const list = (stations ?? []).filter((s) => !onlyAvailable || s.bikes > 0);
  const totalBikes = list.reduce((sum, s) => sum + s.bikes, 0);

  return (
    <Card title="출발지 주변 따릉이 대여소" icon="🚲" badge={<LiveBadge />}>
      <p className="mb-2 text-sm text-zinc-600">
        <span className="font-semibold text-blue-700">{originName}</span> 기준 가까운 순
      </p>

      <div className="mb-2 flex items-center gap-2">
        <div className="grid flex-1 grid-cols-3 gap-1 rounded-lg bg-zinc-100 p-1 text-xs" role="radiogroup" aria-label="검색 반경">
          {RADIUS_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={radius === r}
              onClick={() => onRadiusChange(r)}
              className={`min-h-8 rounded-md py-1.5 font-medium transition ${
                radius === r ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"
              }`}
            >
              {r >= 1000 ? `${r / 1000}km` : `${r}m`}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          title="새로고침"
          aria-label="대여소 정보 새로고침"
          className="h-8 w-8 shrink-0 rounded-lg border border-zinc-300 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
        >
          <span className={`inline-block ${loading ? "animate-spin" : ""}`}>↻</span>
        </button>
      </div>

      <label className="mb-2 flex items-center gap-2 text-xs text-zinc-600">
        <input type="checkbox" checked={onlyAvailable} onChange={(e) => onOnlyAvailableChange(e.target.checked)} className="accent-emerald-600" />
        대여 가능한 자전거가 있는 곳만 보기
      </label>

      {error && (
        <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          실시간 대여소 정보를 불러오지 못했습니다: {error}
          {stations && " (이전에 불러온 정보를 표시 중)"}
        </p>
      )}

      {!stations && loading && (
        <ul className="space-y-2" aria-label="불러오는 중">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-11 animate-pulse rounded-lg bg-zinc-100" />
          ))}
        </ul>
      )}

      {stations && list.length === 0 && (
        <p className="rounded-lg bg-zinc-50 px-3 py-3 text-sm text-zinc-500">
          반경 {radius >= 1000 ? `${radius / 1000}km` : `${radius}m`} 안에 {onlyAvailable ? "대여 가능한 " : ""}대여소가 없습니다. 반경을 넓혀 보세요.
        </p>
      )}

      {list.length > 0 && (
        <>
          <p className="mb-1 text-xs text-zinc-500">
            대여소 {list.length}곳 · 대여 가능 자전거 총 {totalBikes.toLocaleString()}대
          </p>
          <ul className={`divide-y divide-zinc-100 ${loading ? "opacity-60" : ""}`}>
            {list.map((s, i) => {
              const active = selected?.kind === "station" && selected.id === s.id;
              const isStart = s.id === startId;
              const color = availabilityColor(s.bikes);
              return (
                <li key={s.id} id={`station-${s.id}`} className={`flex items-center gap-1 rounded-lg ${active ? "bg-emerald-50" : ""}`}>
                  <button
                    type="button"
                    onClick={() => onSelect(active ? null : { kind: "station", id: s.id })}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2.5 text-left transition hover:bg-zinc-50"
                  >
                    <span className="w-5 shrink-0 text-center text-xs font-semibold text-zinc-400">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-zinc-900">{s.name}</div>
                      <div className="mt-0.5 text-[11px] text-zinc-500">
                        {s.distanceM !== undefined && <>{s.distanceM.toLocaleString()}m · </>}거치대 {s.docks}개
                      </div>
                    </div>
                    <div className="w-12 shrink-0 text-right">
                      <div className="text-lg font-bold" style={{ color }}>
                        {s.bikes}
                        <span className="text-xs font-medium text-zinc-400">대</span>
                      </div>
                      {s.bikes <= 2 && (
                        <div className="text-[10px] font-semibold" style={{ color }}>
                          {s.bikes === 0 ? "대여 불가" : "잔여 적음"}
                        </div>
                      )}
                    </div>
                  </button>
                  {isStart ? (
                    <span className="mr-1 w-14 shrink-0 rounded-md bg-green-600 py-1 text-center text-[11px] font-bold text-white">출발</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onChooseStart(s)}
                      aria-label={`${s.name}에서 출발`}
                      className="mr-1 w-14 shrink-0 rounded-md border border-green-600 py-1 text-[11px] font-semibold text-green-700 hover:bg-green-50"
                    >
                      여기서 출발
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className="mt-2 text-[11px] text-zinc-500">
        서울 열린데이터광장 공공자전거 실시간 대여정보 · {timeLabel(fetchedAt)} 기준
        {totalCount !== undefined && <> · 서울 전체 {totalCount.toLocaleString()}곳</>}
      </p>
    </Card>
  );
}
