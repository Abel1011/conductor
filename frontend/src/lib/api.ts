export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000").replace(/\/$/, "");

export type Summary = {
  totalMar: number;
  totalBudget: number;
  budgetUsedPct: number;
  healthyConnections: number;
  openAlerts: number;
  executedActions: number;
  pendingApprovals: number;
  estimatedSavingsMar: number;
  estimatedSavingsUsd: number;
};

export type ConnectionTable = {
  schema: string;
  name: string;
  monthlyMar: number;
  queryCount30d: number;
  lastQueryAt: string | null;
  daysSinceLastQuery?: number | null;
  status: string;
};

export type SyncHistoryEntry = {
  id: string;
  connectionId: string;
  startedAt: string;
  endedAt: string;
  status: string;
  durationMin: number;
};

export type Connection = {
  id: string;
  name: string;
  displayName?: string;
  schemaName?: string | null;
  connectorType: string;
  teamOwner: string;
  teamSlackChannel: string;
  slaTier: string;
  lifecycleState: string;
  syncFrequencyMin: number;
  minSyncFrequencyMin: number;
  monthlyMarCurrent: number;
  monthlyMarBudget: number;
  avgSyncDurationMin: number;
  daysSinceLastQuery: number;
  updateState: string;
  isPaused: boolean;
  autoOptimize: boolean;
  costValueRatio: number;
  activeTables: number;
  coldTables: number;
  coldTablesList?: ConnectionTable[];
  lastSuccessfulSyncAt: string | null;
  projectedSavingsMar: number;
  budgetPct: number;
  healthStatus: string;
  marHistory: Array<{ date: string; mar: number }>;
  tables: ConnectionTable[];
  syncHistory: SyncHistoryEntry[];
  failureCount7d: number;
  consecutiveFailures: number;
  lastSyncStatus: string;
  policyConfigured: boolean;
};

export type AgentAction = {
  id: string;
  actionId?: string;
  timestamp: string;
  subAgent: string;
  connectionId: string;
  connectionName?: string | null;
  connectionSchemaName?: string | null;
  actionType: string;
  triggerEvent?: string | null;
  geminiReasoning?: string | null;
  status: string;
  impactMarBefore?: number | null;
  impactMarAfter?: number | null;
  actionPayload?: {
    estimatedMarSavings?: number;
    [key: string]: unknown;
  } | null;
};

export type Approval = {
  id: string;
  actionId: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  status: string;
  riskLevel: string;
  title: string;
  description: string;
  estimatedMarSavings: number;
  subAgent: string;
  connectionId: string;
  connectionName?: string | null;
  connectionSchemaName?: string | null;
  actionType: string;
  geminiReasoning: string;
  actionPayload?: {
    estimatedMarSavings?: number;
    [key: string]: unknown;
  } | null;
};

export type Alert = {
  id: string;
  createdAt: string;
  connectionId: string;
  severity: string;
  diagnosis: string;
  recommendedAction: string;
  status: string;
};

export type Policy = {
  connectionId: string;
  teamOwner: string;
  teamSlackChannel: string;
  slaTier: string;
  maxMonthlyMar: number;
  minSyncFrequencyMin: number;
  autoOptimize: boolean;
  schemaChangeProtection?: boolean;
  customPolicy?: string | null;
  updatedAt: string;
};

export type PortfolioResponse = {
  generatedAt: string;
  meta: {
    fivetranConfigured: boolean;
    hasPlatformMetadata: boolean;
    hasPolicies: boolean;
    rawDatasets: string[];
  };
  connections: Connection[];
};

export type ConnectionDetailResponse = Connection & {
  actions: AgentAction[];
};

export type WorkflowStep = {
  id: string;
  title: string;
  status: "DONE" | "CURRENT" | "PENDING";
  description: string;
};

export type WorkspaceContext = {
  mode: string;
  company: {
    name: string;
    operatingModel: string;
  };
  fivetran: {
    accountLabel: string;
    configuredFromEnv: boolean;
    connectionStatus: string;
    canDisconnect: boolean;
    integrationMode: string;
    connectorCount: number;
    connectorTypes: string[];
    explanation: string;
  };
  workflow: {
    currentStage: string;
    steps: WorkflowStep[];
  };
};

export type SpendTeam = {
  teamOwner: string;
  connections: number;
  monthlyMar: number;
  estimatedUsd: number;
  executedSavingsMar: number;
};

export type SpendResponse = {
  teams: SpendTeam[];
  marUsdPerMillion: number;
  estimated: boolean;
};

function apiUrl(path: string) {
  return `${API_BASE_URL}${path}`;
}

async function parseJsonResponse<T>(response: Response, path: string): Promise<T> {
  const text = await response.text();

  if (!response.ok) {
    let message = text || response.statusText;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      message = parsed.error || parsed.message || message;
    } catch {
      message = message.slice(0, 180);
    }
    throw new Error(`${path}: ${message}`);
  }

  if (!text) {
    return null as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${path}: expected JSON response.`);
  }
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), {
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers || {}),
    },
  });

  return parseJsonResponse<T>(response, path);
}

export async function postJson<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return fetchJson<T>(path, {
    method: "POST",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function getCommandCenterData() {
  const [summary, portfolio, approvals, alerts, workspaceContext, actions] = await Promise.all([
    fetchJson<Summary>("/api/portfolio/summary"),
    fetchJson<PortfolioResponse>("/api/portfolio"),
    fetchJson<{ approvals: Approval[] }>("/api/approvals"),
    fetchJson<{ alerts: Alert[] }>("/api/alerts"),
    fetchJson<WorkspaceContext>("/api/onboarding"),
    fetchJson<{ actions: AgentAction[] }>("/api/actions?limit=12"),
  ]);

  return {
    summary,
    portfolio,
    approvals: approvals.approvals,
    alerts: alerts.alerts,
    workspaceContext,
    actions: actions.actions,
  };
}

export async function getActions(limit = 20) {
  const response = await fetchJson<{ actions: AgentAction[] }>(`/api/actions?limit=${limit}`);
  return response.actions;
}

export function getPortfolio() {
  return fetchJson<PortfolioResponse>("/api/portfolio");
}

export function getConnectorDetail(connectionId: string) {
  return fetchJson<ConnectionDetailResponse>(`/api/connections/${encodeURIComponent(connectionId)}`);
}

export async function getApprovals() {
  const response = await fetchJson<{ approvals: Approval[] }>("/api/approvals");
  return response.approvals;
}

export async function getAlerts() {
  const response = await fetchJson<{ alerts: Alert[] }>("/api/alerts");
  return response.alerts;
}

export async function getPolicies() {
  const response = await fetchJson<{ policies: Policy[] }>("/api/policies");
  return response.policies;
}

export function getSpend() {
  return fetchJson<SpendResponse>("/api/spend");
}

export function getOnboarding() {
  return fetchJson<WorkspaceContext>("/api/onboarding");
}

export function approveApproval(id: string) {
  return postJson(`/api/approvals/${encodeURIComponent(id)}/approve`, {
    resolvedBy: "Local Operator",
  });
}

export function rejectApproval(id: string) {
  return postJson(`/api/approvals/${encodeURIComponent(id)}/reject`, {
    resolvedBy: "Local Operator",
  });
}

export function revertAction(id: string) {
  return postJson(`/api/actions/${encodeURIComponent(id)}/revert`);
}

export type NotificationChannelStatus = {
  configured: boolean;
  target: string | null;
};

export type NotificationSettings = {
  slack: NotificationChannelStatus;
  discord: NotificationChannelStatus;
  email: NotificationChannelStatus;
};

export function getNotificationSettings() {
  return fetchJson<{ channels: NotificationSettings }>("/api/notifications/settings").then(
    (response) => response.channels
  );
}

export function updatePolicy(connectionId: string, policy: Partial<Policy>) {
  return fetchJson<Policy>(`/api/connections/${encodeURIComponent(connectionId)}/policy`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(policy),
  });
}

export type GovernanceMode = "OBSERVE" | "ENFORCE";

export type TraceStep = {
  runId: string;
  seq: number;
  ts: string | { value: string };
  subAgent: string | null;
  stepType: "MISSION" | "TRANSFER" | "TOOL_CALL" | "TOOL_RESULT" | "REASONING" | string;
  toolName: string | null;
  content: string | null;
};

export function getTrace(runId: string) {
  return fetchJson<{ runId: string; steps: TraceStep[] }>(`/api/traces/${encodeURIComponent(runId)}`);
}

export type TraceRun = {
  runId: string;
  startedAt: string | { value: string };
  stepCount: number;
  toolCalls: number;
  subAgents: string[];
  mission: string | null;
};

export function getTraceRuns(limit = 10) {
  return fetchJson<{ runs: TraceRun[] }>(`/api/traces?limit=${limit}`).then((response) => response.runs);
}

export type SystemEvent = {
  id: string;
  timestamp: string;
  type: string;
  actionId?: string | null;
  connectionId?: string | null;
  eventType?: string | null;
  message?: string | null;
  payload?: unknown;
};

export function getEventsLog() {
  return fetchJson<{ events: SystemEvent[] }>("/api/events/log").then((response) => response.events);
}

export function getWorkspaceSettings() {
  return fetchJson<{ governanceMode: GovernanceMode }>("/api/settings");
}

export function updateWorkspaceSettings(settings: { governanceMode: GovernanceMode }) {
  return fetchJson<{ governanceMode: GovernanceMode }>("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}