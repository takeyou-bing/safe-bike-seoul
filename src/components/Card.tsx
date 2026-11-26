import type { ReactNode } from "react";

export function LiveBadge() {
  return (
    <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
      실시간
    </span>
  );
}

export function Card({
  title,
  icon,
  badge,
  children,
}: {
  title: string;
  icon: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-zinc-900">
          <span aria-hidden="true">{icon}</span>
          {title}
        </h2>
        {badge}
      </header>
      {children}
    </section>
  );
}
