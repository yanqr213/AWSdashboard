import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getDashboardDetailState, getDashboardHistoryState, getDashboardState } from "@/lib/iot-platform";

function parseHours(value: string | null) {
  if (value === null || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function escapeCsv(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[",\r\n]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(headers: string[], rows: Array<Record<string, unknown>>) {
  const lines = [
    headers.map((header) => escapeCsv(header)).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(",")),
  ];

  return lines.join("\r\n");
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "未登录。" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const dataset = searchParams.get("dataset") || "current";
  const format = searchParams.get("format") || (dataset === "snapshot" ? "json" : "csv");
  const query = {
    environment: searchParams.get("environment") || undefined,
    deviceId: searchParams.get("deviceId") || undefined,
    metricId: searchParams.get("metricId") || undefined,
    deviceSearch: searchParams.get("deviceSearch") || undefined,
    fieldSearch: searchParams.get("fieldSearch") || undefined,
    startAt: searchParams.get("startAt") || undefined,
    endAt: searchParams.get("endAt") || undefined,
    hours: parseHours(searchParams.get("hours")),
  };
  const fullState = format === "json" || dataset === "objects" || dataset === "payloads" ? await getDashboardState(query) : null;
  const detailState = dataset === "current" ? await getDashboardDetailState(query) : null;
  const historyState = dataset === "history" ? await getDashboardHistoryState(query) : null;
  const selectedEnvironment = fullState?.selectedEnvironment || detailState?.selectedEnvironment || historyState?.selectedEnvironment;
  const selectedDeviceId = fullState?.selectedDeviceId || detailState?.selectedDeviceId || historyState?.selectedDeviceId;
  const selectedMetricId = fullState?.selectedMetricId || detailState?.selectedMetricId || historyState?.selectedMetricId;
  const historyWindowHours = fullState?.historyWindowHours || detailState?.historyWindowHours || query.hours || 24;

  if (!selectedEnvironment) {
    return NextResponse.json({ ok: false, error: "无法生成导出数据。" }, { status: 400 });
  }

  const filenameBase = `tb-iot-${selectedEnvironment.key}-${selectedDeviceId || "fleet"}-${dataset}`;

  if (format === "json") {
    const snapshot = {
      dataset,
      exportedAt: new Date().toISOString(),
      filters: {
        environment: fullState?.selectedEnvironment.key,
        deviceId: fullState?.selectedDeviceId,
        metricId: fullState?.selectedMetricId,
        deviceSearch: fullState?.deviceSearch,
        fieldSearch: fullState?.fieldSearch,
        startAt: fullState?.startAt,
        endAt: fullState?.endAt,
        hours: fullState?.historyWindowHours,
      },
      currentValues: fullState?.currentValues || [],
      decodedFaults: fullState?.decodedFaults || [],
      historySeries: fullState?.historySeries || [],
      recentObjects: fullState?.recentObjects || [],
      payloadPreviews: fullState?.payloadPreviews || [],
      otaArtifacts: fullState?.otaArtifacts || [],
    };

    return new NextResponse(JSON.stringify(snapshot, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${filenameBase}.json"`,
      },
    });
  }

  const datasetRows =
    dataset === "history"
      ? (historyState?.rawHistorySeries || historyState?.historySeries || []).map((point) => ({
          timestamp: new Date(point.timestamp).toISOString(),
          value: point.value,
          metricId: selectedMetricId,
        }))
      : dataset === "objects"
        ? (fullState?.recentObjects || []).map((object) => ({
            bucket: object.bucket,
            key: object.key,
            classification: object.classification,
            deviceId: object.deviceId,
            size: object.size,
            lastModified: object.lastModified ? new Date(object.lastModified).toISOString() : "",
            url: object.url,
          }))
        : dataset === "payloads"
          ? (fullState?.payloadPreviews || []).map((preview) => ({
              bucket: preview.bucket,
              key: preview.key,
              deviceId: preview.deviceId,
              timestamp: preview.timestamp ? new Date(preview.timestamp).toISOString() : "",
              source: preview.source,
              classification: preview.classification,
              fieldCount: preview.fieldCount,
              metricCount: preview.metricCount,
              snippet: preview.snippet,
            }))
          : (detailState?.currentValues || []).map((value) => ({
              identifier: value.identifier,
              label: value.label,
              module: value.module,
              access: value.access,
              dataType: value.dataType,
              unit: value.unit,
              value: value.value,
              rawValue: value.rawValue,
              timestamp: value.timestamp ? new Date(value.timestamp).toISOString() : "",
              sourceKey: value.sourceKey,
            }));

  const headers = datasetRows.length ? Object.keys(datasetRows[0]) : ["empty"];
  const body = datasetRows.length ? toCsv(headers, datasetRows) : "empty\r\n";

  return new NextResponse(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filenameBase}.csv"`,
    },
  });
}
