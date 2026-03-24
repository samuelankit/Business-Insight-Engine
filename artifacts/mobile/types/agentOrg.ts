export interface ArchetypeKPI {
  key: string;
  label: string;
  unit: string;
  source: string;
  sourceField?: string;
}

export interface ArchetypeInfo {
  title: string;
  department: string;
  iconIdentifier: string;
  departmentColour: string;
  summary: string;
  responsibilities?: string[];
  kpis?: ArchetypeKPI[];
}

export interface OrgNode {
  index: number;
  archetypeSlug: string;
  humanName: string;
  roleSummary: string;
  parentIndex: number | null;
  locked: boolean;
  archetype: ArchetypeInfo | null;
}

export interface GeneratedOrg {
  orgName: string;
  vertical: string;
  agentLimit: number;
  tierLimitReached: boolean;
  trimmedCount: number;
  nodes: OrgNode[];
}

export interface ChartNode {
  id: string;
  humanName: string;
  archetypeSlug: string;
  parentNodeId: string | null;
  department: string;
  roleSummary: string;
  statusIndicator?: "green" | "amber" | "red";
  locked?: boolean;
  archetype?: ArchetypeInfo | null;
  topKpi?: { label: string; formattedValue: string };
}

export interface TrendDay {
  date: string;
  runs: number;
}

export interface KPIValue {
  key: string;
  label: string;
  unit: string;
  value: number;
  formattedValue: string;
}

export interface RecentRunLog {
  id: string;
  summary: string;
  actions: string[];
  ranAt: string;
  status: "success";
}

export interface NodePerformance {
  nodeId: string;
  humanName: string;
  agentId: string;
  archetypeSlug: string;
  totalRuns: number;
  successfulRuns: number;
  successRate: number;
  lastRunAt: string | null;
  lastOutput: string | null;
  statusIndicator: "green" | "amber" | "red";
  kpis: KPIValue[];
  trendLast30Days: TrendDay[];
  recentLogs: RecentRunLog[];
  assessmentParagraph: string | null;
  assessmentCachedAt: string | null;
  cached?: boolean;
}

export interface IllustrativeStat {
  label: string;
  value: string;
}

export interface GorigoNode {
  id: string;
  humanName: string;
  archetypeSlug: string;
  parentNodeId: string | null;
  department: string;
  roleSummary: string;
  statusIndicator: "green" | "amber" | "red";
  archetype: ArchetypeInfo;
  illustrativeStats?: IllustrativeStat[];
}

export interface WebViewNodeMessage {
  type: "node_tap";
  nodeId: string;
}
