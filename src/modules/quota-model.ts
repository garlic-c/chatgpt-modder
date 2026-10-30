export interface QuotaWindow {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_at?: number;
}
export interface Usage {
  user_id?: string;
  account_id?: string;
  rate_limit?: {
    primary_window?: QuotaWindow | null;
    secondary_window?: QuotaWindow | null;
  };
}
export function remaining(w?: QuotaWindow | null): number | null {
  return w &&
    typeof w.used_percent === "number" &&
    Number.isFinite(w.used_percent)
    ? Math.min(100, Math.max(0, 100 - w.used_percent))
    : null;
}
export function quotaView(
  usage: Usage | null | undefined,
  account: string | null,
  user: string | null,
  now: number,
  stale = false,
) {
  const valid =
    !stale &&
    !!usage &&
    !!account &&
    !!user &&
    usage.account_id === account &&
    usage.user_id === user;
  const windows = valid
    ? [usage.rate_limit?.primary_window, usage.rate_limit?.secondary_window]
    : [];
  const five = windows.find((w) => w?.limit_window_seconds === 18000),
    week = windows.find((w) => w?.limit_window_seconds === 604800);
  const expiredFive =
    typeof five?.reset_at === "number" && five.reset_at * 1000 <= now;
  const expiredWeek =
    typeof week?.reset_at === "number" && week.reset_at * 1000 <= now;
  const fiveLeft = expiredFive ? null : remaining(five),
    weekLeft = expiredWeek ? null : remaining(week);
  const minutes =
    typeof five?.reset_at === "number" && Number.isFinite(five.reset_at)
      ? Math.max(0, Math.ceil((five.reset_at * 1000 - now) / 60000))
      : null;
  return {
    five: fiveLeft,
    week: weekLeft,
    countdown:
      minutes == null
        ? "--h--m"
        : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`,
    needsRefresh: valid && (expiredFive || expiredWeek),
  };
}
