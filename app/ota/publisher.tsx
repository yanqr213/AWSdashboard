"use client";

import { useState, useTransition, type FormEvent } from "react";

type OtaPublisherProps = {
  defaultEnvironment: string;
  defaultDeviceId: string;
};

type PublishResult = {
  ok: boolean;
  mode?: string;
  message?: string;
  error?: string;
  bucket?: string;
  manifestKey?: string;
  notifyKey?: string;
  draft?: {
    filePath?: string;
    fileName?: string;
  };
  payload?: {
    manifest: Record<string, unknown>;
    notify: Record<string, unknown>;
  };
};

export function OtaPublisher({ defaultEnvironment, defaultDeviceId }: OtaPublisherProps) {
  const [result, setResult] = useState<PublishResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const formData = new FormData(form);
    const transport = submitter?.value === "s3-publish" ? "s3-publish" : "local-draft";

    startTransition(async () => {
      try {
        const response = await fetch("/api/ota/publish", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            environment: formData.get("environment"),
            deviceId: formData.get("deviceId"),
            module: formData.get("module"),
            version: formData.get("version"),
            firmwareUrl: formData.get("firmwareUrl"),
            title: formData.get("title"),
            releaseNotes: formData.get("releaseNotes"),
            notifyKey: formData.get("notifyKey"),
            manifestKey: formData.get("manifestKey"),
            rolloutPercent: Number(formData.get("rolloutPercent") || 100),
            forceUpdate: formData.get("forceUpdate") === "on",
            transport,
          }),
        });

        const data = (await response.json()) as PublishResult;
        setResult(data);
      } catch (error) {
        setResult({
          ok: false,
          error: error instanceof Error ? error.message : "提交 OTA 请求失败。",
        });
      }
    });
  }

  return (
    <form className="ota-publisher-form" onSubmit={handleSubmit}>
      <div className="field-grid">
        <label className="field-shell">
          <span>环境</span>
          <select name="environment" defaultValue={defaultEnvironment} className="family-select">
            <option value="hk-test">香港测试</option>
            <option value="de-prod">法兰克福正式</option>
          </select>
        </label>
        <label className="field-shell">
          <span>目标设备</span>
          <input
            type="text"
            name="deviceId"
            defaultValue={defaultDeviceId}
            className="power-input"
            placeholder="TB90e5b1cd3af4，留空表示整批设备"
          />
        </label>
        <label className="field-shell">
          <span>模块</span>
          <select name="module" defaultValue="ems" className="family-select">
            <option value="ems">EMS</option>
            <option value="ac">AC</option>
            <option value="dc">DC</option>
            <option value="bms">BMS</option>
            <option value="misc">其他</option>
          </select>
        </label>
        <label className="field-shell">
          <span>版本号</span>
          <input type="text" name="version" className="power-input" placeholder="TP-Sunlit-24-EMS_V1.1.1.bin" />
        </label>
      </div>

      <label className="field-shell">
        <span>固件 URL</span>
        <input type="url" name="firmwareUrl" className="power-input" placeholder="https://..." />
      </label>

      <div className="field-grid">
        <label className="field-shell">
          <span>发布标题</span>
          <input type="text" name="title" className="power-input" placeholder="春季 OTA 批次" />
        </label>
        <label className="field-shell">
          <span>灰度比例</span>
          <input type="number" min="1" max="100" name="rolloutPercent" defaultValue="100" className="power-input" />
        </label>
      </div>

      <label className="field-shell">
        <span>发布说明</span>
        <textarea name="releaseNotes" className="credential-input ota-notes-input" placeholder="填写本次 OTA 更新说明。" />
      </label>

      <div className="field-grid">
        <label className="field-shell">
          <span>Manifest Key 覆盖</span>
          <input type="text" name="manifestKey" className="power-input" placeholder="TBxxxx_20260317093000.json" />
        </label>
        <label className="field-shell">
          <span>Notify Key 覆盖</span>
          <input type="text" name="notifyKey" className="power-input" placeholder="notify/TBxxxx_20260317093000.json" />
        </label>
      </div>

      <label className="automation-checkbox">
        <span>强制升级标记</span>
        <input type="checkbox" name="forceUpdate" />
      </label>

      <div className="ota-action-row">
        <button type="submit" value="local-draft" className="button-secondary" disabled={isPending}>
          {isPending ? "处理中..." : "生成本地草稿"}
        </button>
        <button type="submit" value="s3-publish" className="button-primary" disabled={isPending}>
          {isPending ? "处理中..." : "发布到 S3"}
        </button>
      </div>

      {result ? (
        <article className={`ota-result-card ${result.ok ? "ota-result-card-success" : "ota-result-card-error"}`}>
          <strong>{result.ok ? "OTA 内容已生成" : "OTA 请求失败"}</strong>
          <p>{result.ok ? result.message : result.error}</p>
          {result.bucket ? <p>目标桶：{result.bucket}</p> : null}
          {result.manifestKey ? <p>Manifest：{result.manifestKey}</p> : null}
          {result.notifyKey ? <p>Notify：{result.notifyKey}</p> : null}
          {result.draft?.filePath ? <p>草稿文件：{result.draft.filePath}</p> : null}
          {result.payload ? <pre className="payload-snippet">{JSON.stringify(result.payload, null, 2)}</pre> : null}
        </article>
      ) : null}
    </form>
  );
}
