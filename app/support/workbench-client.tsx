"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import styles from "@/app/console.module.css";
import { buildFaultStatusValue, buildQueryString, buildSoftwareVersionValue, getMetricByIdentifiers } from "@/app/dashboard/helpers";
import { formatDateTime } from "@/lib/format";
import type { DashboardDetailState, SupportWorkbenchState } from "@/lib/iot-platform";

type SupportWorkbenchClientProps = {
  initialState: SupportWorkbenchState;
};

function getIssueToneClassName(issueLevel: "high" | "medium" | "normal") {
  if (issueLevel === "high") {
    return styles.faultCritical;
  }

  if (issueLevel === "medium") {
    return styles.faultWarning;
  }

  return styles.faultNotice;
}

function buildSupportSummary(detailState: DashboardDetailState) {
  const latestReportedAt = detailState.selectedDevice?.lastSeen || null;
  const soc = getMetricByIdentifiers(detailState.currentValues, ["SOC"])?.value || "--";
  const totalOutput = getMetricByIdentifiers(detailState.currentValues, ["TotalOutP", "LoadP"])?.value || "--";
  const batteryVoltage = getMetricByIdentifiers(detailState.currentValues, ["BMSV", "BatV"])?.value || "--";
  const softwareVersions = buildSoftwareVersionValue(detailState.currentValues);
  const faultSummary = buildFaultStatusValue(detailState.decodedFaults);
  const recentSummary = detailState.recentDailySummaries[0]
    ? `最近一天样本 ${detailState.recentDailySummaries[0].sampleCount} 条，峰值功率 ${detailState.recentDailySummaries[0].peakOutputPower}。`
    : "最近 3 天暂无可展示摘要。";

  const suggestions: string[] = [];
  if (!latestReportedAt) {
    suggestions.push("优先确认设备是否已完成配网、激活以及稳定供电。");
  } else {
    const ageHours = (Date.now() - latestReportedAt) / (1000 * 60 * 60);
    if (ageHours > 72) {
      suggestions.push("已超过 72 小时未上报，建议售后优先回访现场。");
    } else if (ageHours > 24) {
      suggestions.push("已超过 24 小时未上报，建议客服先确认现场网络状态。");
    }
  }

  if (detailState.decodedFaults.length > 0) {
    suggestions.push("当前存在激活故障，建议先查看故障历史并记录故障码。");
  }

  if (!suggestions.length) {
    suggestions.push("设备近期上报正常，可作为常规回访或版本核验对象。");
  }

  return [
    `设备：${detailState.selectedDevice?.label || detailState.selectedDeviceId || "--"} (${detailState.selectedDevice?.modelLabel || "--"})`,
    `环境：${detailState.selectedEnvironment.label}`,
    `最后上报：${formatDateTime(latestReportedAt)}`,
    `软件版本：${softwareVersions}`,
    `故障状态：${faultSummary}`,
    `主机 SOC：${soc}`,
    `当前输出：${totalOutput}`,
    `电池总压：${batteryVoltage}`,
    `近 3 天摘要：${recentSummary}`,
    `建议动作：${suggestions.join(" ")}`,
  ].join("\n");
}

export function SupportWorkbenchClient({ initialState }: SupportWorkbenchClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState(initialState);
  const [environment, setEnvironment] = useState<string>(initialState.selectedEnvironment.key);
  const [diagnoseDeviceId, setDiagnoseDeviceId] = useState("");
  const [diagnosis, setDiagnosis] = useState<DashboardDetailState | null>(null);
  const [diagnosisError, setDiagnosisError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const deferredDeviceId = useDeferredValue(diagnoseDeviceId.trim());
  const cacheRef = useRef(new Map<string, SupportWorkbenchState>([[initialState.selectedEnvironment.key, initialState]]));
  const diagnosisCacheRef = useRef(new Map<string, DashboardDetailState>());

  const supportSummaryText = useMemo(() => (diagnosis ? buildSupportSummary(diagnosis) : ""), [diagnosis]);

  function loadWorkbench(nextEnvironment: string, force = false) {
    startTransition(() => {
      void (async () => {
        if (!force) {
          const cached = cacheRef.current.get(nextEnvironment);
          if (cached) {
            setState(cached);
            setEnvironment(nextEnvironment);
            router.replace(nextEnvironment === initialState.selectedEnvironment.key ? pathname : `${pathname}?environment=${nextEnvironment}`, { scroll: false });
            return;
          }
        }

        const query = buildQueryString({ environment: nextEnvironment });
        const response = await fetch(`/api/support/workbench?${query}`, {
          method: "GET",
          credentials: "same-origin",
        });
        if (!response.ok) {
          return;
        }

        const nextState = (await response.json()) as SupportWorkbenchState;
        cacheRef.current.set(nextEnvironment, nextState);
        setState(nextState);
        setEnvironment(nextEnvironment);
        router.replace(nextEnvironment === initialState.selectedEnvironment.key ? pathname : `${pathname}?environment=${nextEnvironment}`, { scroll: false });
      })();
    });
  }

  function loadDiagnosis(targetDeviceId: string) {
    const normalizedDeviceId = targetDeviceId.trim();
    if (!normalizedDeviceId) {
      setDiagnosis(null);
      setDiagnosisError("请输入设备编号。");
      return;
    }

    setDiagnoseDeviceId(normalizedDeviceId);
    setDiagnosisError(null);

    startTransition(() => {
      void (async () => {
        const cacheKey = `${environment}:${normalizedDeviceId}`;
        const cached = diagnosisCacheRef.current.get(cacheKey);
        if (cached) {
          setDiagnosis(cached);
          return;
        }

        const query = buildQueryString({
          environment,
          deviceId: normalizedDeviceId,
        });
        const response = await fetch(`/api/dashboard/detail?${query}`, {
          method: "GET",
          credentials: "same-origin",
        });
        if (!response.ok) {
          setDiagnosis(null);
          setDiagnosisError("加载设备诊断失败，请确认设备编号是否正确。");
          return;
        }

        const nextDiagnosis = (await response.json()) as DashboardDetailState;
        if (!nextDiagnosis.selectedDeviceId) {
          setDiagnosis(null);
          setDiagnosisError("没有找到该设备的可用诊断数据。");
          return;
        }

        diagnosisCacheRef.current.set(cacheKey, nextDiagnosis);
        setDiagnosis(nextDiagnosis);
      })();
    });
  }

  async function copySummary() {
    if (!supportSummaryText) {
      return;
    }

    await navigator.clipboard.writeText(supportSummaryText);
  }

  return (
    <main className={`${styles.page} ${styles.pageWide}`}>
      <section className={styles.hero}>
        <div className={styles.heroTop}>
          <div className={styles.heroMain}>
            <span className={styles.eyebrow}>Support Tools</span>
            <h1 className={styles.heroTitle}>服务工具</h1>
            <p className={styles.heroCopy}>面向客服和售后，集中处理待跟进设备、快速诊断和客户沟通摘要。</p>
          </div>
          <div className={styles.heroActions}>
            <span className={`${styles.modeChip} ${styles.modeChipLive}`}>{state.selectedEnvironment.label}</span>
            <button type="button" className="button-secondary" onClick={() => loadWorkbench(environment, true)} disabled={isPending}>
              {isPending ? "刷新中..." : "刷新工作台"}
            </button>
          </div>
        </div>

        <div className={styles.chipGrid}>
          <article className={styles.chipCard}>
            <span className={styles.chipLabel}>设备总数</span>
            <strong className={styles.chipValue}>{state.summary.totalDevices}</strong>
            <span className={styles.chipHint}>当前环境已识别设备</span>
          </article>
          <article className={styles.chipCard}>
            <span className={styles.chipLabel}>24 小时内活跃</span>
            <strong className={styles.chipValue}>{state.summary.activeWithin24Hours}</strong>
            <span className={styles.chipHint}>近期正常上报</span>
          </article>
          <article className={styles.chipCard}>
            <span className={styles.chipLabel}>超 24 小时未上报</span>
            <strong className={styles.chipValue}>{state.summary.stale24Hours}</strong>
            <span className={styles.chipHint}>客服优先跟进</span>
          </article>
          <article className={styles.chipCard}>
            <span className={styles.chipLabel}>超 72 小时未上报</span>
            <strong className={styles.chipValue}>{state.summary.stale72Hours}</strong>
            <span className={styles.chipHint}>售后优先处理</span>
          </article>
        </div>
      </section>

      {state.notices.length ? (
        <section className={styles.noticeStack}>
          {state.notices.map((notice) => (
            <div key={notice} className={styles.notice}>
              {notice}
            </div>
          ))}
        </section>
      ) : null}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>快速诊断</h2>
            <p className={styles.sectionCopy}>输入设备编号即可生成客服摘要，并支持直接跳转设备详情。</p>
          </div>
        </div>

        <div className={styles.filterRow}>
          <label className={styles.fieldLabel}>
            <span>环境</span>
            <select
              value={environment}
              onChange={(event) => {
                const nextEnvironment = event.target.value;
                setEnvironment(nextEnvironment);
                loadWorkbench(nextEnvironment);
              }}
              className={styles.select}
            >
              {state.environments.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.fieldLabel}>
            <span>设备编号</span>
            <input value={diagnoseDeviceId} onChange={(event) => setDiagnoseDeviceId(event.target.value)} className={styles.input} placeholder="输入 DeviceKey，例如 TBe072a1edaacc" />
          </label>
          <label className={styles.fieldLabel}>
            <span>诊断操作</span>
            <button type="button" className="button-secondary" onClick={() => loadDiagnosis(deferredDeviceId)} disabled={isPending}>
              {isPending ? "诊断中..." : "载入诊断"}
            </button>
          </label>
          <label className={styles.fieldLabel}>
            <span>页面跳转</span>
            {deferredDeviceId ? (
              <Link href={`/devices/${deferredDeviceId}?${buildQueryString({ environment })}`} className="button-secondary button-link">
                打开设备详情
              </Link>
            ) : (
              <button type="button" className="button-secondary" disabled>
                打开设备详情
              </button>
            )}
          </label>
        </div>
      </section>

      <section className={styles.contentGrid}>
        <div className={styles.stack}>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>待跟进设备</h2>
                <p className={styles.sectionCopy}>根据上报时效和字段完整度，优先列出客服和售后需要关注的设备。</p>
              </div>
              <span className={styles.sectionKicker}>{state.followUpDevices.length} 台重点设备</span>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>设备</th>
                    <th>型号</th>
                    <th>最后上报</th>
                    <th>跟进建议</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {state.followUpDevices.map((device) => (
                    <tr key={device.id}>
                      <td>
                        <span className={styles.tableStrong}>{device.label}</span>
                        <span className={styles.tableSubtle}>{device.id}</span>
                      </td>
                      <td>{device.modelLabel}</td>
                      <td>{formatDateTime(device.lastSeen)}</td>
                      <td>
                        <span className={`${styles.faultBadge} ${getIssueToneClassName(device.issueLevel)}`}>{device.issueLabel}</span>
                        <span className={styles.tableSubtle}>{device.actionHint}</span>
                      </td>
                      <td>
                        <div className={styles.tableActions}>
                          <button type="button" className={styles.tableAction} onClick={() => loadDiagnosis(device.id)}>
                            快速诊断
                          </button>
                          <Link href={`/devices/${device.id}?${buildQueryString({ environment })}`} className={styles.tableAction}>
                            设备详情
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {state.followUpDevices.length === 0 ? <div className={styles.emptyState}>当前没有需要重点跟进的设备。</div> : null}
            </div>
          </section>
        </div>

        <div className={styles.stack}>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h2 className={styles.sectionTitle}>诊断结果</h2>
                <p className={styles.sectionCopy}>适合客服复述给客户，也方便售后内部记录。</p>
              </div>
            </div>

            {diagnosis ? (
              <>
                <div className={styles.detailSummaryGrid}>
                  <article className={styles.detailSummaryCard}>
                    <span>设备型号</span>
                    <strong>{diagnosis.selectedDevice?.modelLabel || "--"}</strong>
                    <em>{diagnosis.selectedDevice?.label || diagnosis.selectedDeviceId || "--"}</em>
                  </article>
                  <article className={styles.detailSummaryCard}>
                    <span>最后上报</span>
                    <strong>{formatDateTime(diagnosis.selectedDevice?.lastSeen || null)}</strong>
                    <em>{diagnosis.selectedEnvironment.label}</em>
                  </article>
                  <article className={styles.detailSummaryCard}>
                    <span>故障状态</span>
                    <strong>{buildFaultStatusValue(diagnosis.decodedFaults)}</strong>
                    <em>{diagnosis.decodedFaults.length} 条激活故障</em>
                  </article>
                  <article className={styles.detailSummaryCard}>
                    <span>软件版本</span>
                    <strong>{buildSoftwareVersionValue(diagnosis.currentValues)}</strong>
                    <em>BMS / IOT / AC / DC</em>
                  </article>
                </div>

                <section className={styles.section}>
                  <div className={styles.sectionHeader}>
                    <div>
                      <h2 className={styles.sectionTitle}>客服摘要</h2>
                      <p className={styles.sectionCopy}>一键复制给客服、售后或客户沟通使用。</p>
                    </div>
                    <button type="button" className="button-secondary" onClick={() => void copySummary()}>
                      复制摘要
                    </button>
                  </div>
                  <pre className={styles.supportNote}>{supportSummaryText}</pre>
                </section>
              </>
            ) : (
              <div className={styles.emptyState}>{diagnosisError || "输入设备编号或点击左侧设备，即可生成诊断结果。"}</div>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
