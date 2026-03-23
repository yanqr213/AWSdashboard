"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import styles from "@/app/console.module.css";
import { buildQueryString, getFaultSeverityTone } from "@/app/dashboard/helpers";
import { formatDateTime } from "@/lib/format";
import type { DashboardFaultHistoryState, FaultHistoryEntry } from "@/lib/iot-platform";

type DeviceFaultHistoryModalProps = {
  environment: string;
  deviceId: string;
  open: boolean;
  onClose: () => void;
};

type FaultQuery = {
  hours: number;
  startAt: string;
  endAt: string;
};

function getToneClassName(severity: string) {
  const tone = getFaultSeverityTone(severity);
  if (tone === "critical") {
    return styles.faultCritical;
  }

  if (tone === "warning") {
    return styles.faultWarning;
  }

  if (tone === "notice") {
    return styles.faultNotice;
  }

  return styles.faultDefault;
}

export function DeviceFaultHistoryModal({ environment, deviceId, open, onClose }: DeviceFaultHistoryModalProps) {
  const [query, setQuery] = useState<FaultQuery>({
    hours: 72,
    startAt: "",
    endAt: "",
  });
  const [rows, setRows] = useState<FaultHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const cacheRef = useRef(new Map<string, DashboardFaultHistoryState>());

  useEffect(() => {
    if (!open) {
      return;
    }

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open]);

  useEffect(() => {
    setQuery({
      hours: 72,
      startAt: "",
      endAt: "",
    });
    setRows([]);
    setError(null);
    cacheRef.current = new Map();
  }, [deviceId, environment]);

  useEffect(() => {
    if (!open) {
      return;
    }

    applyQuery(query);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function applyQuery(nextQuery: FaultQuery) {
    startTransition(() => {
      void (async () => {
        const queryString = buildQueryString({
          environment,
          deviceId,
          hours: nextQuery.hours,
          startAt: nextQuery.startAt,
          endAt: nextQuery.endAt,
        });

        const cached = cacheRef.current.get(queryString);
        if (cached) {
          setRows(cached.faultHistory);
          setError(cached.notices[0] || null);
          setQuery(nextQuery);
          return;
        }

        const response = await fetch(`/api/dashboard/fault-history?${queryString}`, {
          method: "GET",
          credentials: "same-origin",
        });
        if (!response.ok) {
          setError("加载历史故障失败。");
          return;
        }

        const payload = (await response.json()) as DashboardFaultHistoryState;
        cacheRef.current.set(queryString, payload);
        setRows(payload.faultHistory);
        setError(payload.notices[0] || null);
        setQuery(nextQuery);
      })();
    });
  }

  if (!open) {
    return null;
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modalCard} onClick={(event) => event.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <span className={styles.eyebrow}>Fault History</span>
            <h2 className={styles.sectionTitle}>{deviceId} 历史故障</h2>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className={styles.inlineActions}>
          {[
            { label: "24 小时", hours: 24 },
            { label: "3 天", hours: 72 },
            { label: "7 天", hours: 168 },
            { label: "全周期", hours: 0 },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              className={query.hours === preset.hours && !query.startAt && !query.endAt ? "button-primary" : "button-secondary"}
              onClick={() => {
                const nextQuery = { hours: preset.hours, startAt: "", endAt: "" };
                setQuery(nextQuery);
                applyQuery(nextQuery);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className={styles.filterRow}>
          <label className={styles.fieldLabel}>
            <span>开始时间</span>
            <input type="datetime-local" value={query.startAt} onChange={(event) => setQuery((current) => ({ ...current, startAt: event.target.value }))} className={styles.input} />
          </label>
          <label className={styles.fieldLabel}>
            <span>结束时间</span>
            <input type="datetime-local" value={query.endAt} onChange={(event) => setQuery((current) => ({ ...current, endAt: event.target.value }))} className={styles.input} />
          </label>
          <label className={styles.fieldLabel}>
            <span>操作</span>
            <button type="button" className="button-secondary" onClick={() => applyQuery(query)} disabled={isPending}>
              {isPending ? "加载中..." : "刷新故障表"}
            </button>
          </label>
        </div>

        {error ? <div className={styles.notice}>{error}</div> : null}

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>时间</th>
                <th>级别</th>
                <th>故障码</th>
                <th>名称</th>
                <th>来源</th>
                <th>位值</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.timestamp}-${row.code}-${row.identifier}`}>
                  <td>{formatDateTime(row.timestamp)}</td>
                  <td>
                    <span className={`${styles.faultBadge} ${getToneClassName(row.severity)}`}>{row.severity}</span>
                  </td>
                  <td>{row.code}</td>
                  <td>
                    <span className={styles.tableStrong}>{row.name || row.meaning}</span>
                    <span className={styles.tableSubtle}>{row.description || row.display}</span>
                  </td>
                  <td>{row.sourceLabel}</td>
                  <td>{row.rawHex}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && !isPending ? <div className={styles.emptyState}>当前时间范围内没有匹配到历史故障记录。</div> : null}
        </div>
      </div>
    </div>
  );
}
