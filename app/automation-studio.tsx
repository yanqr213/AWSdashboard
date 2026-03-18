"use client";

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";

import {
  compareValue,
  formatWindow,
  templateDefinitions,
  templateMap,
  translations,
  weatherLabel,
  type AutomationContextPayload,
  type AutomationEvent,
  type AutomationNodeData,
  type EvaluationResult,
  type Language,
  type TemplateKey,
} from "@/lib/automation-studio";

const CONTEXT_REFRESH_MS = 15_000;
const MAX_EVENTS = 12;
const LANGUAGE_STORAGE_KEY = "sunlit-automation-language";
const PLANT_PROFILE_PREFIX = "sunlit-automation-plant-profile";
const SOLAR_HISTORY_PREFIX = "sunlit-automation-solar-history";

type AutomationFlowNode = Node<AutomationNodeData, "automation">;

type PlantProfile = {
  latitude: string;
  longitude: string;
  declination: string;
  azimuth: string;
  kwp: string;
  manualFactor: string;
  learningEnabled: boolean;
};

type SolarLearningEntry = {
  slotKey: string;
  forecastW: number;
  actualW: number;
  ratio: number;
  timestamp: number;
};

type StoredFlow = {
  nodes: Array<{
    id: string;
    template: TemplateKey;
    position: { x: number; y: number };
    config: Record<string, string | number | null>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
  }>;
};

function flowStorageKey(familyId: number) {
  return `sunlit-automation-flow-${familyId}`;
}

function plantProfileStorageKey(familyId: number) {
  return `${PLANT_PROFILE_PREFIX}-${familyId}`;
}

function solarHistoryStorageKey(familyId: number) {
  return `${SOLAR_HISTORY_PREFIX}-${familyId}`;
}

function defaultPlantProfile(): PlantProfile {
  return {
    latitude: "",
    longitude: "",
    declination: "35",
    azimuth: "0",
    kwp: "5",
    manualFactor: "1.00",
    learningEnabled: true,
  };
}

function createNode(templateKey: TemplateKey, language: Language, id: string, position: { x: number; y: number }) {
  const template = templateMap.get(templateKey)!;

  return {
    id,
    type: "automation",
    position,
    data: {
      template: template.key,
      language,
      title: template.title[language],
      description: template.description[language],
      metric: "",
      ready: false,
      config: { ...template.defaultConfig },
    },
  } satisfies AutomationFlowNode;
}

function translateNodes(nodes: AutomationFlowNode[], language: Language) {
  return nodes.map((node) => {
    const template = templateMap.get(node.data.template)!;

    return {
      ...node,
      data: {
        ...node.data,
        language,
        title: template.title[language],
        description: template.description[language],
      },
    };
  });
}

function makeEdge(connection: Connection | { source: string; target: string; id?: string }) {
  const edgeId = "id" in connection && connection.id ? connection.id : `${connection.source}-${connection.target}-${Date.now().toString(36)}`;

  return {
    id: edgeId,
    source: connection.source,
    target: connection.target,
    sourceHandle: "sourceHandle" in connection ? connection.sourceHandle ?? null : null,
    targetHandle: "targetHandle" in connection ? connection.targetHandle ?? null : null,
    animated: true,
    type: "smoothstep",
  } satisfies Edge;
}

function parseNullableNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPlantProfileReady(profile: PlantProfile) {
  return (
    parseNullableNumber(profile.latitude) !== null &&
    parseNullableNumber(profile.longitude) !== null &&
    parseNullableNumber(profile.declination) !== null &&
    parseNullableNumber(profile.azimuth) !== null &&
    parseNullableNumber(profile.kwp) !== null
  );
}

function readStoredPlantProfile(familyId: number) {
  if (typeof window === "undefined") {
    return defaultPlantProfile();
  }

  try {
    const raw = window.localStorage.getItem(plantProfileStorageKey(familyId));

    if (!raw) {
      return defaultPlantProfile();
    }

    return {
      ...defaultPlantProfile(),
      ...(JSON.parse(raw) as Partial<PlantProfile>),
    };
  } catch {
    return defaultPlantProfile();
  }
}

function writeStoredPlantProfile(familyId: number, profile: PlantProfile) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(plantProfileStorageKey(familyId), JSON.stringify(profile));
}

function readSolarLearningHistory(familyId: number) {
  if (typeof window === "undefined") {
    return [] as SolarLearningEntry[];
  }

  try {
    const raw = window.localStorage.getItem(solarHistoryStorageKey(familyId));

    if (!raw) {
      return [] as SolarLearningEntry[];
    }

    const parsed = JSON.parse(raw) as SolarLearningEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [] as SolarLearningEntry[];
  }
}

function writeSolarLearningHistory(familyId: number, entries: SolarLearningEntry[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(solarHistoryStorageKey(familyId), JSON.stringify(entries));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function calculateLearnedFactor(entries: SolarLearningEntry[]) {
  if (entries.length < 4) {
    return null;
  }

  const ratios = entries
    .map((entry) => entry.ratio)
    .filter((ratio) => Number.isFinite(ratio))
    .sort((left, right) => left - right);

  if (ratios.length < 4) {
    return null;
  }

  const trimCount = Math.floor(ratios.length * 0.15);
  const trimmed = ratios.slice(trimCount, ratios.length - trimCount || ratios.length);
  const base = trimmed.length > 0 ? trimmed : ratios;
  const average = base.reduce((sum, value) => sum + value, 0) / base.length;

  return clamp(Number(average.toFixed(3)), 0.35, 1.2);
}

function initialFlow(language: Language) {
  const nodes: AutomationFlowNode[] = [
    createNode("time-window", language, "time-1", { x: 60, y: 90 }),
    createNode("price-threshold", language, "price-1", { x: 60, y: 250 }),
    createNode("logic-and", language, "logic-1", { x: 420, y: 220 }),
    createNode("inverter-limit", language, "limit-1", { x: 780, y: 220 }),
  ];

  const edges: Edge[] = [
    makeEdge({ id: "time-to-logic", source: "time-1", target: "logic-1" }),
    makeEdge({ id: "price-to-logic", source: "price-1", target: "logic-1" }),
    makeEdge({ id: "logic-to-limit", source: "logic-1", target: "limit-1" }),
  ];

  return { nodes, edges };
}

function readStoredFlow(familyId: number, language: Language) {
  if (typeof window === "undefined") {
    return initialFlow(language);
  }

  try {
    const raw = window.localStorage.getItem(flowStorageKey(familyId));

    if (!raw) {
      return initialFlow(language);
    }

    const parsed = JSON.parse(raw) as StoredFlow;

    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return initialFlow(language);
    }

    const nodes = parsed.nodes
      .filter((item) => item && typeof item.id === "string" && templateMap.has(item.template))
      .map((item) => {
        const node = createNode(item.template, language, item.id, item.position);

        return {
          ...node,
          position: item.position,
          data: {
            ...node.data,
            config: {
              ...node.data.config,
              ...item.config,
            },
            metric: "",
            ready: false,
          },
        } satisfies AutomationFlowNode;
      });

    const edges = parsed.edges
      .filter((item) => item && typeof item.source === "string" && typeof item.target === "string")
      .map((item) => makeEdge(item));

    return {
      nodes: nodes.length > 0 ? nodes : initialFlow(language).nodes,
      edges,
    };
  } catch {
    return initialFlow(language);
  }
}

function writeStoredFlow(familyId: number, nodes: AutomationFlowNode[], edges: Edge[]) {
  if (typeof window === "undefined") {
    return;
  }

  const payload: StoredFlow = {
    nodes: nodes.map((node) => ({
      id: node.id,
      template: node.data.template,
      position: node.position,
      config: node.data.config,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    })),
  };

  window.localStorage.setItem(flowStorageKey(familyId), JSON.stringify(payload));
}

function automationNodeColor(node: Node) {
  if (node.type !== "automation") {
    return "#9bb2c8";
  }

  const data = node.data as AutomationNodeData;
  const template = templateMap.get(data.template);

  if (!template) {
    return "#9bb2c8";
  }

  if (template.kind === "trigger") {
    return "#1b7f6b";
  }

  if (template.kind === "condition") {
    return "#0f5f9a";
  }

  return "#c56b1f";
}

function formatEventTime(time: number, language: Language) {
  const locale = language === "cn" ? "zh-CN" : language === "de" ? "de-DE" : "en-GB";

  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(time));
}

function formatMetricValue(value: number | null | undefined, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }

  return `${Number(value.toFixed(2))}${suffix}`;
}

function makeEventId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function inferBrand(device: { type: string | null; label: string }) {
  if (device.type === "YUNENG_MICRO_INVERTER") {
    return "Yuneng";
  }

  if (device.type === "SOLAR_MICRO_INVERTER") {
    return "Solar";
  }

  return device.label.split(" ")[0] || "Sunlit";
}

function recommendedLimitWatts(device: { type: string | null }) {
  if (device.type === "YUNENG_MICRO_INVERTER") {
    return 600;
  }

  if (device.type?.includes("MICRO_INVERTER")) {
    return 800;
  }

  return 1000;
}

function buildStarterFlows({
  language,
  context,
  includeForecast,
}: {
  language: Language;
  context: AutomationContextPayload;
  includeForecast: boolean;
}) {
  const controllableDevices = context.sunlit?.devices.filter((device) => device.controllable) || [];
  const hasBattery = Boolean(context.sunlit?.batteryLevel !== null && context.sunlit?.batteryLevel !== undefined);
  const nodes: AutomationFlowNode[] = [];
  const edges: Edge[] = [];
  let counter = 0;
  const nextId = (key: TemplateKey) => `generated-${key}-${Date.now().toString(36)}-${counter++}`;
  const addNode = (
    key: TemplateKey,
    position: { x: number; y: number },
    config: Record<string, string | number | null> = {},
  ) => {
    const node = createNode(key, language, nextId(key), position);
    node.data.config = { ...node.data.config, ...config };
    nodes.push(node);
    return node;
  };

  controllableDevices.forEach((device, index) => {
    const x = 60 + index * 700;
    const safeLimit = recommendedLimitWatts(device);
    const brand = inferBrand(device);
    const warning = addNode("warning-level", { x, y: 80 }, { warningLevel: 3 });
    const negativePrice = addNode("price-threshold", { x, y: 240 }, { comparator: "<=", threshold: 0 });
    const logicOr = addNode("logic-or", { x: x + 340, y: 160 });
    const limit = addNode("inverter-limit", { x: x + 660, y: 160 }, {
      targetDeviceId: device.id,
      limitWatts: safeLimit,
    });

    edges.push(makeEdge({ source: warning.id, target: logicOr.id }));
    edges.push(makeEdge({ source: negativePrice.id, target: logicOr.id }));
    edges.push(makeEdge({ source: logicOr.id, target: limit.id }));

    if (includeForecast) {
      const forecast = addNode("solar-forecast", { x, y: 420 }, {
        dayOffset: 1,
        forecastHour: 13,
        comparator: ">=",
        threshold: Math.max(1200, safeLimit * 2),
      });
      const note = addNode("dashboard-note", { x: x + 660, y: 420 }, {
        message: `${brand} ${device.label}: high PV expected tomorrow, review floating-price strategy`,
      });

      edges.push(makeEdge({ source: forecast.id, target: note.id }));
    }
  });

  if (hasBattery) {
    const x = 60;
    const battery = addNode("battery-soc", { x, y: 720 }, { comparator: "<=", threshold: 25 });
    const cheapPrice = addNode("price-threshold", { x, y: 880 }, { comparator: "<=", threshold: 3.5 });
    const logicAnd = addNode("logic-and", { x: x + 340, y: 800 });
    const note = addNode("dashboard-note", { x: x + 660, y: 800 }, {
      message: `${context.sunlit?.familyName || "Current family"} battery is low during a cheap-price window`,
    });

    edges.push(makeEdge({ source: battery.id, target: logicAnd.id }));
    edges.push(makeEdge({ source: cheapPrice.id, target: logicAnd.id }));
    edges.push(makeEdge({ source: logicAnd.id, target: note.id }));
  }

  return { nodes, edges };
}

function AutomationNode({ data, selected }: NodeProps<AutomationFlowNode>) {
  const template = templateMap.get(data.template)!;

  return (
    <div
      className={[
        "automation-node",
        `automation-node-${template.kind}`,
        data.ready ? "automation-node-ready" : "",
        selected ? "automation-node-selected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Handle type="target" position={Position.Left} className="automation-handle" />
      <div className="automation-node-topline">
        <span className="automation-node-kind">{template.kind}</span>
        <span className="automation-node-state">
          {data.ready ? translations[data.language].flowReady : translations[data.language].flowIdle}
        </span>
      </div>
      <strong>{data.title}</strong>
      <p>{data.description}</p>
      <div className="automation-node-metric">{data.metric || data.description}</div>
      <div className="automation-node-status">
        {data.ready ? translations[data.language].triggerReady : translations[data.language].triggerIdle}
      </div>
      <Handle type="source" position={Position.Right} className="automation-handle" />
    </div>
  );
}

function StudioCanvas({
  language,
  familyId,
}: {
  language: Language;
  familyId: number;
}) {
  const t = translations[language];
  const [nodes, setNodes, onNodesChange] = useNodesState<AutomationFlowNode>(initialFlow(language).nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialFlow(language).edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [context, setContext] = useState<AutomationContextPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [events, setEvents] = useState<AutomationEvent[]>([]);
  const [plantProfile, setPlantProfile] = useState<PlantProfile>(defaultPlantProfile());
  const [profileFamilyId, setProfileFamilyId] = useState<number | null>(null);
  const [learnedFactor, setLearnedFactor] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const previousReadyRef = useRef<Record<string, boolean>>({});
  const shellRef = useRef<HTMLDivElement | null>(null);
  const reactFlow = useReactFlow();

  const fetchContext = useCallback(async () => {
    setLoadError(null);
    const params = new URLSearchParams();
    params.set("familyId", String(familyId));

    if (isPlantProfileReady(plantProfile)) {
      params.set("latitude", plantProfile.latitude);
      params.set("longitude", plantProfile.longitude);
      params.set("declination", plantProfile.declination);
      params.set("azimuth", plantProfile.azimuth);
      params.set("kwp", plantProfile.kwp);
    }

    const response = await fetch(`/api/automation/context?${params.toString()}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`context_${response.status}`);
    }

    const payload = (await response.json()) as AutomationContextPayload;
    setContext(payload);
    setLoading(false);
  }, [familyId, plantProfile]);

  const pushEvent = useCallback((status: AutomationEvent["status"], message: string) => {
    setEvents((current) =>
      [{ id: makeEventId(), status, message, time: Date.now() }, ...current].slice(0, MAX_EVENTS),
    );
  }, []);

  useEffect(() => {
    const stored = readStoredFlow(familyId, language);
    setNodes(stored.nodes);
    setEdges(stored.edges);
    setSelectedNodeId(stored.nodes[0]?.id ?? null);
    setSelectedEdgeId(null);
    setArmed(false);
    previousReadyRef.current = {};
    const storedProfile = readStoredPlantProfile(familyId);
    setPlantProfile(storedProfile);
    setLearnedFactor(calculateLearnedFactor(readSolarLearningHistory(familyId)));
    setProfileFamilyId(familyId);
  }, [familyId, setEdges, setNodes]);

  useEffect(() => {
    setNodes((currentNodes) => translateNodes(currentNodes, language));
  }, [language, setNodes]);

  useEffect(() => {
    writeStoredFlow(familyId, nodes, edges);
  }, [edges, familyId, nodes]);

  useEffect(() => {
    if (selectedEdgeId && !edges.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
    }
  }, [edges, selectedEdgeId]);

  useEffect(() => {
    if (profileFamilyId !== familyId) {
      return;
    }

    writeStoredPlantProfile(familyId, plantProfile);
  }, [familyId, plantProfile, profileFamilyId]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        await fetchContext();
      } catch (error) {
        if (!active) {
          return;
        }

        setLoading(false);
        setLoadError(error instanceof Error ? error.message : "context_error");
      }
    };

    void load();

    const timer = window.setInterval(() => {
      void load();
    }, CONTEXT_REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [fetchContext]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const currentProfileReady = isPlantProfileReady(plantProfile);
  const manualFactor = parseNullableNumber(plantProfile.manualFactor) ?? 1;
  const effectiveFactor = clamp(manualFactor * (plantProfile.learningEnabled ? learnedFactor ?? 1 : 1), 0.2, 1.3);

  const adjustedSolarForecast = useMemo(() => {
    if (!context?.solarForecast) {
      return null;
    }

    const hourly = context.solarForecast.hourly.map((point) => ({
      ...point,
      adjustedWatts: Math.round(point.watts * effectiveFactor),
    }));
    const today = hourly.filter((point) => point.dayOffset === 0);
    const tomorrow = hourly.filter((point) => point.dayOffset === 1);
    const peak = tomorrow.reduce<(typeof tomorrow)[number] | null>(
      (best, current) => (!best || current.adjustedWatts > best.adjustedWatts ? current : best),
      null,
    );

    return {
      ...context.solarForecast,
      effectiveFactor,
      learnedFactor,
      manualFactor,
      hourly,
      todayTotalWh: today.length > 0 ? today.reduce((sum, point) => sum + point.adjustedWatts, 0) : null,
      tomorrowTotalWh: tomorrow.length > 0 ? tomorrow.reduce((sum, point) => sum + point.adjustedWatts, 0) : null,
      tomorrowPeakW: peak?.adjustedWatts ?? null,
      tomorrowPeakHour: peak?.localTime ?? null,
    };
  }, [context?.solarForecast, effectiveFactor, learnedFactor, manualFactor]);

  useEffect(() => {
    if (!plantProfile.learningEnabled || familyId <= 0) {
      return;
    }

    if (!context?.solarForecast || !context.sunlit?.solarPowerW) {
      return;
    }

    const currentHourSlot = context.solarForecast.hourly.find(
      (point) =>
        point.dayOffset === 0 &&
        point.hour === context.berlinTime.hour &&
        point.watts >= 120 &&
        (context.sunlit?.solarPowerW ?? 0) >= 80,
    );

    if (!currentHourSlot) {
      return;
    }

    const ratio = clamp((context.sunlit.solarPowerW ?? 0) / currentHourSlot.watts, 0.2, 1.2);
    const slotKey = `${currentHourSlot.date}-${currentHourSlot.hour}`;
    const history = readSolarLearningHistory(familyId);
    const nextHistory = [
      {
        slotKey,
        forecastW: currentHourSlot.watts,
        actualW: context.sunlit.solarPowerW ?? 0,
        ratio,
        timestamp: Date.now(),
      },
      ...history.filter((entry) => entry.slotKey !== slotKey),
    ]
      .filter((entry) => entry.timestamp >= Date.now() - 14 * 24 * 60 * 60 * 1000)
      .slice(0, 14 * 24);

    writeSolarLearningHistory(familyId, nextHistory);
    setLearnedFactor(calculateLearnedFactor(nextHistory));
  }, [context, familyId, plantProfile.learningEnabled]);

  const evaluations = useMemo(() => {
    if (!context) {
      return new Map<string, EvaluationResult>();
    }

    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const incomingMap = new Map<string, string[]>();

    for (const edge of edges) {
      const incoming = incomingMap.get(edge.target) || [];
      incoming.push(edge.source);
      incomingMap.set(edge.target, incoming);
    }

    const memo = new Map<string, EvaluationResult>();
    const visiting = new Set<string>();

    const evaluate = (nodeId: string): EvaluationResult => {
      if (memo.has(nodeId)) {
        return memo.get(nodeId)!;
      }

      if (visiting.has(nodeId)) {
        return { ready: false, metric: t.cycleBlocked, detail: t.cycleBlocked };
      }

      visiting.add(nodeId);
      const node = nodeMap.get(nodeId);

      if (!node) {
        visiting.delete(nodeId);
        return { ready: false, metric: t.missingNode, detail: t.missingNode };
      }

      const upstream = (incomingMap.get(nodeId) || []).map((sourceId) => evaluate(sourceId));
      const config = node.data.config;
      const comparator = String(config.comparator || "<=");
      const threshold = Number(config.threshold ?? 0);
      let result: EvaluationResult;

      switch (node.data.template) {
        case "time-window": {
          const startHour = Number(config.startHour ?? 13);
          const endHour = Number(config.endHour ?? 17);
          const currentHour = context.berlinTime.hour;
          const inWindow =
            startHour <= endHour
              ? currentHour >= startHour && currentHour <= endHour
              : currentHour >= startHour || currentHour <= endHour;

          result = {
            ready: inWindow,
            metric: `${context.berlinTime.display} | ${startHour}:00-${endHour}:00`,
            detail: `${currentHour}:00`,
          };
          break;
        }
        case "price-threshold": {
          const currentPrice = context.electricity?.currentCtPerKwh ?? null;
          result = {
            ready: compareValue(currentPrice, comparator, threshold),
            metric:
              currentPrice !== null
                ? `${formatMetricValue(currentPrice, " ct/kWh")} ${comparator} ${threshold}`
                : t.noPriceData,
            detail: context.electricity?.currentWindow
              ? formatWindow(context.electricity.currentWindow.start, context.electricity.currentWindow.end)
              : t.noActiveWindow,
          };
          break;
        }
        case "weather-check": {
          const metricMode = String(config.metricMode || "precipitation");
          const currentValue =
            metricMode === "temperature"
              ? context.weather?.temperatureC ?? null
              : context.weather?.precipitationProbability ?? null;

          result = {
            ready: compareValue(currentValue, comparator, threshold),
            metric:
              currentValue !== null
                ? `${formatMetricValue(currentValue, metricMode === "temperature" ? " C" : "%")} ${comparator} ${threshold}`
                : t.noWeatherData,
            detail: context.weather ? weatherLabel(context.weather.weatherCode, language) : t.noWeatherData,
          };
          break;
        }
        case "warning-level": {
          const minLevel = Number(config.warningLevel ?? 3);
          const currentLevel = context.warnings?.highestBerlin?.level ?? 0;
          result = {
            ready: currentLevel >= minLevel,
            metric: `Berlin L${currentLevel} >= ${minLevel}`,
            detail: context.warnings?.highestBerlin?.event || "No Berlin warning",
          };
          break;
        }
        case "battery-soc": {
          const batteryLevel = context.sunlit?.batteryLevel ?? null;
          result = {
            ready: compareValue(batteryLevel, comparator, threshold),
            metric:
              batteryLevel !== null
                ? `${formatMetricValue(batteryLevel, "%")} ${comparator} ${threshold}`
                : t.noBatteryData,
            detail: context.sunlit?.familyName || t.noSunlit,
          };
          break;
        }
        case "solar-power": {
          const solarPower = context.sunlit?.solarPowerW ?? null;
          result = {
            ready: compareValue(solarPower, comparator, threshold),
            metric:
              solarPower !== null ? `${formatMetricValue(solarPower, "W")} ${comparator} ${threshold}` : t.noSolarData,
            detail: context.sunlit?.strategy || t.noSunlit,
          };
          break;
        }
        case "solar-forecast": {
          const selectedDayOffset = Number(config.dayOffset ?? 1);
          const forecastHour = Number(config.forecastHour ?? 12);
          const forecastPoint =
            adjustedSolarForecast?.hourly.find(
              (point) => point.dayOffset === selectedDayOffset && point.hour === forecastHour,
            ) || null;
          const forecastValue = forecastPoint?.adjustedWatts ?? null;
          const dayLabel = selectedDayOffset === 0 ? t.today : t.tomorrow;

          result = {
            ready: compareValue(forecastValue, comparator, threshold),
            metric:
              forecastValue !== null
                ? `${dayLabel} ${forecastPoint?.localTime || `${forecastHour}:00`} ${forecastValue}W ${comparator} ${threshold}`
                : t.noForecast,
            detail:
              adjustedSolarForecast?.plant.place ||
              adjustedSolarForecast?.plant.timezone ||
              t.forecastSource,
          };
          break;
        }
        case "logic-and": {
          result = {
            ready: upstream.length > 0 && upstream.every((item) => item.ready),
            metric:
              upstream.length > 0
                ? `${upstream.filter((item) => item.ready).length}/${upstream.length} inputs`
                : t.connectTriggers,
            detail: t.allInputs,
          };
          break;
        }
        case "logic-or": {
          result = {
            ready: upstream.length > 0 && upstream.some((item) => item.ready),
            metric:
              upstream.length > 0
                ? `${upstream.filter((item) => item.ready).length}/${upstream.length} inputs`
                : t.connectTriggers,
            detail: "Any incoming node can continue the flow",
          };
          break;
        }
        case "logic-not": {
          const firstInput = upstream[0];
          result = {
            ready: Boolean(firstInput) && !firstInput.ready,
            metric: firstInput ? `NOT ${firstInput.metric}` : t.connectTriggers,
            detail: firstInput ? `Inverse of ${firstInput.detail}` : "Connect a trigger",
          };
          break;
        }
        case "inverter-limit": {
          const targetDeviceId =
            Number(config.targetDeviceId ?? NaN) ||
            context.sunlit?.devices.find((device) => device.controllable)?.id ||
            NaN;
          const targetDevice = context.sunlit?.devices.find((device) => device.id === targetDeviceId) || null;
          const limitWatts = Number(config.limitWatts ?? 800);
          result = {
            ready: upstream.length > 0 && upstream.every((item) => item.ready) && Boolean(targetDevice),
            metric: targetDevice ? `${limitWatts}W -> ${targetDevice.label}` : t.noDevices,
            detail: targetDevice ? t.remoteControlEndpoint : t.selectInverter,
            action: targetDevice
              ? {
                  type: "inverter-limit",
                  deviceId: targetDevice.id,
                  label: targetDevice.label,
                  maxOutputPower: limitWatts,
                }
              : undefined,
          };
          break;
        }
        default: {
          const message = String(config.message || t.notePlaceholder);
          result = {
            ready: upstream.length > 0 && upstream.every((item) => item.ready),
            metric: message,
            detail: t.localNoteDetail,
            action: { type: "dashboard-note", message },
          };
        }
      }

      visiting.delete(nodeId);
      memo.set(nodeId, result);
      return result;
    };

    nodes.forEach((node) => {
      evaluate(node.id);
    });

    return memo;
  }, [
    adjustedSolarForecast,
    context,
    edges,
    language,
    nodes,
    t.allInputs,
    t.connectTriggers,
    t.cycleBlocked,
    t.forecastSource,
    t.localNoteDetail,
    t.missingNode,
    t.noActiveWindow,
    t.noBatteryData,
    t.noDevices,
    t.noForecast,
    t.noPriceData,
    t.noSolarData,
    t.noSunlit,
    t.noWeatherData,
    t.notePlaceholder,
    t.remoteControlEndpoint,
    t.selectInverter,
    t.today,
    t.tomorrow,
  ]);

  useEffect(() => {
    setNodes((currentNodes) => {
      let changed = false;

      const nextNodes = currentNodes.map((node) => {
        const evaluation = evaluations.get(node.id);

        if (!evaluation) {
          return node;
        }

        if (node.data.metric === evaluation.metric && node.data.ready === evaluation.ready) {
          return node;
        }

        changed = true;

        return {
          ...node,
          data: {
            ...node.data,
            metric: evaluation.metric,
            ready: evaluation.ready,
          },
        };
      });

      return changed ? nextNodes : currentNodes;
    });
  }, [evaluations, setNodes]);

  const executeAction = useCallback(
    async (result: EvaluationResult) => {
      if (!result.action) {
        return;
      }

      if (result.action.type === "dashboard-note") {
        pushEvent("info", `${t.localNote}: ${result.action.message}`);
        return;
      }

      try {
        const response = await fetch("/api/automation/execute", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            deviceId: result.action.deviceId,
            maxOutputPower: result.action.maxOutputPower,
          }),
        });

        const payload = (await response.json()) as { ok?: boolean; error?: string };

        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || "execution_failed");
        }

        pushEvent(
          "success",
          `${t.executeSuccess}: ${result.action.maxOutputPower}W -> ${result.action.label}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "execution_failed";
        pushEvent("error", `${t.executeError}: ${message}`);
      }
    },
    [pushEvent, t.executeError, t.executeSuccess, t.localNote],
  );

  useEffect(() => {
    const actionNodes = nodes.filter((node) => templateMap.get(node.data.template)?.kind === "action");
    const currentReady = Object.fromEntries(
      actionNodes.map((node) => [node.id, evaluations.get(node.id)?.ready ?? false]),
    );

    if (!armed) {
      previousReadyRef.current = currentReady;
      return;
    }

    for (const node of actionNodes) {
      const evaluation = evaluations.get(node.id);
      const wasReady = previousReadyRef.current[node.id] ?? false;

      if (evaluation?.ready && !wasReady) {
        void executeAction(evaluation);
      }
    }

    previousReadyRef.current = currentReady;
  }, [armed, evaluations, executeAction, nodes]);

  const selectedNode = selectedNodeId ? nodes.find((node) => node.id === selectedNodeId) || null : null;
  const selectedEdge = selectedEdgeId ? edges.find((edge) => edge.id === selectedEdgeId) || null : null;
  const derivedSelectedNodeIds = useMemo(
    () => nodes.filter((node) => node.selected).map((node) => node.id),
    [nodes],
  );
  const derivedSelectedEdgeIds = useMemo(
    () => edges.filter((edge) => edge.selected).map((edge) => edge.id),
    [edges],
  );
  const selectedEdgeLabel = selectedEdge
    ? `${nodes.find((node) => node.id === selectedEdge.source)?.data.title || selectedEdge.source} -> ${
        nodes.find((node) => node.id === selectedEdge.target)?.data.title || selectedEdge.target
      }`
    : null;
  const selectedEvaluation = selectedNode ? evaluations.get(selectedNode.id) : undefined;
  const nodeTypes = useMemo(() => ({ automation: AutomationNode }), []);

  const displayEdges = useMemo(
    () =>
      edges.map((edge) => {
        const selected = edge.id === selectedEdgeId;

        return {
          ...edge,
          animated: true,
          interactionWidth: 42,
          style: {
            stroke: selected ? "#c56b1f" : "#2f79b5",
            strokeWidth: selected ? 6 : 4,
            strokeLinecap: "round" as const,
          },
        };
      }),
    [edges, selectedEdgeId],
  );

  const toggleArmed = useCallback(() => {
    if (armed) {
      setArmed(false);
      return;
    }

    previousReadyRef.current = {};
    setArmed(true);
  }, [armed]);

  const summaryItems = useMemo(() => {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const incomingMap = new Map<string, string[]>();

    for (const edge of edges) {
      const incoming = incomingMap.get(edge.target) || [];
      incoming.push(edge.source);
      incomingMap.set(edge.target, incoming);
    }

    const collectInputs = (nodeId: string, visited = new Set<string>()): string[] => {
      if (visited.has(nodeId)) {
        return [];
      }

      visited.add(nodeId);
      const incoming = incomingMap.get(nodeId) || [];

      return incoming.flatMap((sourceId) => {
        const sourceNode = nodeMap.get(sourceId);

        if (!sourceNode) {
          return [];
        }

        const template = templateMap.get(sourceNode.data.template)!;
        const evaluation = evaluations.get(sourceId);
        const label = evaluation?.metric ? `${sourceNode.data.title} (${evaluation.metric})` : sourceNode.data.title;

        if (template.kind === "trigger") {
          return [label];
        }

        const upstream = collectInputs(sourceId, new Set(visited));
        return upstream.length > 0 ? upstream : [label];
      });
    };

    return nodes
      .filter((node) => templateMap.get(node.data.template)?.kind === "action")
      .map((node) => {
        const inputs = collectInputs(node.id);
        const evaluation = evaluations.get(node.id);
        const actionLabel = evaluation?.metric ? `${node.data.title} (${evaluation.metric})` : node.data.title;

        return {
          id: node.id,
          text:
            inputs.length > 0
              ? `${t.when} ${inputs.join(" + ")}, ${t.then} ${actionLabel}`
              : actionLabel,
          ready: evaluation?.ready ?? false,
        };
      });
  }, [edges, evaluations, nodes, t.then, t.when]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((currentEdges) => [...currentEdges, makeEdge(connection)]);
      setSelectedEdgeId(null);
    },
    [setEdges],
  );

  const removeSelectedEdge = useCallback(() => {
    if (!selectedEdgeId) {
      return;
    }

    setEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== selectedEdgeId));
    setSelectedEdgeId(null);
  }, [selectedEdgeId, setEdges]);

  const selectedNodeIdSet =
    derivedSelectedNodeIds.length > 0 ? derivedSelectedNodeIds : selectedNodeId ? [selectedNodeId] : [];
  const selectedEdgeIdSet =
    derivedSelectedEdgeIds.length > 0 ? derivedSelectedEdgeIds : selectedEdgeId ? [selectedEdgeId] : [];

  const duplicateSelection = useCallback(() => {
    if (selectedNodeIdSet.length === 0) {
      return;
    }

    const sourceNodes = nodes.filter((node) => selectedNodeIdSet.includes(node.id));
    const nodeIdMap = new Map<string, string>();
    sourceNodes.forEach((node, index) => {
      nodeIdMap.set(node.id, `${node.id}-copy-${Date.now().toString(36)}-${index}`);
    });

    const copiedNodes = sourceNodes.map((node) => ({
      ...node,
      id: nodeIdMap.get(node.id)!,
      position: {
        x: node.position.x + 90,
        y: node.position.y + 90,
      },
      selected: true,
    }));

    const copiedEdges = edges
      .filter((edge) => nodeIdMap.has(edge.source) && nodeIdMap.has(edge.target))
      .map((edge, index) =>
        ({
          ...makeEdge({
            id: `${edge.id}-copy-${Date.now().toString(36)}-${index}`,
            source: nodeIdMap.get(edge.source)!,
            target: nodeIdMap.get(edge.target)!,
          }),
          selected: true,
        }) satisfies Edge,
      );

    setNodes((currentNodes) => [...currentNodes.map((node) => ({ ...node, selected: false })), ...copiedNodes]);
    setEdges((currentEdges) => [...currentEdges.map((edge) => ({ ...edge, selected: false })), ...copiedEdges]);
    setSelectedNodeId(copiedNodes[0]?.id ?? null);
    setSelectedEdgeId(copiedEdges[0]?.id ?? null);
    pushEvent("info", t.selectionCopied);
  }, [edges, nodes, pushEvent, selectedNodeIdSet, setEdges, setNodes, t.selectionCopied]);

  const deleteSelection = useCallback(() => {
    if (selectedNodeIdSet.length === 0 && selectedEdgeIdSet.length === 0) {
      return;
    }

    setNodes((currentNodes) => currentNodes.filter((node) => !selectedNodeIdSet.includes(node.id)));
    setEdges((currentEdges) =>
      currentEdges.filter(
        (edge) =>
          !selectedEdgeIdSet.includes(edge.id) &&
          !selectedNodeIdSet.includes(edge.source) &&
          !selectedNodeIdSet.includes(edge.target),
      ),
    );
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    pushEvent("info", t.selectionDeleted);
  }, [pushEvent, selectedEdgeIdSet, selectedNodeIdSet, setEdges, setNodes, t.selectionDeleted]);

  const generateStarterRules = useCallback(() => {
    if (!context?.sunlit?.devices || context.sunlit.devices.length === 0) {
      pushEvent("error", t.cannotGenerateRules);
      return;
    }

    const generated = buildStarterFlows({
      language,
      context,
      includeForecast: currentProfileReady,
    });

    setNodes(generated.nodes.map((node) => ({ ...node, selected: true })));
    setEdges(generated.edges.map((edge) => ({ ...edge, selected: true })));
    setSelectedNodeId(generated.nodes[0]?.id ?? null);
    setSelectedEdgeId(null);
    setArmed(false);
    previousReadyRef.current = {};
    pushEvent("success", t.generatedRules);
  }, [context, currentProfileReady, language, pushEvent, setEdges, setNodes, t.cannotGenerateRules, t.generatedRules]);

  const toggleFullscreen = useCallback(async () => {
    if (!shellRef.current) {
      return;
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }

    await shellRef.current.requestFullscreen();
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const templateKey = event.dataTransfer.getData("application/sunlit-template") as TemplateKey;

      if (!templateMap.has(templateKey)) {
        return;
      }

      const position = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const nodeId = `${templateKey}-${Date.now().toString(36)}`;
      const nextNode = createNode(templateKey, language, nodeId, position);

      setNodes((currentNodes) => [
        ...currentNodes.map((node) => ({ ...node, selected: false })),
        { ...nextNode, selected: true },
      ]);
      setEdges((currentEdges) => currentEdges.map((edge) => ({ ...edge, selected: false })));
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
    },
    [language, reactFlow, setEdges, setNodes],
  );

  const addNodeFromLibrary = useCallback(
    (templateKey: TemplateKey) => {
      const template = templateMap.get(templateKey)!;
      const offset = nodes.length * 24;
      const nodeId = `${templateKey}-${Date.now().toString(36)}`;

      setNodes((currentNodes) => [
        ...currentNodes.map((node) => ({ ...node, selected: false })),
        {
          ...createNode(templateKey, language, nodeId, {
            x: template.defaultPosition.x + offset,
            y: template.defaultPosition.y + offset * 0.35,
          }),
          selected: true,
        },
      ]);
      setEdges((currentEdges) => currentEdges.map((edge) => ({ ...edge, selected: false })));
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
    },
    [language, nodes.length, setEdges, setNodes],
  );

  const updateConfig = useCallback(
    (field: string, value: string | number | null) => {
      if (!selectedNodeId) {
        return;
      }

      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === selectedNodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  config: {
                    ...node.data.config,
                    [field]: value,
                  },
                },
              }
            : node,
        ),
      );
    },
    [selectedNodeId, setNodes],
  );

  const removeSelectedNode = useCallback(() => {
    if (!selectedNodeId) {
      return;
    }

    setNodes((currentNodes) => currentNodes.filter((node) => node.id !== selectedNodeId));
    setEdges((currentEdges) =>
      currentEdges.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId),
    );
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, [selectedNodeId, setEdges, setNodes]);

  const updatePlantProfile = useCallback((field: keyof PlantProfile, value: string | boolean) => {
    setPlantProfile((current) => ({
      ...current,
      [field]: value,
    }));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName || "";

      if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c" && selectedNodeIdSet.length > 0) {
        event.preventDefault();
        duplicateSelection();
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }

      if (
        selectedEdgeIdSet.length > 0 ||
        selectedNodeIdSet.length > 0 ||
        selectedEdgeId !== null ||
        selectedNodeId !== null
      ) {
        event.preventDefault();
        deleteSelection();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelection, duplicateSelection, selectedEdgeId, selectedEdgeIdSet.length, selectedNodeId, selectedNodeIdSet.length]);

  const issueItems = context?.issues || [];
  const devices = context?.sunlit?.devices.filter((device) => device.controllable) || [];

  return (
    <div
      ref={shellRef}
      className={`automation-shell ${isFullscreen ? "automation-shell-fullscreen" : ""}`}
    >
      <div className="automation-toolbar">
        <div>
          <strong>{t.canvasTitle}</strong>
          <p>{t.autoRefresh}</p>
          {selectedEdge ? (
            <p className="automation-inline-hint">
              {t.selectedLine}: {selectedEdgeLabel}. {t.edgeHint}
            </p>
          ) : null}
        </div>
        <div className="automation-toolbar-actions">
          <button type="button" className="button-secondary" onClick={generateStarterRules}>
            {t.generateRules}
          </button>
          <button type="button" className="button-secondary" onClick={() => void fetchContext()}>
            {t.refresh}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={duplicateSelection}
            disabled={selectedNodeIdSet.length === 0}
          >
            {t.copySelection}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={deleteSelection}
            disabled={selectedNodeIdSet.length === 0 && selectedEdgeIdSet.length === 0}
          >
            {t.deleteSelection}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={removeSelectedEdge}
            disabled={!selectedEdge}
          >
            {t.deleteEdge}
          </button>
          <button type="button" className="button-secondary" onClick={() => void toggleFullscreen()}>
            {isFullscreen ? t.exitFullscreen : t.fullscreen}
          </button>
          <button
            type="button"
            className={armed ? "button-secondary" : "button-primary"}
            onClick={toggleArmed}
          >
            {armed ? t.disarm : t.arm}
          </button>
        </div>
      </div>
      {(selectedNodeIdSet.length > 0 || selectedEdgeIdSet.length > 0) ? (
        <div className="notice notice-success">
          {t.selectionCount}: {selectedNodeIdSet.length + selectedEdgeIdSet.length}
        </div>
      ) : null}

      <div className="automation-context-grid">
        <article className="automation-context-card">
          <span>{t.timeCard}</span>
          <strong>{context?.berlinTime.display || "--"}</strong>
          <p>{context?.berlinTime.timezone || "Europe/Berlin"}</p>
        </article>
        <article className="automation-context-card">
          <span>{t.weatherCard}</span>
          <strong>
            {context?.weather
              ? `${formatMetricValue(context.weather.temperatureC, " C")} / ${formatMetricValue(
                  context.weather.precipitationProbability,
                  "%",
                )}`
              : "--"}
          </strong>
          <p>{context?.weather ? weatherLabel(context.weather.weatherCode, language) : "--"}</p>
        </article>
        <article className="automation-context-card">
          <span>{t.priceCard}</span>
          <strong>{context?.electricity ? `${formatMetricValue(context.electricity.currentCtPerKwh, " ct/kWh")}` : "--"}</strong>
          <p>
            {context?.electricity?.currentWindow
              ? `${t.currentWindow}: ${formatWindow(
                  context.electricity.currentWindow.start,
                  context.electricity.currentWindow.end,
                )}`
              : "--"}
          </p>
        </article>
        <article className="automation-context-card">
          <span>{t.warningsCard}</span>
          <strong>
            {context?.warnings?.highestBerlin
              ? `L${context.warnings.highestBerlin.level} ${context.warnings.highestBerlin.event}`
              : "--"}
          </strong>
          <p>{context?.warnings ? `${context.warnings.berlinCount} ${t.berlinWarnings}` : "--"}</p>
        </article>
        <article className="automation-context-card automation-context-card-wide">
          <span>{t.sunlitCard}</span>
          <strong>{context?.sunlit?.familyName || t.noSunlit}</strong>
          <p>
            {context?.sunlit
              ? `${t.batteryLabel} ${formatMetricValue(context.sunlit.batteryLevel, "%")} | ${t.solarLabel} ${formatMetricValue(
                  context.sunlit.solarPowerW,
                  "W",
                )} | ${t.homeLabel} ${formatMetricValue(context.sunlit.homePowerW, "W")}`
              : "--"}
          </p>
        </article>
        <article className="automation-context-card">
          <span>{t.solarForecastCard}</span>
          <strong>
            {adjustedSolarForecast
              ? `${t.forecastTomorrow} ${formatMetricValue(adjustedSolarForecast.tomorrowTotalWh, " Wh")}`
              : currentProfileReady
                ? t.noForecast
                : "--"}
          </strong>
          <p>
            {adjustedSolarForecast?.tomorrowPeakHour
              ? `${t.forecastPeak}: ${adjustedSolarForecast.tomorrowPeakHour} / ${formatMetricValue(
                  adjustedSolarForecast.tomorrowPeakW,
                  "W",
                )}`
              : currentProfileReady
                ? t.forecastSource
                : t.forecastMissing}
          </p>
        </article>
      </div>

      {loading ? <div className="notice notice-success">{t.loading}</div> : null}
      {loadError ? <div className="notice notice-error">{loadError}</div> : null}
      {!armed ? <div className="notice notice-warning">{t.unarmedNote}</div> : null}
      {issueItems.length > 0 ? (
        <div className="notice notice-warning">
          {issueItems.map((issue) => `${t.issuePrefix}: ${issue}`).join(" | ")}
        </div>
      ) : null}

      <div className="automation-layout">
        <aside className="automation-sidebar">
          <section className="automation-panel">
            <div className="panel-header">
              <h2>{t.palette}</h2>
            </div>
            <p className="panel-copy">{t.dragHint}</p>

            <div className="automation-group-label">{t.triggers}</div>
            <div className="automation-library-list">
              {templateDefinitions
                .filter((template) => template.kind === "trigger")
                .map((template) => (
                  <button
                    key={template.key}
                    type="button"
                    draggable
                    className="automation-library-item"
                    onClick={() => addNodeFromLibrary(template.key)}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("application/sunlit-template", template.key);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    <strong>{template.title[language]}</strong>
                    <span>{template.description[language]}</span>
                  </button>
                ))}
            </div>

            <div className="automation-group-label">{t.conditions}</div>
            <div className="automation-library-list">
              {templateDefinitions
                .filter((template) => template.kind === "condition")
                .map((template) => (
                  <button
                    key={template.key}
                    type="button"
                    draggable
                    className="automation-library-item"
                    onClick={() => addNodeFromLibrary(template.key)}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("application/sunlit-template", template.key);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    <strong>{template.title[language]}</strong>
                    <span>{template.description[language]}</span>
                  </button>
                ))}
            </div>

            <div className="automation-group-label">{t.actions}</div>
            <div className="automation-library-list">
              {templateDefinitions
                .filter((template) => template.kind === "action")
                .map((template) => (
                  <button
                    key={template.key}
                    type="button"
                    draggable
                    className="automation-library-item"
                    onClick={() => addNodeFromLibrary(template.key)}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("application/sunlit-template", template.key);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    <strong>{template.title[language]}</strong>
                    <span>{template.description[language]}</span>
                  </button>
                ))}
            </div>
          </section>

          <section className="automation-panel">
            <div className="panel-header">
              <h2>{t.inspector}</h2>
            </div>

            <div className="automation-group-label">{t.forecastConfig}</div>
            <div className="automation-field-grid">
              <label className="field-shell">
                <span>{t.latitude}</span>
                <input
                  type="number"
                  step="any"
                  value={plantProfile.latitude}
                  className="credential-input"
                  onChange={(event) => updatePlantProfile("latitude", event.target.value)}
                />
              </label>
              <label className="field-shell">
                <span>{t.longitude}</span>
                <input
                  type="number"
                  step="any"
                  value={plantProfile.longitude}
                  className="credential-input"
                  onChange={(event) => updatePlantProfile("longitude", event.target.value)}
                />
              </label>
              <label className="field-shell">
                <span>{t.declination}</span>
                <input
                  type="number"
                  step="any"
                  value={plantProfile.declination}
                  className="credential-input"
                  onChange={(event) => updatePlantProfile("declination", event.target.value)}
                />
              </label>
              <label className="field-shell">
                <span>{t.azimuth}</span>
                <input
                  type="number"
                  step="any"
                  value={plantProfile.azimuth}
                  className="credential-input"
                  onChange={(event) => updatePlantProfile("azimuth", event.target.value)}
                />
              </label>
              <label className="field-shell">
                <span>{t.kwp}</span>
                <input
                  type="number"
                  step="any"
                  value={plantProfile.kwp}
                  className="credential-input"
                  onChange={(event) => updatePlantProfile("kwp", event.target.value)}
                />
              </label>
              <label className="field-shell">
                <span>{t.manualFactor}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.2"
                  max="1.3"
                  value={plantProfile.manualFactor}
                  className="credential-input"
                  onChange={(event) => updatePlantProfile("manualFactor", event.target.value)}
                />
              </label>
              <label className="field-shell automation-checkbox">
                <span>{t.learningEnabled}</span>
                <input
                  type="checkbox"
                  checked={plantProfile.learningEnabled}
                  onChange={(event) => updatePlantProfile("learningEnabled", event.target.checked)}
                />
              </label>
            </div>

            <div className="automation-inspector-meta">
              <div>
                <span>{t.manualFactor}</span>
                <strong>{formatMetricValue(manualFactor)}</strong>
              </div>
              <div>
                <span>{t.learnedFactor}</span>
                <strong>{learnedFactor !== null ? formatMetricValue(learnedFactor) : "--"}</strong>
              </div>
              <div>
                <span>{t.effectiveFactor}</span>
                <strong>{formatMetricValue(effectiveFactor)}</strong>
              </div>
              <div>
                <span>{t.forecastSource}</span>
                <strong>{currentProfileReady ? t.saveProfile : t.forecastMissing}</strong>
              </div>
            </div>
            <p className="panel-copy">{t.learningHint}</p>

            {!selectedNode ? (
              <p className="panel-copy">{t.noSelection}</p>
            ) : (
              <div className="automation-inspector">
                <div className="automation-inspector-header">
                  <div>
                    <strong>{selectedNode.data.title}</strong>
                    <p>{selectedNode.data.description}</p>
                  </div>
                  <button type="button" className="button-secondary" onClick={removeSelectedNode}>
                    {t.removeNode}
                  </button>
                </div>

                <div className="automation-inspector-meta">
                  <div>
                    <span>{t.currentValue}</span>
                    <strong>{selectedEvaluation?.metric || "--"}</strong>
                  </div>
                  <div>
                    <span>{t.detailLabel}</span>
                    <strong>{selectedEvaluation?.detail || "--"}</strong>
                  </div>
                </div>

                {selectedNode.data.template === "time-window" ? (
                  <div className="automation-field-grid">
                    <label className="field-shell">
                      <span>{t.startHour}</span>
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={String(selectedNode.data.config.startHour ?? 13)}
                        className="credential-input"
                        onChange={(event) => updateConfig("startHour", Number(event.target.value))}
                      />
                    </label>
                    <label className="field-shell">
                      <span>{t.endHour}</span>
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={String(selectedNode.data.config.endHour ?? 17)}
                        className="credential-input"
                        onChange={(event) => updateConfig("endHour", Number(event.target.value))}
                      />
                    </label>
                  </div>
                ) : null}

                {["price-threshold", "battery-soc", "solar-power", "weather-check", "solar-forecast"].includes(
                  selectedNode.data.template,
                ) ? (
                  <div className="automation-field-grid">
                    {selectedNode.data.template === "weather-check" ? (
                      <label className="field-shell">
                        <span>{t.metricMode}</span>
                        <select
                          value={String(selectedNode.data.config.metricMode ?? "precipitation")}
                          className="family-select"
                          onChange={(event) => updateConfig("metricMode", event.target.value)}
                        >
                          <option value="precipitation">{t.precipitation}</option>
                          <option value="temperature">{t.temperature}</option>
                        </select>
                      </label>
                    ) : null}

                    {selectedNode.data.template === "solar-forecast" ? (
                      <>
                        <label className="field-shell">
                          <span>{t.forecastDay}</span>
                          <select
                            value={String(selectedNode.data.config.dayOffset ?? 1)}
                            className="family-select"
                            onChange={(event) => updateConfig("dayOffset", Number(event.target.value))}
                          >
                            <option value="0">{t.today}</option>
                            <option value="1">{t.tomorrow}</option>
                          </select>
                        </label>
                        <label className="field-shell">
                          <span>{t.forecastHour}</span>
                          <input
                            type="number"
                            min={0}
                            max={23}
                            value={String(selectedNode.data.config.forecastHour ?? 12)}
                            className="credential-input"
                            onChange={(event) => updateConfig("forecastHour", Number(event.target.value))}
                          />
                        </label>
                      </>
                    ) : null}

                    <label className="field-shell">
                      <span>{t.comparator}</span>
                      <select
                        value={String(selectedNode.data.config.comparator ?? "<=")}
                        className="family-select"
                        onChange={(event) => updateConfig("comparator", event.target.value)}
                      >
                        <option value="<=">{t.lessThan}</option>
                        <option value=">=">{t.greaterThan}</option>
                      </select>
                    </label>

                    <label className="field-shell">
                      <span>{t.threshold}</span>
                      <input
                        type="number"
                        step="any"
                        value={String(selectedNode.data.config.threshold ?? 0)}
                        className="credential-input"
                        onChange={(event) => updateConfig("threshold", Number(event.target.value))}
                      />
                    </label>
                  </div>
                ) : null}

                {selectedNode.data.template === "warning-level" ? (
                  <label className="field-shell">
                    <span>{t.warningLevel}</span>
                    <select
                      value={String(selectedNode.data.config.warningLevel ?? 3)}
                      className="family-select"
                      onChange={(event) => updateConfig("warningLevel", Number(event.target.value))}
                    >
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4</option>
                    </select>
                  </label>
                ) : null}

                {selectedNode.data.template === "inverter-limit" ? (
                  <div className="automation-field-grid">
                    <label className="field-shell">
                      <span>{t.targetDevice}</span>
                      <select
                        value={String(selectedNode.data.config.targetDeviceId ?? "")}
                        className="family-select"
                        onChange={(event) =>
                          updateConfig("targetDeviceId", event.target.value ? Number(event.target.value) : null)
                        }
                      >
                        <option value="">{t.autoPick}</option>
                        {devices.map((device) => (
                          <option key={device.id} value={device.id}>
                            {device.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field-shell">
                      <span>{t.limitWatts}</span>
                      <input
                        type="number"
                        min={0}
                        max={4000}
                        step={10}
                        value={String(selectedNode.data.config.limitWatts ?? 800)}
                        className="credential-input"
                        onChange={(event) => updateConfig("limitWatts", Number(event.target.value))}
                      />
                    </label>
                  </div>
                ) : null}

                {selectedNode.data.template === "dashboard-note" ? (
                  <label className="field-shell">
                    <span>{t.message}</span>
                    <input
                      type="text"
                      value={String(selectedNode.data.config.message ?? t.notePlaceholder)}
                      className="credential-input"
                      onChange={(event) => updateConfig("message", event.target.value)}
                    />
                  </label>
                ) : null}

                {["logic-and", "logic-or", "logic-not"].includes(selectedNode.data.template) ? (
                  <p className="panel-copy">{t.noConfig}</p>
                ) : null}
              </div>
            )}
          </section>
        </aside>

        <section className="automation-canvas-shell">
          <ReactFlow
            nodes={nodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.4}
            maxZoom={1.4}
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
            deleteKeyCode={null}
            connectionLineStyle={{ stroke: "#2f79b5", strokeWidth: 4 }}
            defaultEdgeOptions={{ animated: true, type: "smoothstep" }}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id);
              setSelectedEdgeId(null);
            }}
            onEdgeClick={(event, edge) => {
              event.preventDefault();
              event.stopPropagation();
              setSelectedNodeId(null);
              setSelectedEdgeId(edge.id);
            }}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={onDrop}
          >
            <MiniMap pannable zoomable nodeColor={automationNodeColor} />
            <Controls />
            <Background gap={18} size={1} />
          </ReactFlow>
        </section>

        <aside className="automation-sidebar">
          <section className="automation-panel">
            <div className="panel-header">
              <h2>{t.summary}</h2>
            </div>
            <div className="automation-summary-list">
              {summaryItems.length === 0 ? <p className="panel-copy">{t.noSummary}</p> : null}
              {summaryItems.map((item) => (
                <article
                  key={item.id}
                  className={`automation-summary-card ${item.ready ? "automation-summary-ready" : ""}`}
                >
                  <strong>{item.ready ? t.flowReady : t.flowIdle}</strong>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="automation-panel">
            <div className="panel-header">
              <h2>{t.events}</h2>
            </div>
            <div className="automation-event-list">
              {events.length === 0 ? <p className="panel-copy">{t.noEvents}</p> : null}
              {events.map((event) => (
                <article key={event.id} className={`automation-event automation-event-${event.status}`}>
                  <strong>{formatEventTime(event.time, language)}</strong>
                  <p>{event.message}</p>
                </article>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

export function AutomationStudio({ familyId }: { familyId: number }) {
  const [language, setLanguage] = useState<Language>("en");
  const t = translations[language];

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);

    if (stored === "en" || stored === "de" || stored === "cn") {
      setLanguage(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  return (
    <section className="automation-studio-section">
      <div className="automation-studio-header">
        <div>
          <span className="eyebrow">Flow Builder</span>
          <h2>{t.title}</h2>
          <p>{t.subtitle}</p>
        </div>
        <div className="language-switcher" aria-label={t.language}>
          <button
            type="button"
            className={`language-pill ${language === "en" ? "language-pill-active" : ""}`}
            onClick={() => setLanguage("en")}
          >
            EN
          </button>
          <button
            type="button"
            className={`language-pill ${language === "de" ? "language-pill-active" : ""}`}
            onClick={() => setLanguage("de")}
          >
            DE
          </button>
          <button
            type="button"
            className={`language-pill ${language === "cn" ? "language-pill-active" : ""}`}
            onClick={() => setLanguage("cn")}
          >
            CN
          </button>
        </div>
      </div>

      <ReactFlowProvider>
        <StudioCanvas familyId={familyId} language={language} />
      </ReactFlowProvider>
    </section>
  );
}
