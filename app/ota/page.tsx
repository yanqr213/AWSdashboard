import Link from "next/link";

import { requireAuthenticatedUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getDashboardState } from "@/lib/iot-platform";
import { getLocalOtaDraftDirectory, listLocalOtaDrafts } from "@/lib/local-ota-store";

import { OtaPublisher } from "./publisher";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatBucketAccess(accessible: boolean) {
  return accessible ? "可读取" : "未验证写权限";
}

function formatPrefixStatus(status: string) {
  switch (status) {
    case "ready":
      return "可用";
    case "empty":
      return "为空";
    case "denied":
      return "拒绝访问";
    case "error":
      return "读取失败";
    case "skipped":
      return "未检查";
    default:
      return status;
  }
}

export default async function OtaPage({ searchParams }: { searchParams?: SearchParams }) {
  await requireAuthenticatedUser();
  const params = searchParams ? await searchParams : {};
  const environment = readParam(params.environment);
  const deviceId = readParam(params.deviceId);
  const state = await getDashboardState({
    environment,
    deviceId,
  });
  const drafts = await listLocalOtaDrafts();
  const otaBuckets = state.bucketStatuses.filter((bucket) => /ota/i.test(bucket.bucket));

  return (
    <main className="app-shell app-shell-wide">
      <section className="panel platform-header">
        <div className="platform-header-main">
          <div className="platform-title-row">
            <span className="eyebrow">OTA 管理台</span>
            <span className={`mode-chip ${state.selectedEnvironment.key === "de-prod" ? "mode-chip-production" : "mode-chip-test"}`}>
              {state.selectedEnvironment.label}
            </span>
          </div>
          <h1>OTA 发布与通知</h1>
          <p className="panel-copy">
            当前支持先生成本地草稿，再按权限写入 OTA 桶。你可以直接为单台设备或整批设备生成 manifest 和 notify 内容。
          </p>
        </div>

        <div className="platform-header-actions">
          <div className="hero-stat">
            <span>目标设备</span>
            <strong>{state.selectedDeviceId || "整批设备"}</strong>
            <em>{state.selectedEnvironment.region}</em>
          </div>
          <div className="hero-stat">
            <span>本地草稿目录</span>
            <strong>.local-data/ota-notify</strong>
            <em>{getLocalOtaDraftDirectory()}</em>
          </div>
          <div className="action-row">
            <Link href={`/?environment=${state.selectedEnvironment.key}&deviceId=${state.selectedDeviceId || ""}`} className="button-secondary button-link">
              返回设备监控
            </Link>
          </div>
        </div>
      </section>

      <section className="dashboard-grid dashboard-grid-uneven platform-main-grid">
        <section className="panel panel-emphasis">
          <div className="panel-header">
            <h2>创建发布内容</h2>
            <span className="panel-kicker">支持本地草稿和直写 S3</span>
          </div>
          <OtaPublisher defaultEnvironment={state.selectedEnvironment.key} defaultDeviceId={state.selectedDeviceId || ""} />
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>OTA 桶状态</h2>
            <span className="panel-kicker">{otaBuckets.length} 个桶</span>
          </div>
          <div className="bucket-status-stack">
            {otaBuckets.map((bucket) => (
              <article key={bucket.bucket} className="bucket-card">
                <div className="bucket-card-header">
                  <div>
                    <strong>{bucket.bucket}</strong>
                    <p>{bucket.region}</p>
                  </div>
                  <span className={`signal-pill ${bucket.accessible ? "signal-pill-live" : "signal-pill-danger"}`}>
                    {formatBucketAccess(bucket.accessible)}
                  </span>
                </div>
                <div className="prefix-chip-grid">
                  {bucket.prefixes.map((prefix) => (
                    <article key={`${bucket.bucket}-${prefix.prefix}`} className={`prefix-chip prefix-chip-${prefix.status}`}>
                      <span>{prefix.prefix}</span>
                      <strong>{formatPrefixStatus(prefix.status)}</strong>
                      <em>{prefix.sampleKey || prefix.message || "暂无样例对象"}</em>
                    </article>
                  ))}
                </div>
              </article>
            ))}
            {otaBuckets.length === 0 ? <div className="empty-state">当前环境没有配置 OTA 桶。</div> : null}
          </div>
        </section>
      </section>

      <section className="dashboard-grid dashboard-grid-uneven platform-main-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>本地草稿箱</h2>
            <span className="panel-kicker">{drafts.length} 条最近记录</span>
          </div>
          <div className="payload-stack">
            {drafts.map((draft) => (
              <article key={draft.id} className="payload-card">
                <div className="device-card-topline">
                  <span className="device-type">{draft.transport === "s3-publish" ? "S3 发布请求" : "本地草稿"}</span>
                  <span className="signal-pill signal-pill-neutral">{draft.module}</span>
                </div>
                <strong>{draft.version}</strong>
                <div className="payload-meta-row">
                  <span>{draft.environment}</span>
                  <span>{draft.deviceId || "整批设备"}</span>
                  <span>{formatDateTime(Date.parse(draft.createdAt))}</span>
                </div>
                <p className="payload-source">{draft.filePath}</p>
                <pre className="payload-snippet">{JSON.stringify(draft.payload, null, 2)}</pre>
              </article>
            ))}
            {drafts.length === 0 ? <div className="empty-state">还没有 OTA 草稿，先在上方表单创建一条。</div> : null}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>在线 OTA 资源</h2>
            <span className="panel-kicker">{state.otaArtifacts.length} 个对象</span>
          </div>
          <div className="ota-grid">
            {state.otaArtifacts.map((artifact) => (
              <article key={`${artifact.kind}-${artifact.module}-${artifact.key}`} className="ota-card">
                <div className="device-card-topline">
                  <span className="device-type">{artifact.kind === "binary" ? "固件" : "清单"}</span>
                  <span className="signal-pill signal-pill-neutral">{artifact.module}</span>
                </div>
                <strong>{artifact.version}</strong>
                <div className="device-meta-stack">
                  <span>{artifact.bucket}</span>
                  <span>{artifact.key}</span>
                  <span>更新时间：{formatDateTime(artifact.lastModified)}</span>
                </div>
                {artifact.url ? (
                  <a href={artifact.url} target="_blank" rel="noreferrer" className="button-secondary button-link">
                    打开资源
                  </a>
                ) : (
                  <div className="device-readonly">当前权限下无法生成访问链接。</div>
                )}
              </article>
            ))}
            {state.otaArtifacts.length === 0 ? <div className="empty-state">当前没有可展示的 OTA 资源。</div> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
