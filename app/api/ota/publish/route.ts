import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getEnvironmentDefinitions } from "@/lib/iot-platform";
import { saveLocalOtaDraft } from "@/lib/local-ota-store";

type PublishRequestBody = {
  environment?: string;
  transport?: "local-draft" | "s3-publish";
  deviceId?: string;
  module?: string;
  version?: string;
  firmwareUrl?: string;
  title?: string;
  releaseNotes?: string;
  notifyKey?: string;
  manifestKey?: string;
  rolloutPercent?: number;
  forceUpdate?: boolean;
};

function hasAwsCredentials() {
  return Boolean(process.env.AWS_ACCESS_KEY_ID?.trim() && process.env.AWS_SECRET_ACCESS_KEY?.trim());
}

function getS3Client(region: string) {
  return new S3Client({
    region,
    credentials: hasAwsCredentials()
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!.trim(),
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!.trim(),
          sessionToken: process.env.AWS_SESSION_TOKEN?.trim(),
        }
      : undefined,
  });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "未登录。" }, { status: 401 });
  }

  let draft: Awaited<ReturnType<typeof saveLocalOtaDraft>> | null = null;

  try {
    const body = (await request.json()) as PublishRequestBody;
    const environments = getEnvironmentDefinitions();
    const environment = environments.find((item) => item.key === body.environment) || environments[0];
    const transport = body.transport || "local-draft";
    const deviceId = body.deviceId?.trim() || null;
    const module = body.module?.trim() || "ems";
    const version = body.version?.trim() || "";
    const firmwareUrl = body.firmwareUrl?.trim() || "";
    const title = body.title?.trim() || `${module.toUpperCase()} OTA 发布`;
    const releaseNotes = body.releaseNotes?.trim() || "";
    const rolloutPercent = Number.isFinite(Number(body.rolloutPercent)) ? Number(body.rolloutPercent) : 100;
    const forceUpdate = Boolean(body.forceUpdate);

    if (!version || !firmwareUrl) {
      return NextResponse.json(
        {
          ok: false,
          error: "生成 OTA 内容前，必须填写版本号和固件 URL。",
        },
        { status: 400 },
      );
    }

    const timestamp = new Date();
    const isoTimestamp = timestamp.toISOString();
    const compactTimestamp = isoTimestamp.replace(/[-:TZ.]/g, "").slice(0, 14);
    const targetLabel = deviceId || "fleet";
    const manifestKey = body.manifestKey?.trim() || `${targetLabel}_${compactTimestamp}.json`;
    const notifyKey = body.notifyKey?.trim() || `notify/${targetLabel}_${compactTimestamp}.json`;
    const manifestPayload = {
      generatedAt: isoTimestamp,
      environment: environment.key,
      region: environment.region,
      target: {
        deviceId,
      },
      release: {
        title,
        releaseNotes,
        rolloutPercent,
        forceUpdate,
      },
      modules: [
        {
          module,
          version,
          url: firmwareUrl,
        },
      ],
    };
    const notifyPayload = {
      generatedAt: isoTimestamp,
      source: "tb-iot-local-ops",
      environment: environment.key,
      action: "ota-notify",
      target: {
        deviceId,
      },
      manifestKey,
      module,
      version,
      title,
      releaseNotes,
      rolloutPercent,
      forceUpdate,
    };

    draft = await saveLocalOtaDraft({
      id: `${environment.key}-${targetLabel}-${compactTimestamp}`,
      createdAt: isoTimestamp,
      environment: environment.key,
      transport,
      deviceId,
      module,
      version,
      title,
      notifyKey,
      manifestKey,
      payload: {
        manifest: manifestPayload,
        notify: notifyPayload,
      },
    });

    if (transport === "s3-publish") {
      if (!hasAwsCredentials()) {
        return NextResponse.json(
          {
            ok: false,
            error: "当前没有可用的 AWS 程序化凭证，暂时不能直接写入 S3。",
            draft,
          },
          { status: 400 },
        );
      }

      const otaBucket = environment.buckets.find((bucket) => /ota/i.test(bucket)) || environment.buckets[0];
      const client = getS3Client(environment.region);

      try {
        await client.send(
          new PutObjectCommand({
            Bucket: otaBucket,
            Key: manifestKey,
            Body: JSON.stringify(manifestPayload, null, 2),
            ContentType: "application/json",
          }),
        );

        await client.send(
          new PutObjectCommand({
            Bucket: otaBucket,
            Key: notifyKey,
            Body: JSON.stringify(notifyPayload, null, 2),
            ContentType: "application/json",
          }),
        );
      } catch (error) {
        return NextResponse.json(
          {
            ok: false,
            error: error instanceof Error ? error.message : "写入 S3 失败。",
            draft,
            payload: {
              manifest: manifestPayload,
              notify: notifyPayload,
            },
          },
          { status: 500 },
        );
      }

      return NextResponse.json({
        ok: true,
        mode: "s3-publish",
        message: `Manifest 和 Notify 已写入 ${otaBucket}。`,
        bucket: otaBucket,
        manifestKey,
        notifyKey,
        draft,
        payload: {
          manifest: manifestPayload,
          notify: notifyPayload,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      mode: "local-draft",
      message: "OTA 草稿已写入本地草稿箱。",
      manifestKey,
      notifyKey,
      draft,
      payload: {
        manifest: manifestPayload,
        notify: notifyPayload,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "创建 OTA 内容失败。",
        draft,
      },
      { status: 500 },
    );
  }
}
