const config = require("./config");
const bigquery = require("./bigquery");
const fivetran = require("./fivetran");

const CACHE_TTL_MS = 60_000;

const cache = {
  expiresAt: 0,
  snapshot: null
};

function toStatusValue(input) {
  return String(input || "").toUpperCase();
}

function normalizeApiConnection(raw) {
  return {
    connectionId: raw.id,
    connectionName: raw.connection_name || raw.schema || raw.id,
    connectorType: raw.service || raw.connector_type || "unknown",
    syncFrequencyMin: Number(raw.sync_frequency || raw.syncFrequency || 0),
    paused: Boolean(raw.paused),
    succeededAt: raw.succeeded_at || raw.succeededAt || raw.status?.succeeded_at || null,
    failedAt: raw.failed_at || raw.failedAt || raw.status?.failed_at || null,
    setupState: raw.status?.setup_state || raw.setup_state || null,
    syncState: raw.status?.sync_state || raw.sync_state || null,
    raw
  };
}

function daysSince(timestamp) {
  if (!timestamp) {
    return null;
  }

  const diff = Date.now() - new Date(timestamp).getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

function calculateHealth(connection) {
  if (!connection.policyConfigured) {
    return "PENDING_SETUP";
  }

  if (connection.isPaused) {
    return "PAUSED";
  }

  if (/FAILURE/i.test(connection.lastSyncStatus || "")) {
    return "FAILURE";
  }

  if (connection.lastSuccessfulSyncAt && connection.syncFrequencyMin > 0) {
    const minsSinceLastSuccess = Math.round((Date.now() - new Date(connection.lastSuccessfulSyncAt).getTime()) / 60_000);
    if (minsSinceLastSuccess > connection.syncFrequencyMin * 2) {
      return "DELAYED";
    }
  }

  if (connection.monthlyMarBudget > 0 && connection.monthlyMarCurrent > connection.monthlyMarBudget) {
    return "OVER_BUDGET";
  }

  if (connection.coldTables > 0) {
    return "HAS_COLD_TABLES";
  }

  return "HEALTHY";
}

function buildTableRows(marRows, usageMap) {
  return marRows.map((row) => {
    const usage = usageMap.get(`${row.schemaName}.${row.tableName}`);
    const lastQueryAt = usage?.lastQueryTs || null;
    const daysSinceLastQuery = daysSince(lastQueryAt);
    const cold = row.monthlyMar > 1000 && (daysSinceLastQuery === null || daysSinceLastQuery >= 30);

    return {
      schema: row.schemaName,
      name: row.tableName,
      monthlyMar: Number(row.monthlyMar || 0),
      queryCount30d: Number(usage?.queryCount30d || 0),
      lastQueryAt,
      daysSinceLastQuery,
      status: cold ? "HAS_COLD_TABLES" : "HEALTHY"
    };
  });
}

async function buildPortfolio(options = {}) {
  if (!options.force && cache.snapshot && cache.expiresAt > Date.now()) {
    return cache.snapshot;
  }

  const [apiConnections, metadataRows, marRows, marHistoryRows, syncStatsRows, usageRows, policies] = await Promise.all([
    config.fivetranConfigured ? fivetran.listConnections() : Promise.resolve([]),
    bigquery.getConnectionMetadata(),
    bigquery.getMarByConnection(),
    bigquery.getMarHistoryByConnection(),
    bigquery.getSyncStats(),
    bigquery.getTableUsage(),
    bigquery.getConnectionPolicies()
  ]);

  const apiById = new Map(apiConnections.map((connection) => [connection.id, normalizeApiConnection(connection)]));
  const metadataById = new Map(metadataRows.map((row) => [row.connectionId, row]));
  const syncById = new Map(syncStatsRows.map((row) => [row.connectionId, row]));
  const policyById = new Map(policies.map((row) => [row.connectionId, row]));
  const marByConnectionId = new Map();
  const historyByConnectionId = new Map();

  for (const row of marRows) {
    const current = marByConnectionId.get(row.connectionId) || [];
    current.push(row);
    marByConnectionId.set(row.connectionId, current);
  }

  for (const row of marHistoryRows) {
    const current = historyByConnectionId.get(row.connectionId) || [];
    current.push({ date: row.measuredMonth, mar: Number(row.monthlyMar || 0) });
    historyByConnectionId.set(row.connectionId, current);
  }

  const usageMap = new Map(
    usageRows.map((row) => [`${row.datasetId}.${row.tableId}`, row])
  );

  const connectionIds = [...new Set([
    ...apiById.keys(),
    ...metadataById.keys(),
    ...marByConnectionId.keys(),
    ...policyById.keys()
  ])];

  const connections = connectionIds.map((connectionId) => {
    const api = apiById.get(connectionId) || null;
    const metadata = metadataById.get(connectionId) || null;
    const syncStats = syncById.get(connectionId) || null;
    const policy = policyById.get(connectionId) || null;
    const marTables = marByConnectionId.get(connectionId) || [];
    const tables = buildTableRows(marTables, usageMap);
    const coldTables = tables.filter((table) => table.status === "HAS_COLD_TABLES");
    const monthlyMar = tables.reduce((sum, table) => sum + table.monthlyMar, 0);
    const monthlyMarBudget = Number(policy?.maxMonthlyMar || 0);
    const syncFrequencyMin = Number(metadata?.syncFrequencyMin || api?.syncFrequencyMin || policy?.minSyncFrequencyMin || 0);
    const lastSyncAt = syncStats?.lastSyncAt || metadata?.succeededAt || api?.succeededAt || metadata?.failedAt || api?.failedAt || null;
    const lastSyncStatus = toStatusValue(syncStats?.lastSyncStatus || api?.syncState || metadata?.syncState || "SUCCESSFUL");
    const projectedSavingsMar = coldTables.reduce((sum, table) => sum + table.monthlyMar, 0);

    const connection = {
      id: connectionId,
      name: metadata?.connectionName || api?.connectionName || connectionId,
      displayName: metadata?.connectionName || api?.connectionName || connectionId,
      schemaName: marTables[0]?.schema || null,
      connectorType: metadata?.connectorType || api?.connectorType || "unknown",
      teamOwner: policy?.teamOwner || "data-platform",
      teamSlackChannel: policy?.teamSlackChannel || "",
      slaTier: policy?.slaTier || "UNCONFIGURED",
      lifecycleState: policy ? "ACTIVE" : "PENDING_SETUP",
      syncFrequencyMin,
      minSyncFrequencyMin: Number(policy?.minSyncFrequencyMin || 0),
      monthlyMarCurrent: monthlyMar,
      monthlyMarBudget,
      avgSyncDurationMin: Number(syncStats?.avgDurationMin || 0),
      daysSinceLastQuery: coldTables[0]?.daysSinceLastQuery ?? 0,
      updateState: lastSyncStatus,
      isPaused: Boolean(metadata?.paused ?? api?.paused),
      autoOptimize: Boolean(policy?.autoOptimize),
      schemaChangeProtection: Boolean(policy?.schemaChangeProtection),
      customPolicy: policy?.customPolicy || null,
      costValueRatio: coldTables.length ? Number((monthlyMar / Math.max(1, coldTables.length)).toFixed(2)) : Number((monthlyMar / Math.max(1, tables.length)).toFixed(2)),
      activeTables: tables.length - coldTables.length,
      coldTables: coldTables.length,
      coldTablesList: coldTables,
      lastSuccessfulSyncAt: lastSyncAt,
      projectedSavingsMar,
      budgetPct: monthlyMarBudget > 0 ? Number(((monthlyMar / monthlyMarBudget) * 100).toFixed(1)) : 0,
      healthStatus: "HEALTHY",
      marHistory: historyByConnectionId.get(connectionId) || [],
      tables,
      syncHistory: [],
      failureCount7d: Number(syncStats?.failureCount7d || 0),
      consecutiveFailures: Number(syncStats?.consecutiveFailures || 0),
      lastSyncStatus,
      policyConfigured: Boolean(policy)
    };

    connection.healthStatus = calculateHealth(connection);
    return connection;
  }).sort((left, right) => right.monthlyMarCurrent - left.monthlyMarCurrent || left.name.localeCompare(right.name));

  const snapshot = {
    generatedAt: new Date().toISOString(),
    connections,
    meta: {
      fivetranConfigured: config.fivetranConfigured,
      hasPlatformMetadata: metadataRows.length > 0,
      hasPolicies: policies.length > 0,
      rawDatasets: config.rawDatasets
    }
  };

  cache.snapshot = snapshot;
  cache.expiresAt = Date.now() + CACHE_TTL_MS;
  return snapshot;
}

function invalidatePortfolioCache() {
  cache.snapshot = null;
  cache.expiresAt = 0;
}

async function getConnectionDetail(connectionId) {
  const snapshot = await buildPortfolio();
  const connection = snapshot.connections.find((item) => item.id === connectionId);

  if (!connection) {
    return null;
  }

  const syncHistory = await bigquery.getConnectionSyncHistory(connectionId, 12);
  return {
    ...connection,
    syncHistory
  };
}

async function buildOnboardingContext() {
  const [{ connections, meta }, policies] = await Promise.all([
    buildPortfolio(),
    bigquery.getConnectionPolicies()
  ]);

  const configuredPolicies = policies.length;
  const allConnectionsConfigured = connections.length > 0 && connections.every((connection) => connection.policyConfigured);
  const currentStage = !config.fivetranConfigured
    ? "CONNECT"
    : connections.length === 0
      ? "DISCOVER"
      : allConnectionsConfigured
        ? "OPERATE"
        : "CONFIGURE";

  return {
    mode: "real-fivetran-ops",
    company: {
      name: config.companyName,
      operatingModel: "single-company"
    },
    fivetran: {
      accountLabel: config.accountLabel,
      configuredFromEnv: config.fivetranConfigured,
      connectionStatus: !config.fivetranConfigured
        ? "MISSING_ENV_CONFIGURATION"
        : connections.length === 0
          ? "CONNECTED_NO_CONNECTORS"
          : "CONNECTED",
      canDisconnect: false,
      integrationMode: "REAL_CONNECTORS_ONLY",
      connectorCount: connections.length,
      connectorTypes: [...new Set(connections.map((connection) => connection.connectorType))],
      explanation: meta.hasPlatformMetadata
        ? "Conductor reads real connector usage from Fivetran's Platform Connector and applies real governance actions through the Fivetran API."
        : "Fivetran credentials are configured, but the Platform Connector has not populated metadata yet. Create it first to unlock real MAR analysis."
    },
    workflow: {
      currentStage,
      steps: [
        {
          id: "connect-account",
          title: "Connect the Fivetran account",
          status: config.fivetranConfigured ? "DONE" : "PENDING",
          description: config.fivetranConfigured
            ? "Fivetran credentials are present in the backend environment."
            : "Add Fivetran API credentials to the backend environment and Secret Manager."
        },
        {
          id: "discover-connectors",
          title: "Discover real connectors",
          status: connections.length > 0 ? "DONE" : (config.fivetranConfigured ? "CURRENT" : "PENDING"),
          description: connections.length > 0
            ? `${connections.length} real connectors were discovered from the Fivetran account.`
            : "No connectors were found yet. Create the Postgres, Google Sheets, and Platform connectors in Fivetran."
        },
        {
          id: "configure-policies",
          title: "Configure governance policies",
          status: allConnectionsConfigured ? "DONE" : (connections.length > 0 ? "CURRENT" : "PENDING"),
          description: allConnectionsConfigured
            ? `${configuredPolicies} policies are active across the discovered connectors.`
            : "Assign budgets, SLA tiers, and automation settings before enabling agent actions."
        }
      ]
    }
  };
}

module.exports = {
  buildOnboardingContext,
  buildPortfolio,
  getConnectionDetail,
  invalidatePortfolioCache
};