"use client";

import { useEffect, useEffectEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const DEFAULT_INTERVAL_SECONDS = 15;

export function LiveRefreshControls({
  refreshedAt,
  intervalSeconds = DEFAULT_INTERVAL_SECONDS,
}: {
  refreshedAt: number;
  intervalSeconds?: number;
}) {
  const router = useRouter();
  const [isPaused, setIsPaused] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [nextRefreshAt, setNextRefreshAt] = useState(refreshedAt + intervalSeconds * 1000);
  const [now, setNow] = useState(Date.now());

  const triggerRefresh = useEffectEvent(() => {
    startTransition(() => {
      router.refresh();
    });
  });

  useEffect(() => {
    setNow(Date.now());
    setNextRefreshAt(refreshedAt + intervalSeconds * 1000);
  }, [intervalSeconds, refreshedAt]);

  useEffect(() => {
    if (isPaused) {
      return;
    }

    const timer = window.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);

      if (currentTime >= nextRefreshAt) {
        setNextRefreshAt(currentTime + intervalSeconds * 1000);
        triggerRefresh();
      }
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [intervalSeconds, isPaused, nextRefreshAt, triggerRefresh]);

  const secondsLeft = Math.max(0, Math.ceil((nextRefreshAt - now) / 1000));
  const refreshedLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(refreshedAt)),
    [refreshedAt],
  );

  return (
    <div className="live-refresh-shell">
      <div className="live-refresh-meta">
        <span className="refresh-dot" />
        <strong>{isPaused ? "Auto-refresh paused" : `Auto-refresh in ${secondsLeft}s`}</strong>
        <span>Last sync {refreshedLabel}</span>
      </div>
      <div className="live-refresh-actions">
        <button type="button" className="button-secondary" onClick={() => triggerRefresh()} disabled={isPending}>
          {isPending ? "Refreshing..." : "Refresh now"}
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={() => setIsPaused((currentValue) => !currentValue)}
        >
          {isPaused ? "Resume live updates" : "Pause live updates"}
        </button>
      </div>
    </div>
  );
}
