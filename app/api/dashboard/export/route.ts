import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getDashboardState } from "@/lib/iot-platform";

function parseHours(value: string | null) {
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
  const state = await getDashboardState({
    environment: searchParams.get("environment") || undefined,
    deviceId: searchParams.get("deviceId") || undefined,
    metricId: searchParams.get("metricId") || undefined,
    deviceSearch: searchParams.get("deviceSearch") || undefined,
    fieldSearch: searchParams.get("fieldSearch") || undefined,
    startAt: searchParams.get("startAt") || undefined,
    endAt: searchParams.get("endAt") || undefined,
    hours: parseHours(searchParams.get("hours")),
  });

  const filenameBase = `tb-iot-${state.selectedEnvironment.key}-${state.selectedDeviceId || "fleet"}-${dataset}`;

  if (format === "json") {
    const snapshot = {
      dataset,
      exportedAt: new Date().toISOString(),
      filters: {
        environment: state.selectedEnvironment.key,
        deviceId: state.selectedDeviceId,
        metricId: state.selectedMetricId,
        deviceSearch: state.deviceSearch,
        fieldSearch: state.fieldSearch,
        startAt: state.startAt,
        endAt: state.endAt,
        hours: state.historyWindowHours,
      },
      currentValues: state.currentValues,
      historySeries: state.historySeries,
      recentObjects: state.recentObjects,
      payloadPreviews: state.payloadPreviews,
      otaArtifacts: state.otaArtifacts,
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
      ? state.historySeries.map((point) => ({
          timestamp: new Date(point.timestamp).toISOString(),
          value: point.value,
          metricId: state.selectedMetricId,
        }))
      : dataset === "objects"
        ? state.recentObjects.map((object) => ({
            bucket: object.bucket,
            key: object.key,
            classification: object.classification,
            deviceId: object.deviceId,
            size: object.size,
            lastModified: object.lastModified ? new Date(object.lastModified).toISOString() : "",
            url: object.url,
          }))
        : dataset === "payloads"
          ? state.payloadPreviews.map((preview) => ({
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
          : state.currentValues.map((value) => ({
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
