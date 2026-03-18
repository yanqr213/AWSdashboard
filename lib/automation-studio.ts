export type Language = "en" | "de" | "cn";

export type TemplateKey =
  | "time-window"
  | "price-threshold"
  | "weather-check"
  | "warning-level"
  | "battery-soc"
  | "solar-power"
  | "solar-forecast"
  | "logic-and"
  | "logic-or"
  | "logic-not"
  | "inverter-limit"
  | "dashboard-note";

export type SolarForecastPoint = {
  key: string;
  date: string;
  hour: number;
  localTime: string;
  dayOffset: 0 | 1;
  watts: number;
};

export type AutomationContextPayload = {
  refreshedAt: number;
  berlinTime: {
    iso: string;
    display: string;
    hour: number;
    minute: number;
    timezone: string;
  };
  weather: {
    location: string;
    temperatureC: number | null;
    apparentTemperatureC: number | null;
    precipitationMm: number | null;
    windSpeedKph: number | null;
    weatherCode: number | null;
    precipitationProbability: number | null;
  } | null;
  electricity: {
    currency: string;
    unit: string;
    currentCtPerKwh: number | null;
    currentWindow: { start: number; end: number } | null;
    cheapestCtPerKwh: number | null;
    cheapestWindow: { start: number; end: number } | null;
    highestCtPerKwh: number | null;
    averageCtPerKwh: number | null;
  } | null;
  warnings: {
    totalWarnings: number;
    berlinCount: number;
    highestGermany: {
      state: string;
      regionName: string;
      event: string;
      level: number;
      start: number | null;
      end: number | null;
    } | null;
    highestBerlin: {
      state: string;
      regionName: string;
      event: string;
      level: number;
      start: number | null;
      end: number | null;
    } | null;
  } | null;
  sunlit: {
    familyId: number;
    familyName: string;
    batteryLevel: number | null;
    solarPowerW: number | null;
    homePowerW: number | null;
    strategy: string | null;
    devices: Array<{
      id: number;
      label: string;
      serial: string | null;
      type: string | null;
      controllable: boolean;
    }>;
  } | null;
  solarForecast: {
    source: string;
    plant: {
      latitude: number;
      longitude: number;
      declination: number;
      azimuth: number;
      kwp: number;
      place: string | null;
      timezone: string | null;
      generatedAt: string | null;
    };
    todayTotalWh: number | null;
    tomorrowTotalWh: number | null;
    tomorrowPeakW: number | null;
    tomorrowPeakHour: string | null;
    hourly: SolarForecastPoint[];
  } | null;
  issues: string[];
};

export type AutomationNodeData = {
  template: TemplateKey;
  language: Language;
  title: string;
  description: string;
  metric: string;
  ready: boolean;
  config: Record<string, string | number | null>;
};

export type EvaluationResult = {
  ready: boolean;
  metric: string;
  detail: string;
  action?:
    | {
        type: "inverter-limit";
        deviceId: number;
        label: string;
        maxOutputPower: number;
      }
    | {
        type: "dashboard-note";
        message: string;
      };
};

export type AutomationEvent = {
  id: string;
  status: "success" | "error" | "info";
  message: string;
  time: number;
};

export type TemplateDefinition = {
  key: TemplateKey;
  kind: "trigger" | "condition" | "action";
  liveCapable: boolean;
  defaultPosition: { x: number; y: number };
  defaultConfig: Record<string, string | number | null>;
  title: Record<Language, string>;
  description: Record<Language, string>;
};

export const translations = {
  en: {
    title: "Automation Studio",
    subtitle: "Drag blocks onto the canvas, connect trigger lines, and arm live reactions on top of SunEnergyXT data.",
    palette: "Node Library",
    liveContext: "Live Context",
    inspector: "Inspector",
    summary: "Rule Summary",
    events: "Execution Log",
    language: "Language",
    autoRefresh: "Context refreshes every 15 seconds.",
    refresh: "Refresh context",
    loading: "Loading context...",
    arm: "Arm automation",
    disarm: "Pause automation",
    unarmedNote: "Actions only fire after you arm the flow.",
    noSelection: "Select a node to edit its trigger or response settings.",
    noEvents: "No automation events yet.",
    noSummary: "Connect trigger nodes to condition or action nodes to generate rule summaries.",
    triggerReady: "Ready",
    triggerIdle: "Waiting",
    issuePrefix: "Data source issue",
    timeCard: "Berlin time",
    weatherCard: "Weather",
    warningsCard: "Warnings",
    priceCard: "German power price",
    sunlitCard: "Sunlit context",
    solarForecastCard: "PV forecast",
    triggers: "Triggers",
    conditions: "Conditions",
    actions: "Responses",
    dragHint: "Drag onto the board and connect handles to build a rule.",
    startHour: "Start hour",
    endHour: "End hour",
    threshold: "Threshold",
    comparator: "Comparator",
    targetDevice: "Target device",
    limitWatts: "Power limit (W)",
    message: "Message",
    metricMode: "Metric",
    warningLevel: "Min warning level",
    precipitation: "Precipitation probability",
    temperature: "Temperature",
    greaterThan: ">=",
    lessThan: "<=",
    notePlaceholder: "Send dashboard note",
    executeSuccess: "Automation executed",
    executeError: "Execution failed",
    localNote: "Dashboard note emitted",
    autoPick: "Auto-pick first inverter",
    noDevices: "No controllable inverter found",
    noSunlit: "No live Sunlit context",
    currentValue: "Current value",
    detailLabel: "Detail",
    currentWindow: "Current window",
    cheapestWindow: "Cheapest window",
    highestWarning: "Highest warning",
    berlinWarnings: "Berlin warnings",
    familyLabel: "Family",
    batteryLabel: "Battery",
    solarLabel: "Solar",
    homeLabel: "Home load",
    strategyLabel: "Strategy",
    forecastTomorrow: "Tomorrow",
    forecastPeak: "Peak hour",
    forecastConfig: "PV Forecast Setup",
    forecastMissing: "Add latitude, longitude, tilt, azimuth, and kWp to enable next-day PV forecast.",
    latitude: "Latitude",
    longitude: "Longitude",
    declination: "Tilt / declination",
    azimuth: "Azimuth",
    kwp: "System size (kWp)",
    manualFactor: "Manual shading factor",
    learnedFactor: "Learned factor",
    effectiveFactor: "Effective factor",
    learningEnabled: "Learn from live solar output",
    learningHint: "After about one to two weeks, the learned factor becomes much more useful for shading correction.",
    forecastHour: "Forecast hour",
    forecastDay: "Forecast day",
    today: "Today",
    tomorrow: "Tomorrow",
    noForecast: "No PV forecast yet",
    forecastSource: "Forecast.Solar public API",
    saveProfile: "Profile saved locally",
    deleteEdge: "Delete line",
    selectedLine: "Selected line",
    edgeHint: "Click a line to highlight it, then delete it from the toolbar or press Delete.",
    generateRules: "Generate starter rules",
    copySelection: "Copy selection",
    deleteSelection: "Delete selection",
    fullscreen: "Fullscreen",
    exitFullscreen: "Exit fullscreen",
    selectionCount: "Selected items",
    generatedRules: "Starter rules generated from the current space devices.",
    selectionCopied: "Selection duplicated",
    selectionDeleted: "Selection deleted",
    cannotGenerateRules: "No device context available yet for rule generation.",
    removeNode: "Remove node",
    noConfig: "This node has no extra settings.",
    allInputs: "All incoming nodes must be ready.",
    when: "When",
    then: "then",
    canvasTitle: "Visual automation board",
    flowReady: "Flow ready",
    flowIdle: "Flow idle",
    cycleBlocked: "Cycle blocked",
    missingNode: "Missing node",
    noPriceData: "No price data",
    noActiveWindow: "No active window",
    noWeatherData: "No weather data",
    noBatteryData: "No battery data",
    noSolarData: "No solar data",
    connectTriggers: "Connect triggers",
    remoteControlEndpoint: "Remote control endpoint",
    selectInverter: "Select an inverter",
    localNoteDetail: "Local note",
  },
  de: {
    title: "Automationsstudio",
    subtitle: "Ziehe Bausteine auf die Flaeche, verbinde Trigger und aktiviere Live-Reaktionen auf Basis von SunEnergyXT-Daten.",
    palette: "Knotenbibliothek",
    liveContext: "Live-Kontext",
    inspector: "Inspektor",
    summary: "Regeluebersicht",
    events: "Ausfuehrungsprotokoll",
    language: "Sprache",
    autoRefresh: "Der Kontext wird alle 15 Sekunden aktualisiert.",
    refresh: "Kontext aktualisieren",
    loading: "Kontext wird geladen...",
    arm: "Automatisierung aktivieren",
    disarm: "Automatisierung pausieren",
    unarmedNote: "Aktionen werden erst nach dem Aktivieren ausgefuehrt.",
    noSelection: "Waehle einen Knoten aus, um Trigger- oder Reaktionsparameter zu bearbeiten.",
    noEvents: "Noch keine Automationsereignisse.",
    noSummary: "Verbinde Trigger mit Bedingungen oder Aktionen, um Regeln zu erzeugen.",
    triggerReady: "Aktiv",
    triggerIdle: "Wartet",
    issuePrefix: "Datenquellenproblem",
    timeCard: "Berliner Zeit",
    weatherCard: "Wetter",
    warningsCard: "Warnungen",
    priceCard: "Deutscher Strompreis",
    sunlitCard: "Sunlit-Kontext",
    solarForecastCard: "PV-Prognose",
    triggers: "Trigger",
    conditions: "Bedingungen",
    actions: "Aktionen",
    dragHint: "Auf das Board ziehen und ueber die Griffe verbinden, um eine Regel zu bauen.",
    startHour: "Startstunde",
    endHour: "Endstunde",
    threshold: "Schwelle",
    comparator: "Vergleich",
    targetDevice: "Zielgeraet",
    limitWatts: "Leistungsgrenze (W)",
    message: "Nachricht",
    metricMode: "Metrik",
    warningLevel: "Min. Warnstufe",
    precipitation: "Niederschlagswahrscheinlichkeit",
    temperature: "Temperatur",
    greaterThan: ">=",
    lessThan: "<=",
    notePlaceholder: "Dashboard-Hinweis senden",
    executeSuccess: "Automatisierung ausgefuehrt",
    executeError: "Ausfuehrung fehlgeschlagen",
    localNote: "Dashboard-Hinweis erzeugt",
    autoPick: "Ersten Inverter automatisch waehlen",
    noDevices: "Kein steuerbarer Inverter gefunden",
    noSunlit: "Kein Live-Sunlit-Kontext",
    currentValue: "Aktueller Wert",
    detailLabel: "Detail",
    currentWindow: "Aktives Zeitfenster",
    cheapestWindow: "Guenstigstes Zeitfenster",
    highestWarning: "Hoechste Warnung",
    berlinWarnings: "Warnungen in Berlin",
    familyLabel: "Familie",
    batteryLabel: "Batterie",
    solarLabel: "Solar",
    homeLabel: "Hauslast",
    strategyLabel: "Strategie",
    forecastTomorrow: "Morgen",
    forecastPeak: "Spitzenstunde",
    forecastConfig: "PV-Prognoseprofil",
    forecastMissing: "Latitude, Longitude, Neigung, Azimut und kWp eintragen, um die PV-Prognose fuer morgen zu aktivieren.",
    latitude: "Breitengrad",
    longitude: "Laengengrad",
    declination: "Neigung / Deklination",
    azimuth: "Azimut",
    kwp: "Anlagengroesse (kWp)",
    manualFactor: "Manueller Verschattungsfaktor",
    learnedFactor: "Gelernter Faktor",
    effectiveFactor: "Wirksamer Faktor",
    learningEnabled: "Aus Live-Solarleistung lernen",
    learningHint: "Nach etwa ein bis zwei Wochen wird der gelernte Faktor deutlich hilfreicher fuer Verschattungskorrekturen.",
    forecastHour: "Prognosestunde",
    forecastDay: "Prognosetag",
    today: "Heute",
    tomorrow: "Morgen",
    noForecast: "Noch keine PV-Prognose",
    forecastSource: "Forecast.Solar Public API",
    saveProfile: "Profil lokal gespeichert",
    deleteEdge: "Linie loeschen",
    selectedLine: "Ausgewaehlte Linie",
    edgeHint: "Linie anklicken, dann ueber die Toolbar oder mit Entf loeschen.",
    generateRules: "Starterregeln erzeugen",
    copySelection: "Auswahl kopieren",
    deleteSelection: "Auswahl loeschen",
    fullscreen: "Vollbild",
    exitFullscreen: "Vollbild beenden",
    selectionCount: "Ausgewaehlte Elemente",
    generatedRules: "Starterregeln wurden aus den aktuellen Geraeten erzeugt.",
    selectionCopied: "Auswahl dupliziert",
    selectionDeleted: "Auswahl geloescht",
    cannotGenerateRules: "Noch kein Geraetekontext fuer die Regelerzeugung verfuegbar.",
    removeNode: "Knoten entfernen",
    noConfig: "Dieser Knoten hat keine weiteren Einstellungen.",
    allInputs: "Alle eingehenden Knoten muessen aktiv sein.",
    when: "Wenn",
    then: "dann",
    canvasTitle: "Visuelles Automationsboard",
    flowReady: "Regel bereit",
    flowIdle: "Regel wartet",
    cycleBlocked: "Zyklus blockiert",
    missingNode: "Knoten fehlt",
    noPriceData: "Keine Preisdaten",
    noActiveWindow: "Kein aktives Zeitfenster",
    noWeatherData: "Keine Wetterdaten",
    noBatteryData: "Keine Batteriedaten",
    noSolarData: "Keine Solardaten",
    connectTriggers: "Trigger verbinden",
    remoteControlEndpoint: "Remote-Control-Endpunkt",
    selectInverter: "Inverter auswaehlen",
    localNoteDetail: "Lokaler Hinweis",
  },
  cn: {
    title: "自动化编排台",
    subtitle: "把节点拖到画布上，拉线连接触发与响应，并基于 SunEnergyXT 实时数据启用自动化动作。",
    palette: "节点库",
    liveContext: "实时上下文",
    inspector: "配置面板",
    summary: "规则摘要",
    events: "执行日志",
    language: "语言",
    autoRefresh: "上下文每 15 秒自动刷新一次。",
    refresh: "立即刷新",
    loading: "正在加载上下文...",
    arm: "启用自动化",
    disarm: "暂停自动化",
    unarmedNote: "只有在启用后，动作节点才会真正执行。",
    noSelection: "选择一个节点后即可编辑触发条件或响应参数。",
    noEvents: "还没有自动化执行记录。",
    noSummary: "把触发节点连接到条件或动作节点后，这里会生成规则摘要。",
    triggerReady: "已满足",
    triggerIdle: "等待中",
    issuePrefix: "数据源异常",
    timeCard: "柏林时间",
    weatherCard: "天气",
    warningsCard: "预警",
    priceCard: "德国电价",
    sunlitCard: "Sunlit 上下文",
    solarForecastCard: "光伏预测",
    triggers: "触发器",
    conditions: "条件",
    actions: "响应",
    dragHint: "拖到画布后通过连接点拉线，即可组合规则。",
    startHour: "开始小时",
    endHour: "结束小时",
    threshold: "阈值",
    comparator: "比较符",
    targetDevice: "目标设备",
    limitWatts: "功率限制 (W)",
    message: "消息",
    metricMode: "指标",
    warningLevel: "最低预警等级",
    precipitation: "降水概率",
    temperature: "温度",
    greaterThan: ">=",
    lessThan: "<=",
    notePlaceholder: "发送面板通知",
    executeSuccess: "自动化已执行",
    executeError: "执行失败",
    localNote: "已生成面板通知",
    autoPick: "自动选择第一个逆变器",
    noDevices: "未找到可控逆变器",
    noSunlit: "暂无 Sunlit 实时上下文",
    currentValue: "当前值",
    detailLabel: "详情",
    currentWindow: "当前时段",
    cheapestWindow: "最低价时段",
    highestWarning: "最高预警",
    berlinWarnings: "柏林预警数",
    familyLabel: "家庭",
    batteryLabel: "电池",
    solarLabel: "光伏",
    homeLabel: "家庭负载",
    strategyLabel: "策略",
    forecastTomorrow: "明天",
    forecastPeak: "峰值时段",
    forecastConfig: "光伏预测配置",
    forecastMissing: "填写经纬度、倾角、方位角和 kWp 后，即可启用次日光伏小时级预测。",
    latitude: "纬度",
    longitude: "经度",
    declination: "倾角",
    azimuth: "方位角",
    kwp: "装机容量 (kWp)",
    manualFactor: "手动遮挡系数",
    learnedFactor: "学习修正系数",
    effectiveFactor: "生效系数",
    learningEnabled: "根据实时光伏输出自动学习",
    learningHint: "累计约一到两周后，学习修正系数会更适合用来抵消遮挡影响。",
    forecastHour: "预测小时",
    forecastDay: "预测日期",
    today: "今天",
    tomorrow: "明天",
    noForecast: "还没有光伏预测数据",
    forecastSource: "Forecast.Solar 公共 API",
    saveProfile: "配置已保存在本地",
    deleteEdge: "删除连线",
    selectedLine: "已选中连线",
    edgeHint: "点击连线后可高亮，再通过工具栏或 Delete 键删除。",
    generateRules: "一键生成规则",
    copySelection: "复制所选",
    deleteSelection: "删除所选",
    fullscreen: "全屏",
    exitFullscreen: "退出全屏",
    selectionCount: "已选元素",
    generatedRules: "已根据当前空间设备生成起始规则。",
    selectionCopied: "已复制所选内容",
    selectionDeleted: "已删除所选内容",
    cannotGenerateRules: "当前还没有可用于生成规则的设备上下文。",
    removeNode: "删除节点",
    noConfig: "该节点没有额外配置项。",
    allInputs: "所有输入节点都满足后才会继续执行。",
    when: "当",
    then: "则",
    canvasTitle: "可视化自动化画布",
    flowReady: "规则已满足",
    flowIdle: "规则等待中",
    cycleBlocked: "检测到循环连接",
    missingNode: "节点缺失",
    noPriceData: "暂无电价数据",
    noActiveWindow: "暂无当前时段",
    noWeatherData: "暂无天气数据",
    noBatteryData: "暂无电池数据",
    noSolarData: "暂无光伏数据",
    connectTriggers: "请先连接触发节点",
    remoteControlEndpoint: "远程控制接口",
    selectInverter: "请选择逆变器",
    localNoteDetail: "本地通知",
  },
} as const;

export const templateDefinitions: TemplateDefinition[] = [
  {
    key: "time-window",
    kind: "trigger",
    liveCapable: true,
    defaultPosition: { x: 60, y: 80 },
    defaultConfig: { startHour: 13, endHour: 17 },
    title: { en: "Time Window", de: "Zeitfenster", cn: "时间窗口" },
    description: {
      en: "Fires when Berlin time enters the configured range.",
      de: "Wird aktiv, wenn die Berliner Zeit in das konfigurierte Fenster faellt.",
      cn: "当柏林时间进入设定区间时触发。",
    },
  },
  {
    key: "price-threshold",
    kind: "trigger",
    liveCapable: true,
    defaultPosition: { x: 60, y: 220 },
    defaultConfig: { comparator: "<=", threshold: 3.5 },
    title: { en: "Price Threshold", de: "Preis-Schwelle", cn: "电价阈值" },
    description: {
      en: "Compares the current German market price from aWATTar.",
      de: "Vergleicht den aktuellen deutschen Marktpreis von aWATTar.",
      cn: "对比来自 aWATTar 的德国实时电价。",
    },
  },
  {
    key: "weather-check",
    kind: "trigger",
    liveCapable: true,
    defaultPosition: { x: 60, y: 360 },
    defaultConfig: { metricMode: "precipitation", comparator: ">=", threshold: 60 },
    title: { en: "Weather Check", de: "Wetterpruefung", cn: "天气条件" },
    description: {
      en: "Uses Open-Meteo weather and precipitation context for Berlin.",
      de: "Verwendet Open-Meteo-Wetter und Niederschlagsdaten fuer Berlin.",
      cn: "使用 Open-Meteo 的柏林天气与降水数据。",
    },
  },
  {
    key: "warning-level",
    kind: "trigger",
    liveCapable: true,
    defaultPosition: { x: 60, y: 500 },
    defaultConfig: { warningLevel: 3 },
    title: { en: "DWD Warning", de: "DWD-Warnung", cn: "DWD 预警" },
    description: {
      en: "Checks the highest active DWD warning level for Berlin.",
      de: "Prueft die hoechste aktive DWD-Warnstufe fuer Berlin.",
      cn: "检查柏林当前最高的 DWD 预警等级。",
    },
  },
  {
    key: "battery-soc",
    kind: "trigger",
    liveCapable: true,
    defaultPosition: { x: 60, y: 640 },
    defaultConfig: { comparator: "<=", threshold: 30 },
    title: { en: "Battery SOC", de: "Batterie-SOC", cn: "电池 SOC" },
    description: {
      en: "Evaluates the current battery level from the live Sunlit family snapshot.",
      de: "Bewertet den aktuellen Batteriestand aus dem Live-Sunlit-Snapshot.",
      cn: "基于 Sunlit 家庭实时快照判断当前电池电量。",
    },
  },
  {
    key: "solar-power",
    kind: "trigger",
    liveCapable: true,
    defaultPosition: { x: 60, y: 780 },
    defaultConfig: { comparator: ">=", threshold: 1200 },
    title: { en: "Solar Power", de: "Solarleistung", cn: "光伏功率" },
    description: {
      en: "Compares current inverter power from the live Sunlit snapshot.",
      de: "Vergleicht die aktuelle Inverterleistung aus dem Live-Sunlit-Snapshot.",
      cn: "比较 Sunlit 实时快照中的当前逆变器功率。",
    },
  },
  {
    key: "solar-forecast",
    kind: "trigger",
    liveCapable: true,
    defaultPosition: { x: 60, y: 920 },
    defaultConfig: { dayOffset: 1, forecastHour: 12, comparator: ">=", threshold: 1500 },
    title: { en: "PV Forecast", de: "PV-Prognose", cn: "光伏预测" },
    description: {
      en: "Checks the hourly PV forecast for today or tomorrow and applies local shading correction.",
      de: "Prueft die stuendliche PV-Prognose fuer heute oder morgen und beruecksichtigt lokale Verschattungskorrektur.",
      cn: "检查今天或明天的小时级光伏预测，并叠加本地遮挡修正。",
    },
  },
  {
    key: "logic-and",
    kind: "condition",
    liveCapable: false,
    defaultPosition: { x: 430, y: 240 },
    defaultConfig: {},
    title: { en: "AND Gate", de: "UND-Logik", cn: "AND 条件" },
    description: {
      en: "All incoming trigger lines must be ready before the flow continues.",
      de: "Alle eingehenden Trigger muessen aktiv sein, bevor der Ablauf weitergeht.",
      cn: "所有输入触发都满足后，流程才会继续。",
    },
  },
  {
    key: "logic-or",
    kind: "condition",
    liveCapable: false,
    defaultPosition: { x: 430, y: 360 },
    defaultConfig: {},
    title: { en: "OR Gate", de: "ODER-Logik", cn: "OR 条件" },
    description: {
      en: "Any incoming trigger line can continue the flow.",
      de: "Jede eingehende Triggerlinie kann den Ablauf fortsetzen.",
      cn: "任意一个输入触发满足后，流程即可继续。",
    },
  },
  {
    key: "logic-not",
    kind: "condition",
    liveCapable: false,
    defaultPosition: { x: 430, y: 500 },
    defaultConfig: {},
    title: { en: "NOT Gate", de: "NICHT-Logik", cn: "NOT 条件" },
    description: {
      en: "Inverts the first incoming trigger result.",
      de: "Invertiert das Ergebnis des ersten eingehenden Triggers.",
      cn: "对第一个输入触发结果取反。",
    },
  },
  {
    key: "inverter-limit",
    kind: "action",
    liveCapable: true,
    defaultPosition: { x: 790, y: 240 },
    defaultConfig: { targetDeviceId: null, limitWatts: 800 },
    title: { en: "Set Inverter Limit", de: "Inverter-Limit setzen", cn: "设置逆变器限功率" },
    description: {
      en: "Executes the existing Sunlit remote-control power endpoint.",
      de: "Fuehrt den vorhandenen Sunlit-Remote-Control-Power-Endpunkt aus.",
      cn: "执行现有的 Sunlit 远程功率控制接口。",
    },
  },
  {
    key: "dashboard-note",
    kind: "action",
    liveCapable: false,
    defaultPosition: { x: 790, y: 400 },
    defaultConfig: { message: "Send dashboard note" },
    title: { en: "Dashboard Note", de: "Dashboard-Hinweis", cn: "面板通知" },
    description: {
      en: "Emits a local operator note into the execution log.",
      de: "Erzeugt einen lokalen Operator-Hinweis im Ausfuehrungsprotokoll.",
      cn: "在执行日志中生成一条本地操作通知。",
    },
  },
];

export const templateMap = new Map(templateDefinitions.map((template) => [template.key, template]));

export function compareValue(value: number | null | undefined, comparator: string, threshold: number) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return false;
  }

  return comparator === ">=" ? value >= threshold : value <= threshold;
}

export function formatWindow(start: number | null | undefined, end: number | null | undefined) {
  if (!start || !end) {
    return "--";
  }

  const formatter = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
    hour12: false,
  });

  return `${formatter.format(new Date(start))}-${formatter.format(new Date(end))}`;
}

export function weatherLabel(code: number | null | undefined, language: Language) {
  const labels = {
    en: {
      0: "Clear",
      1: "Mostly clear",
      2: "Partly cloudy",
      3: "Overcast",
      45: "Fog",
      61: "Rain",
      71: "Snow",
      95: "Thunderstorm",
    },
    de: {
      0: "Klar",
      1: "Meist klar",
      2: "Teilweise bewoelkt",
      3: "Bedeckt",
      45: "Nebel",
      61: "Regen",
      71: "Schnee",
      95: "Gewitter",
    },
    cn: {
      0: "晴朗",
      1: "基本晴朗",
      2: "局部多云",
      3: "阴天",
      45: "有雾",
      61: "下雨",
      71: "下雪",
      95: "雷暴",
    },
  };

  if (code === null || code === undefined) {
    return "--";
  }

  return labels[language][code as keyof typeof labels.en] || String(code);
}
