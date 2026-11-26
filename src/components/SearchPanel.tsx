"use client";

import { useEffect, useId, useState } from "react";
import type { BikeRouteMode, PlaceResult } from "@/lib/api-types";
import { toPlace, type Place } from "@/lib/places";
import { Card } from "./Card";

const DEBOUNCE_MS = 250;
const MAX_QUERY = 50;

/** 같은 검색어는 다시 요청하지 않도록 브라우저 메모리에 보관 (서버에도 1시간 캐시) */
const resultCache = new Map<string, Place[]>();

type Found = { query: string; items?: Place[]; error?: string };

function PlaceInput({
  label,
  dotClass,
  value,
  onChange,
}: {
  label: string;
  dotClass: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
}) {
  const listId = useId();
  const [text, setText] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<Found | null>(null);

  // 부모에서 값이 바뀌면(예: 출발/도착 바꾸기) 입력창 텍스트를 맞춤.
  // 사용자가 입력 중이라 선택이 해제된 경우(value → null)에는 입력한 텍스트를 유지.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (value || text === prevValue?.name) setText(value?.name ?? "");
  }

  const q = text.trim();
  const isSelectedText = Boolean(value && q === value.name);
  const shouldSearch = open && q.length > 0 && !isSelectedText;

  // 카카오 장소 검색 (/api/places): 입력이 멈추고 0.25초 뒤 요청, 새 입력이 오면 이전 요청 취소
  useEffect(() => {
    if (!shouldSearch || resultCache.has(q)) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/places?query=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json || "error" in json) throw new Error(json?.error ?? `요청 실패 (HTTP ${res.status})`);
        const items = (json.data as PlaceResult[]).map(toPlace);
        resultCache.set(q, items);
        setFound({ query: q, items });
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setFound({ query: q, error: e instanceof Error && e.message !== "Failed to fetch" ? e.message : "서버에 연결하지 못했습니다." });
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [shouldSearch, q]);

  const items = resultCache.get(q) ?? (found?.query === q ? found.items : undefined);
  const error = found?.query === q ? found.error : undefined;
  const loading = shouldSearch && !items && !error;
  const results = shouldSearch ? (items ?? []) : [];

  const pick = (p: Place) => {
    onChange(p);
    setText(p.name);
    setOpen(false);
  };

  return (
    <div className="relative">
      <label className="flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3 py-2 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
        <span className="w-10 shrink-0 text-xs font-semibold text-zinc-500">{label}</span>
        <input
          role="combobox"
          aria-label={`${label} 검색`}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results.length ? `${listId}-${active}` : undefined}
          maxLength={MAX_QUERY}
          enterKeyHint="search"
          className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
          placeholder="장소·주소 검색 (서울)"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
            if (value && e.target.value !== value.name) onChange(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            // 한글 조합 중 Enter·화살표는 IME가 처리하도록 무시 (조합 중 Enter로 엉뚱한 항목이 선택되는 것 방지)
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Escape") return setOpen(false);
            if (!open || results.length === 0) {
              if (e.key === "Enter") e.preventDefault();
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => (i + 1) % results.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i - 1 + results.length) % results.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(results[Math.min(active, results.length - 1)]);
            }
          }}
        />
        {loading && (
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-500" aria-label="검색 중" />
        )}
      </label>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} 검색 결과`}
          className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-zinc-200 bg-white py-1 shadow-lg"
        >
          {!q && <li className="px-3 py-2 text-sm text-zinc-500">장소 이름이나 주소를 입력하세요. 서울 안 장소만 검색됩니다.</li>}
          {isSelectedText && (
            <li className="px-3 py-2 text-sm text-zinc-500">
              선택됨: {value!.address}
              <span className="block text-xs text-zinc-400">다른 장소를 찾으려면 지우고 새로 입력하세요.</span>
            </li>
          )}
          {loading && <li className="px-3 py-2 text-sm text-zinc-500">검색 중…</li>}
          {error && <li className="px-3 py-2 text-sm text-red-600">장소를 검색하지 못했습니다: {error}</li>}
          {shouldSearch && items && items.length === 0 && (
            <li className="px-3 py-2 text-sm text-zinc-500">
              &lsquo;{q}&rsquo;에 대한 서울 안 검색 결과가 없습니다. 다른 이름이나 주소로 검색해 보세요.
            </li>
          )}
          {results.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              // mouseenter 대신 mousemove: 목록이 멈춰 있는 커서 아래에 새로 뜰 때 키보드 선택이 바뀌지 않도록
              onMouseMove={() => active !== i && setActive(i)}
              className={`cursor-pointer px-3 py-2 ${i === active ? "bg-blue-50" : ""}`}
            >
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-zinc-900">{p.name}</span>
                {p.category && (
                  <span className="shrink-0 rounded bg-zinc-100 px-1 text-[10px] text-zinc-500">{p.category}</span>
                )}
              </div>
              <div className="truncate text-xs text-zinc-500">{p.address}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SearchPanel({
  initialOrigin,
  initialDestination,
  mode,
  onModeChange,
  onSearch,
}: {
  initialOrigin: Place;
  initialDestination: Place;
  mode: BikeRouteMode;
  onModeChange: (mode: BikeRouteMode) => void;
  onSearch: (origin: Place, destination: Place) => void;
}) {
  const [origin, setOrigin] = useState<Place | null>(initialOrigin);
  const [destination, setDestination] = useState<Place | null>(initialDestination);
  const [message, setMessage] = useState("");

  const submit = () => {
    if (!origin || !destination) return setMessage("검색 결과 목록에서 출발지와 목적지를 선택해 주세요.");
    if (origin.id === destination.id) return setMessage("출발지와 목적지가 같습니다.");
    setMessage("");
    onSearch(origin, destination);
  };

  return (
    <Card
      title="출발지·목적지"
      icon="🔎"
      badge={
        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-200">카카오 장소 검색</span>
      }
    >
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-stretch gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            <PlaceInput label="출발지" dotClass="bg-blue-600" value={origin} onChange={setOrigin} />
            <PlaceInput label="목적지" dotClass="bg-rose-600" value={destination} onChange={setDestination} />
          </div>
          <button
            type="button"
            aria-label="출발지와 목적지 바꾸기"
            title="출발지와 목적지 바꾸기"
            onClick={() => {
              setOrigin(destination);
              setDestination(origin);
            }}
            className="w-9 shrink-0 rounded-xl border border-zinc-300 text-lg text-zinc-600 hover:bg-zinc-50"
          >
            ⇅
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1 text-sm" role="radiogroup" aria-label="경로 옵션">
          {(
            [
              ["BIKE_ONLY", "🛣️ 자전거도로 우선"],
              ["SHORTEST", "⚡ 최단 경로"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => onModeChange(value)}
              className={`rounded-lg py-1.5 font-medium transition ${
                mode === value ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {message && <p className="text-xs text-red-600">{message}</p>}

        <button
          type="submit"
          className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 active:bg-blue-800"
        >
          출발지·목적지 적용
        </button>
        <p className="text-[11px] text-zinc-500">
          카카오 장소 검색으로 서울 안의 장소·주소를 찾습니다. 경로는 출발지 주변 따릉이 대여소에서 목적지까지 카카오맵 API로 조회합니다.
        </p>
      </form>
    </Card>
  );
}
