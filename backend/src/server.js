const { createHmac, randomUUID, timingSafeEqual } = require("node:crypto");
const cors = require("cors");
const dotenv = require("dotenv");
const express = require("express");

dotenv.config();

const { executeAction, rejectAction, revertAction } = require("./lib/actions");
const { analyzeConnections } = require("./lib/analyzer");
const bigquery = require("./lib/bigquery");
const config = require("./lib/config");
const events = require("./lib/events");
const fivetran = require("./lib/fivetran");
const notifications = require("./lib/notifications");
const {
  buildOnboardingContext,
  buildPortfolio,
  getConnectionDetail,
  invalidatePortfolioCache
} = require("./lib/portfolio");

const app = express();

function asyncHandler(handler) {
  return async (request, response, next) => {
    try {
      await handler(request, response, next);
    } catch (error) {
      next(error);
    }
  };
}

function requireInternalSecret(request, response, next) {
  if (request.header("x-internal-secret") !== config.internalTriggerSecret) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

function validateWebhookSignature(rawBody, signatureHeader) {
  if (!config.webhookSecret) {
    return false;
  }

  const signatureValue = String(signatureHeader || "");
  const normalizedSignature = signatureValue.includes("=")
    ? signatureValue.split("=").slice(1).join("=")
    : signatureValue;
  const digestHex = createHmac("sha256", config.webhookSecret).update(rawBody).digest("hex");
  const digestBase64 = createHmac("sha256", config.webhookSecret).update(rawBody).digest("base64");
  const signature = Buffer.from(normalizedSignature);

  return [digestHex, digestBase64].some((candidate) => {
    const candidateBuffer = Buffer.from(candidate);
    return candidateBuffer.length === signature.length && timingSafeEqual(candidateBuffer, signature);
  });
}

function deriveSummary(connections, approvals, actions, alerts) {
  const totalMar = connections.reduce((sum, connection) => sum + connection.monthlyMarCurrent, 0);
  const totalBudget = connections.reduce((sum, connection) => sum + connection.monthlyMarBudget, 0);
  const pendingSavingsMar = approvals.reduce((sum, approval) => sum + Number(approval.estimatedMarSavings || 0), 0);
  const executedSavingsMar = actions
    .filter((action) => action.status === "EXECUTED")
    .reduce((sum, action) => sum + Number(action.actionPayload?.estimatedMarSavings || 0), 0);
  const estimatedSavingsMar = pendingSavingsMar + executedSavingsMar;

  return {
    totalMar,
    totalBudget,
    budgetUsedPct: totalBudget > 0 ? Number(((totalMar / totalBudget) * 100).toFixed(1)) : 0,
    healthyConnections: connections.filter((connection) => connection.healthStatus === "HEALTHY").length,
    openAlerts: alerts.filter((alert) => alert.status === "OPEN").length,
    executedActions: actions.filter((action) => action.status === "EXECUTED").length,
    pendingApprovals: approvals.length,
    estimatedSavingsMar,
    estimatedSavingsUsd: Number(((estimatedSavingsMar / 1000000) * config.marUsdPerMillion).toFixed(2))
  };
}

function createDefaultPolicy(connectionId) {
  return bigquery.upsertConnectionPolicy({
    connectionId,
    teamOwner: "data-platform",
    teamSlackChannel: "",
    slaTier: "STANDARD",
    maxMonthlyMar: 50000,
    minSyncFrequencyMin: 60,
    autoOptimize: false
  });
}

function readValue(source, ...keys) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null && source[key] !== "") {
      return source[key];
    }
  }

  return undefined;
}

function requireValue(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    const error = new Error(`${fieldName} is required.`);
    error.statusCode = 400;
    throw error;
  }

  return value;
}

function toInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getMonthStart(value) {
  if (!value) {
    const current = new Date();
    return `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }

  if (/^\d{4}-\d{2}$/.test(value)) {
    return `${value}-01`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const error = new Error("month must be provided as YYYY-MM or YYYY-MM-DD.");
  error.statusCode = 400;
  throw error;
}

function buildTopConnectionFields(connections) {
  const topConnections = Array.isArray(connections) ? connections.slice(0, 3) : [];
  return {
    topConnection1: topConnections[0]?.connectionName || topConnections[0]?.name || null,
    topConnection1Mar: Number(topConnections[0]?.monthlyMar || 0),
    topConnection2: topConnections[1]?.connectionName || topConnections[1]?.name || null,
    topConnection2Mar: Number(topConnections[1]?.monthlyMar || 0),
    topConnection3: topConnections[2]?.connectionName || topConnections[2]?.name || null,
    topConnection3Mar: Number(topConnections[2]?.monthlyMar || 0)
  };
}

async function buildConnectionHistory(connectionId) {
  const [connection, actions, alerts, policy] = await Promise.all([
    getConnectionDetail(connectionId),
    bigquery.listActions({ limit: 50, connectionId }),
    bigquery.listAlerts(),
    bigquery.getConnectionPolicy(connectionId)
  ]);

  if (!connection) {
    return null;
  }

  return {
    connection,
    policy,
    actions,
    alerts: alerts.filter((alert) => alert.connectionId === connectionId)
  };
}

function simulateOptimizationImpact(connection, actionType, params = {}) {
  const currentMar = Number(connection?.monthlyMarCurrent || 0);
  const normalizedActionType = String(actionType || "").toUpperCase();

  if (!connection) {
    return {
      actionType: normalizedActionType,
      estimatedMarBefore: 0,
      estimatedMarAfter: 0,
      estimatedSavingsMar: 0,
      estimateType: "NO_CONNECTION_CONTEXT",
      notes: ["Connection context was not found."]
    };
  }

  if (normalizedActionType === "CHANGE_FREQUENCY") {
    const newSyncFrequencyMin = toInteger(readValue(params, "newSyncFrequencyMin", "frequencyMin", "new_sync_frequency_min"));
    if (newSyncFrequencyMin <= 0 || connection.syncFrequencyMin <= 0) {
      return {
        actionType: normalizedActionType,
        estimatedMarBefore: currentMar,
        estimatedMarAfter: currentMar,
        estimatedSavingsMar: 0,
        estimateType: "INSUFFICIENT_FREQUENCY_INPUT",
        notes: ["A positive target sync frequency is required to estimate impact."]
      };
    }

    const ratio = Math.min(1, connection.syncFrequencyMin / newSyncFrequencyMin);
    const estimatedMarAfter = Math.round(currentMar * ratio);
    return {
      actionType: normalizedActionType,
      estimatedMarBefore: currentMar,
      estimatedMarAfter,
      estimatedSavingsMar: Math.max(0, currentMar - estimatedMarAfter),
      estimateType: "FREQUENCY_RATIO_ESTIMATE",
      notes: ["Estimate assumes MAR scales with sync frequency as an upper-bound heuristic."]
    };
  }

  if (normalizedActionType === "BLOCK_TABLE") {
    const requestedTables = Array.isArray(params.tables)
      ? params.tables
      : [{
          schemaName: readValue(params, "schemaName", "schema", "schema_name"),
          tableName: readValue(params, "tableName", "table", "table_name")
        }];
    const matchedTables = requestedTables
      .filter((table) => table.schemaName && table.tableName)
      .map((table) => connection.tables.find((item) => item.schema === table.schemaName && item.name === table.tableName))
      .filter(Boolean);
    const estimatedSavingsMar = matchedTables.reduce((sum, table) => sum + Number(table.monthlyMar || 0), 0);

    return {
      actionType: normalizedActionType,
      estimatedMarBefore: currentMar,
      estimatedMarAfter: Math.max(0, currentMar - estimatedSavingsMar),
      estimatedSavingsMar,
      estimateType: "TABLE_LEVEL_OBSERVED_MAR",
      tables: matchedTables.map((table) => ({
        schema: table.schema,
        name: table.name,
        monthlyMar: table.monthlyMar
      })),
      notes: ["Estimate is based on observed current-month MAR for the targeted tables."]
    };
  }

  if (normalizedActionType === "BLOCK_COLUMN") {
    return {
      actionType: normalizedActionType,
      estimatedMarBefore: currentMar,
      estimatedMarAfter: currentMar,
      estimatedSavingsMar: null,
      estimateType: "COLUMN_LEVEL_NOT_OBSERVABLE",
      notes: ["Current telemetry is table-level, so column-level MAR impact cannot be estimated honestly."]
    };
  }

  if (normalizedActionType === "PAUSE") {
    return {
      actionType: normalizedActionType,
      estimatedMarBefore: currentMar,
      estimatedMarAfter: 0,
      estimatedSavingsMar: currentMar,
      estimateType: "FULL_MONTH_UPPER_BOUND",
      notes: ["This is an upper bound assuming the connector remains paused for the remainder of the billing period."]
    };
  }

  return {
    actionType: normalizedActionType,
    estimatedMarBefore: currentMar,
    estimatedMarAfter: currentMar,
    estimatedSavingsMar: 0,
    estimateType: "NO_DIRECT_MODEL",
    notes: ["No direct impact model is defined for this action type."]
  };
}

function getToolManifest() {
  return [
    { method: "GET", path: "/tools/portfolio", playbooks: ["Cost", "Chat"] },
    { method: "GET", path: "/tools/portfolio-summary", playbooks: ["Chat"] },
    { method: "GET", path: "/tools/similar-connections", playbooks: ["Gate"] },
    { method: "GET", path: "/tools/bq-query-activity", playbooks: ["Cost"] },
    { method: "GET", path: "/tools/sync-history", playbooks: ["Perf"] },
    { method: "GET", path: "/tools/connection-schema", playbooks: ["Perf"] },
    { method: "GET", path: "/tools/action-details", playbooks: ["Chat"] },
    { method: "GET", path: "/tools/connection-history", playbooks: ["Chat"] },
    { method: "GET", path: "/tools/monthly-mar-by-team", playbooks: ["Chargeback"] },
    { method: "GET", path: "/tools/pending-approvals", playbooks: ["Chargeback"] },
    { method: "GET", path: "/tools/estimate-cost-usd", playbooks: ["Chargeback"] },
    { method: "POST", path: "/tools/simulate-optimization-impact", playbooks: ["Chat"] },
    { method: "POST", path: "/tools/patch-frequency", playbooks: ["Cost"] },
    { method: "POST", path: "/tools/disable-table", playbooks: ["Cost", "Perf"] },
    { method: "POST", path: "/tools/block-column", playbooks: ["Cost"] },
    { method: "POST", path: "/tools/pause-connection", playbooks: ["Perf"] },
    { method: "POST", path: "/tools/reload-schema", playbooks: ["Perf"] },
    { method: "POST", path: "/tools/create-approval", playbooks: ["Gate", "Cost", "Perf"] },
    { method: "POST", path: "/tools/log-action", playbooks: ["Gate", "Cost", "Perf", "Chargeback"] },
    { method: "POST", path: "/tools/append-trace", playbooks: ["Gate", "Cost", "Perf", "Chargeback"] },
    { method: "POST", path: "/tools/create-alert", playbooks: ["Perf"] },
    { method: "POST", path: "/tools/write-chargeback", playbooks: ["Chargeback"] },
    { method: "POST", path: "/tools/trigger-activations", playbooks: ["Chargeback"] }
  ];
}

app.use(cors());

app.post("/webhook/fivetran", express.raw({ type: "*/*" }), asyncHandler(async (request, response) => {
  const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.from(request.body || "");
  const signature = request.header("x-fivetran-signature-256") || request.header("x-fivetran-signature");

  if (!validateWebhookSignature(rawBody, signature)) {
    response.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  const payload = JSON.parse(rawBody.toString("utf8") || "{}");
  response.status(200).json({ accepted: true });

  setImmediate(async () => {
    try {
      const eventType = payload.eventType || payload.event || payload.type || "unknown";
      const connectionId = payload.connector_id || payload.connectionId || payload.data?.connector_id || payload.data?.connection_id || null;

      events.publish("webhook_received", {
        eventType,
        connectionId,
        message: `Received ${eventType}${connectionId ? ` for ${connectionId}` : ""}`,
        payload
      });

      invalidatePortfolioCache();

      if (eventType === "create_connector" && connectionId) {
        await createDefaultPolicy(connectionId);

        let connectorLabel = connectionId;
        let connectorService = null;
        try {
          const conn = await fivetran.getConnection(connectionId);
          if (conn?.schema) connectorLabel = conn.schema;
          if (conn?.service) connectorService = conn.service;
        } catch (detailsError) {
          console.error(`Could not fetch details for ${connectionId}`, detailsError.message);
        }
        const connectorDisplay = connectorService ? `${connectorLabel} (${connectorService})` : connectorLabel;

        const governanceMode = (await bigquery.getWorkspaceSetting("governance_mode")) || "OBSERVE";
        const enforced = governanceMode === "ENFORCE";

        if (enforced) {
          try {
            await fivetran.setPaused(connectionId, true);
            events.publish("connector_paused", {
              connectionId,
              message: `GATE: enforce mode paused new connector ${connectorDisplay} until approval`
            });
          } catch (pauseError) {
            console.error(`Enforce pause failed for ${connectionId}`, pauseError);
          }
          // Fivetran can flip the connector back to active when Save & Test completes
          // after our webhook fires. Re-assert the pause a couple of times.
          for (const delayMs of [15000, 45000]) {
            setTimeout(async () => {
              try {
                const conn = await fivetran.getConnection(connectionId);
                const pending = await bigquery.listApprovals("PENDING");
                const stillPending = pending.some((a) => a.connectionId === connectionId && a.actionType === "REVIEW_NEW_CONNECTOR");
                if (conn && conn.paused === false && stillPending) {
                  await fivetran.setPaused(connectionId, true);
                  events.publish("connector_paused", {
                    connectionId,
                    message: `GATE: re-paused ${connectorDisplay} (Fivetran re-activated it after setup test)`
                  });
                }
              } catch (recheckError) {
                console.error(`Gate re-pause check failed for ${connectionId}`, recheckError.message);
              }
            }, delayMs);
          }
        }

        const gateActionId = randomUUID();
        const gateRunId = randomUUID();
        const gateTimestamp = new Date().toISOString();
        await bigquery.insertTraceSteps(gateRunId, [
          { subAgent: "ORCHESTRATOR", stepType: "MISSION", content: `Govern new connector ${connectorDisplay} reported by Fivetran webhook (create_connector).` },
          { subAgent: "ORCHESTRATOR", stepType: "TRANSFER", content: `Handing ${connectorDisplay} to GATE sub-agent. Governance mode: ${governanceMode}.` },
          { subAgent: "GATE", stepType: "TOOL_CALL", toolName: "apply_default_policy", content: JSON.stringify({ connectionId, slaTier: "STANDARD", marBudget: 50000, minFrequencyMin: 60 }) },
          ...(enforced
            ? [{ subAgent: "GATE", stepType: "TOOL_CALL", toolName: "pause_connector", content: `Enforce mode: ${connectorDisplay} paused before its first sync.` }]
            : [{ subAgent: "GATE", stepType: "REASONING", content: "Observe mode: connector keeps syncing while the review is pending." }]),
          { subAgent: "GATE", stepType: "TOOL_CALL", toolName: "create_approval", content: JSON.stringify({ actionType: "REVIEW_NEW_CONNECTOR", riskLevel: "MEDIUM", connectionId }) }
        ]).catch((error) => console.error("Failed to persist GATE trace", error.message));
        await bigquery.insertAction({
          actionId: gateActionId,
          timestamp: gateTimestamp,
          subAgent: "GATE",
          connectionId,
          actionType: "REVIEW_NEW_CONNECTOR",
          actionPayload: { source: "webhook:create_connector", enforced, runId: gateRunId },
          triggerEvent: "create_connector",
          geminiReasoning: null,
          status: "PENDING_APPROVAL",
          impactMarBefore: null,
          impactMarAfter: null
        });
        await bigquery.insertApproval({
          approvalId: randomUUID(),
          actionId: gateActionId,
          tsCreated: gateTimestamp,
          status: "PENDING",
          riskLevel: "MEDIUM",
          title: `Review new connector ${connectorDisplay}`,
          description: enforced
            ? `A new connector \"${connectorLabel}\"${connectorService ? ` (${connectorService})` : ""} was created in Fivetran (id: ${connectionId}). Governance mode is ENFORCE, so it was paused immediately and will not sync until approved. A default STANDARD policy was applied (50,000 MAR budget, min frequency 60m, auto-optimize off). Approving will unpause the connector.`
            : `A new connector \"${connectorLabel}\"${connectorService ? ` (${connectorService})` : ""} was created in Fivetran (id: ${connectionId}). A default STANDARD policy was applied (50,000 MAR budget, min frequency 60m, auto-optimize off). Review ownership, budget and sync frequency before it accrues cost.`,
          estimatedMarSavings: 0
        });
        events.publish("approval_created", {
          connectionId,
          message: enforced
            ? `GATE: new connector ${connectorDisplay} paused pending review (enforce mode)`
            : `GATE: review queued for new connector ${connectorDisplay}`
        });
      }

      if (eventType === "sync_end" && connectionId) {
        const status = String(payload.data?.status || payload.status || "").toUpperCase();
        if (/FAILURE/.test(status)) {
          await bigquery.createAlert({
            alertId: randomUUID(),
            createdAt: new Date().toISOString(),
            connectionId,
            severity: "CRITICAL",
            diagnosis: `Fivetran reported sync_end with status ${status}.`,
            recommendedAction: "Inspect source health and review whether the connector should be paused.",
            status: "OPEN"
          });
          events.publish("alert_created", {
            connectionId,
            message: `Critical alert created for ${connectionId}`
          });
        }

        await analyzeConnections(connectionId);
      }

      if (/schema/i.test(eventType) && connectionId) {
        const policy = await bigquery.getConnectionPolicy(connectionId);
        if (policy?.schemaChangeProtection) {
          const changeSummary =
            payload.data?.message ||
            payload.message ||
            `Fivetran reported a schema event (${eventType}).`;
          const gateActionId = randomUUID();
          const gateRunId = randomUUID();
          const gateTimestamp = new Date().toISOString();
          await bigquery.insertTraceSteps(gateRunId, [
            { subAgent: "ORCHESTRATOR", stepType: "MISSION", content: `Review schema event (${eventType}) on ${connectionId} reported by Fivetran webhook.` },
            { subAgent: "ORCHESTRATOR", stepType: "TRANSFER", content: `Schema change protection is enabled for ${connectionId}: handing to GATE sub-agent.` },
            { subAgent: "GATE", stepType: "REASONING", content: `${changeSummary} New tables or columns may increase MAR; the change must be reviewed before propagating downstream.` },
            { subAgent: "GATE", stepType: "TOOL_CALL", toolName: "create_approval", content: JSON.stringify({ actionType: "REVIEW_SCHEMA_CHANGE", riskLevel: "MEDIUM", connectionId }) }
          ]).catch((error) => console.error("Failed to persist GATE trace", error.message));
          await bigquery.insertAction({
            actionId: gateActionId,
            timestamp: gateTimestamp,
            subAgent: "GATE",
            connectionId,
            actionType: "REVIEW_SCHEMA_CHANGE",
            actionPayload: { source: `webhook:${eventType}`, changeSummary, runId: gateRunId },
            triggerEvent: eventType,
            geminiReasoning: null,
            status: "PENDING_APPROVAL",
            impactMarBefore: null,
            impactMarAfter: null
          });
          await bigquery.insertApproval({
            approvalId: randomUUID(),
            actionId: gateActionId,
            tsCreated: gateTimestamp,
            status: "PENDING",
            riskLevel: "MEDIUM",
            title: `Schema change detected on ${connectionId}`,
            description: `Schema change protection is enabled for this connector. ${changeSummary} Review the change before it propagates downstream; new tables/columns may increase MAR.`,
            estimatedMarSavings: 0
          });
          events.publish("approval_created", {
            connectionId,
            message: `GATE: schema change on ${connectionId} queued for review (protection enabled)`
          });
        }
      }

      if (eventType === "connection_failure" && connectionId) {
        await bigquery.createAlert({
          alertId: randomUUID(),
          createdAt: new Date().toISOString(),
          connectionId,
          severity: "CRITICAL",
          diagnosis: payload.data?.message || payload.message || "Fivetran reported a connection failure.",
          recommendedAction: "Review the failing connector and source credentials immediately.",
          status: "OPEN"
        });
        events.publish("alert_created", {
          connectionId,
          message: `Connection failure alert created for ${connectionId}`
        });
      }
    } catch (error) {
      console.error("Webhook processing failed", error);
      events.publish("webhook_error", {
        message: error.message
      });
    }
  });
}));

app.use(express.json({ limit: "1mb" }));

app.get("/", asyncHandler(async (request, response) => {
  const [{ connections }, approvals, actions, alerts] = await Promise.all([
    buildPortfolio(),
    bigquery.listApprovals("PENDING"),
    bigquery.listActions({ limit: 20 }),
    bigquery.listAlerts()
  ]);

  response.json({
    service: "conductor-backend",
    status: "ok",
    summary: deriveSummary(connections, approvals, actions, alerts)
  });
}));

app.get("/health", (request, response) => {
  response.json({
    ok: true,
    service: "conductor-backend",
    time: new Date().toISOString(),
    fivetranConfigured: config.fivetranConfigured,
    bigqueryProjectId: config.bigqueryProjectId,
    datasets: {
      conductor: config.conductorDataset,
      fivetranMetadata: config.fivetranMetadataDataset,
      raw: config.rawDatasets
    }
  });
});

app.get("/api/events", (request, response) => {
  events.connect(request, response);
});

app.get("/api/events/log", (request, response) => {
  response.json({ events: events.listEvents() });
});

app.get("/api/onboarding", asyncHandler(async (request, response) => {
  response.json(await buildOnboardingContext());
}));

app.get("/api/portfolio", asyncHandler(async (request, response) => {
  const snapshot = await buildPortfolio();
  response.json({
    generatedAt: snapshot.generatedAt,
    meta: snapshot.meta,
    connections: snapshot.connections
  });
}));

app.get("/api/portfolio/summary", asyncHandler(async (request, response) => {
  const [{ connections }, approvals, actions, alerts] = await Promise.all([
    buildPortfolio(),
    bigquery.listApprovals("PENDING"),
    bigquery.listActions({ limit: 50 }),
    bigquery.listAlerts()
  ]);

  response.json(deriveSummary(connections, approvals, actions, alerts));
}));

app.get("/api/connections/:id", asyncHandler(async (request, response) => {
  const [connection, actions] = await Promise.all([
    getConnectionDetail(request.params.id),
    bigquery.listActions({ limit: 20, connectionId: request.params.id })
  ]);

  if (!connection) {
    response.status(404).json({ error: "Connection not found" });
    return;
  }

  response.json({
    ...connection,
    actions
  });
}));

app.get("/api/policies", asyncHandler(async (request, response) => {
  response.json({ policies: await bigquery.getConnectionPolicies() });
}));

app.get("/api/settings", asyncHandler(async (request, response) => {
  const governanceMode = (await bigquery.getWorkspaceSetting("governance_mode")) || "OBSERVE";
  response.json({ governanceMode });
}));

app.get("/api/notifications/settings", asyncHandler(async (request, response) => {
  response.json({ channels: notifications.getChannelStatus() });
}));

app.put("/api/settings", asyncHandler(async (request, response) => {
  const governanceMode = String(request.body?.governanceMode || "").toUpperCase();
  if (!["OBSERVE", "ENFORCE"].includes(governanceMode)) {
    response.status(400).json({ error: "governanceMode must be OBSERVE or ENFORCE." });
    return;
  }

  await bigquery.setWorkspaceSetting("governance_mode", governanceMode);
  events.publish("settings_updated", {
    message: `Governance mode set to ${governanceMode}`
  });
  response.json({ governanceMode });
}));

app.put("/api/connections/:id/policy", asyncHandler(async (request, response) => {
  const current = await bigquery.getConnectionPolicy(request.params.id);
  const nextPolicy = {
    connectionId: request.params.id,
    teamOwner: request.body.teamOwner || current?.teamOwner || "data-platform",
    teamSlackChannel: request.body.teamSlackChannel ?? current?.teamSlackChannel ?? "",
    slaTier: request.body.slaTier || current?.slaTier || "STANDARD",
    maxMonthlyMar: Number(request.body.maxMonthlyMar ?? current?.maxMonthlyMar ?? 0),
    minSyncFrequencyMin: Number(request.body.minSyncFrequencyMin ?? current?.minSyncFrequencyMin ?? 60),
    autoOptimize: Boolean(request.body.autoOptimize ?? current?.autoOptimize ?? false),
    schemaChangeProtection: Boolean(request.body.schemaChangeProtection ?? current?.schemaChangeProtection ?? false),
    customPolicy: String(request.body.customPolicy ?? current?.customPolicy ?? "").slice(0, 2000) || null
  };

  const saved = await bigquery.upsertConnectionPolicy(nextPolicy);
  invalidatePortfolioCache();
  events.publish("policy_updated", {
    connectionId: request.params.id,
    message: `Policy updated for ${request.params.id}`
  });
  response.json(saved);
}));

app.get("/api/approvals", asyncHandler(async (request, response) => {
  response.json({ approvals: await bigquery.listApprovals("PENDING") });
}));

app.post("/api/approvals/:id/approve", asyncHandler(async (request, response) => {
  const approval = await bigquery.getApprovalById(request.params.id);
  if (!approval) {
    response.status(404).json({ error: "Approval not found" });
    return;
  }

  await bigquery.resolveApproval(request.params.id, "APPROVED", request.body?.resolvedBy || "Local Operator");
  const action = await executeAction(approval.actionId);
  response.json({ approvalId: request.params.id, action });
}));

app.post("/api/approvals/:id/reject", asyncHandler(async (request, response) => {
  const approval = await bigquery.getApprovalById(request.params.id);
  if (!approval) {
    response.status(404).json({ error: "Approval not found" });
    return;
  }

  await bigquery.resolveApproval(request.params.id, "REJECTED", request.body?.resolvedBy || "Local Operator");
  await rejectAction(approval.actionId);
  response.json({ approvalId: request.params.id, status: "REJECTED" });
}));

app.get("/api/traces", asyncHandler(async (request, response) => {
  response.json({ runs: await bigquery.listTraceRuns(Number(request.query.limit || 10)) });
}));

app.get("/api/traces/:runId", asyncHandler(async (request, response) => {
  response.json({ runId: request.params.runId, steps: await bigquery.getTraceByRunId(request.params.runId) });
}));

app.get("/api/actions", asyncHandler(async (request, response) => {
  response.json({
    actions: await bigquery.listActions({
      limit: Number(request.query.limit || 20),
      connectionId: request.query.connectionId || null
    })
  });
}));

app.post("/api/actions/:id/revert", asyncHandler(async (request, response) => {
  try {
    const action = await revertAction(request.params.id);
    response.json({ actionId: request.params.id, action });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
}));

app.get("/api/alerts", asyncHandler(async (request, response) => {
  response.json({ alerts: await bigquery.listAlerts() });
}));

app.post("/api/alerts/:id/acknowledge", asyncHandler(async (request, response) => {
  await bigquery.acknowledgeAlert(request.params.id);
  response.json({ id: request.params.id, status: "ACKNOWLEDGED" });
}));

app.get("/api/spend", asyncHandler(async (request, response) => {
  const [snapshot, actions] = await Promise.all([
    buildPortfolio(),
    bigquery.listActions({ limit: 100 })
  ]);

  const teams = new Map();
  for (const connection of snapshot.connections) {
    const existing = teams.get(connection.teamOwner) || {
      teamOwner: connection.teamOwner,
      connections: 0,
      monthlyMar: 0,
      estimatedUsd: 0,
      executedSavingsMar: 0
    };

    existing.connections += 1;
    existing.monthlyMar += connection.monthlyMarCurrent;
    existing.estimatedUsd = Number(((existing.monthlyMar / 1000000) * config.marUsdPerMillion).toFixed(2));
    teams.set(connection.teamOwner, existing);
  }

  for (const action of actions.filter((item) => item.status === "EXECUTED")) {
    const connection = snapshot.connections.find((item) => item.id === action.connectionId);
    if (!connection) {
      continue;
    }

    const team = teams.get(connection.teamOwner);
    if (!team) {
      continue;
    }

    team.executedSavingsMar += Number(action.actionPayload?.estimatedMarSavings || 0);
  }

  response.json({
    teams: [...teams.values()].sort((left, right) => right.monthlyMar - left.monthlyMar),
    marUsdPerMillion: config.marUsdPerMillion,
    estimated: true
  });
}));

app.get("/tools", (request, response) => {
  response.json({
    mode: "agent-builder-http-tools",
    tools: getToolManifest()
  });
});

app.get("/tools/portfolio", asyncHandler(async (request, response) => {
  response.json(await buildPortfolio({ force: request.query.force === "true" }));
}));

app.get("/tools/portfolio-summary", asyncHandler(async (request, response) => {
  const [{ connections }, approvals, actions, alerts] = await Promise.all([
    buildPortfolio({ force: request.query.force === "true" }),
    bigquery.listApprovals("PENDING"),
    bigquery.listActions({ limit: 50 }),
    bigquery.listAlerts()
  ]);

  response.json(deriveSummary(connections, approvals, actions, alerts));
}));

app.get("/tools/similar-connections", asyncHandler(async (request, response) => {
  const connectorType = requireValue(readValue(request.query, "type", "connector_type"), "type");
  const snapshot = await buildPortfolio({ force: true });
  const connections = snapshot.connections.filter((connection) => connection.connectorType === connectorType);
  response.json({ connectorType, count: connections.length, connections });
}));

app.get("/tools/bq-query-activity", asyncHandler(async (request, response) => {
  const table = requireValue(readValue(request.query, "table", "table_fqn"), "table");
  const days = toInteger(readValue(request.query, "days"), 30);
  response.json(await bigquery.getBqQueryActivity(table, days));
}));

app.get("/tools/sync-history", asyncHandler(async (request, response) => {
  const connectionId = requireValue(readValue(request.query, "connection_id", "connectionId"), "connection_id");
  const limit = toInteger(readValue(request.query, "n", "limit"), 10);
  response.json({
    connectionId,
    history: await bigquery.getConnectionSyncHistory(connectionId, limit)
  });
}));

app.get("/tools/connection-schema", asyncHandler(async (request, response) => {
  const connectionId = requireValue(readValue(request.query, "connection_id", "connectionId"), "connection_id");
  response.json({
    connectionId,
    schema: await fivetran.listSchemas(connectionId)
  });
}));

app.get("/tools/action-details", asyncHandler(async (request, response) => {
  const actionId = requireValue(readValue(request.query, "action_id", "actionId"), "action_id");
  const action = await bigquery.getActionById(actionId);
  if (!action) {
    response.status(404).json({ error: "Action not found" });
    return;
  }

  response.json(action);
}));

app.get("/tools/connection-history", asyncHandler(async (request, response) => {
  const connectionId = requireValue(readValue(request.query, "connection_id", "connectionId"), "connection_id");
  const history = await buildConnectionHistory(connectionId);
  if (!history) {
    response.status(404).json({ error: "Connection not found" });
    return;
  }

  response.json(history);
}));

app.get("/tools/monthly-mar-by-team", asyncHandler(async (request, response) => {
  const reportMonth = getMonthStart(readValue(request.query, "month", "report_month"));
  response.json({
    reportMonth,
    teams: await bigquery.getMonthlyMarByTeam(reportMonth)
  });
}));

app.get("/tools/pending-approvals", asyncHandler(async (request, response) => {
  const teamId = requireValue(readValue(request.query, "team_id", "teamId"), "team_id");
  response.json({
    teamId,
    approvals: await bigquery.getPendingApprovalsForTeam(teamId)
  });
}));

app.get("/tools/estimate-cost-usd", (request, response) => {
  const marCount = toInteger(readValue(request.query, "mar_count", "marCount"), 0);
  response.json({
    marCount,
    marUsdPerMillion: config.marUsdPerMillion,
    estimatedUsd: Number(((marCount / 1000000) * config.marUsdPerMillion).toFixed(2))
  });
});

app.post("/tools/simulate-optimization-impact", asyncHandler(async (request, response) => {
  const connectionId = requireValue(readValue(request.body, "connection_id", "connectionId"), "connection_id");
  const actionType = requireValue(readValue(request.body, "action_type", "actionType"), "action_type");
  const snapshot = await buildPortfolio({ force: true });
  const connection = snapshot.connections.find((item) => item.id === connectionId) || null;
  response.json(simulateOptimizationImpact(connection, actionType, request.body?.params || request.body));
}));

app.post("/tools/patch-frequency", asyncHandler(async (request, response) => {
  const connectionId = requireValue(readValue(request.body, "connection_id", "connectionId"), "connection_id");
  const frequencyMin = toInteger(requireValue(readValue(request.body, "frequency_min", "frequencyMin", "newSyncFrequencyMin"), "frequency_min"));
  const result = await fivetran.patchSyncFrequency(connectionId, frequencyMin);
  invalidatePortfolioCache();
  response.json({ ok: true, connectionId, frequencyMin, result });
}));

app.post("/tools/disable-table", asyncHandler(async (request, response) => {
  const connectionId = requireValue(readValue(request.body, "connection_id", "connectionId"), "connection_id");
  const schemaName = requireValue(readValue(request.body, "schema", "schemaName", "schema_name"), "schema");
  const tableName = requireValue(readValue(request.body, "table", "tableName", "table_name"), "table");
  const result = await fivetran.setTableEnabled(connectionId, schemaName, tableName, false);
  invalidatePortfolioCache();
  response.json({ ok: true, connectionId, schemaName, tableName, result });
}));

app.post("/tools/block-column", asyncHandler(async (request, response) => {
  const connectionId = requireValue(readValue(request.body, "connection_id", "connectionId"), "connection_id");
  const schemaName = requireValue(readValue(request.body, "schema", "schemaName", "schema_name"), "schema");
  const tableName = requireValue(readValue(request.body, "table", "tableName", "table_name"), "table");
  const columnName = requireValue(readValue(request.body, "column", "columnName", "column_name"), "column");
  const result = await fivetran.setColumnEnabled(connectionId, schemaName, tableName, columnName, false);
  invalidatePortfolioCache();
  response.json({ ok: true, connectionId, schemaName, tableName, columnName, result });
}));

app.post("/tools/pause-connection", asyncHandler(async (request, response) => {
  const connectionId = requireValue(readValue(request.body, "connection_id", "connectionId"), "connection_id");
  const result = await fivetran.setPaused(connectionId, true);
  invalidatePortfolioCache();
  response.json({ ok: true, connectionId, paused: true, result });
}));

app.post("/tools/reload-schema", asyncHandler(async (request, response) => {
  const connectionId = requireValue(readValue(request.body, "connection_id", "connectionId"), "connection_id");
  const result = await fivetran.reloadSchema(connectionId);
  invalidatePortfolioCache();
  response.json({ ok: true, connectionId, result });
}));

app.post("/tools/append-trace", asyncHandler(async (request, response) => {
  const runId = requireValue(readValue(request.body, "run_id", "runId"), "run_id");
  const steps = Array.isArray(request.body?.steps) ? request.body.steps : [];
  const inserted = await bigquery.insertTraceSteps(runId, steps);
  response.json({ ok: true, runId, inserted });
}));

app.post("/tools/log-action", asyncHandler(async (request, response) => {
  const timestamp = new Date().toISOString();
  const actionId = readValue(request.body, "action_id", "actionId") || randomUUID();
  const payload = readValue(request.body, "payload", "actionPayload") || {};
  const runId = readValue(request.body, "run_id", "runId");
  const actionPayload = payload && typeof payload === "object" && !Array.isArray(payload)
    ? { ...payload, ...(runId ? { runId } : {}) }
    : payload;
  await bigquery.insertAction({
    actionId,
    timestamp,
    subAgent: readValue(request.body, "sub_agent", "subAgent") || "AGENT_BUILDER",
    connectionId: requireValue(readValue(request.body, "connection_id", "connectionId"), "connection_id"),
    actionType: requireValue(readValue(request.body, "action_type", "actionType"), "action_type"),
    actionPayload,
    triggerEvent: readValue(request.body, "trigger_event", "triggerEvent") || null,
    geminiReasoning: readValue(request.body, "reasoning", "geminiReasoning") || null,
    status: readValue(request.body, "status") || "EXECUTED",
    impactMarBefore: readValue(request.body, "impact_mar_before", "impactMarBefore") ?? null,
    impactMarAfter: readValue(request.body, "impact_mar_after", "impactMarAfter") ?? null
  });
  response.json({ ok: true, actionId, action: await bigquery.getActionById(actionId) });
}));

app.post("/tools/create-approval", asyncHandler(async (request, response) => {
  const timestamp = new Date().toISOString();
  const actionId = randomUUID();
  const approvalId = randomUUID();
  const payload = readValue(request.body, "payload", "actionPayload") || {};
  const runId = readValue(request.body, "run_id", "runId");
  const connectionId = requireValue(readValue(request.body, "connection_id", "connectionId"), "connection_id");
  const actionType = requireValue(readValue(request.body, "action_type", "actionType"), "action_type");

  // Guardrail: never queue a duplicate approval for the same connection + action.
  // For BLOCK_TABLE, two approvals only collide when they target overlapping tables.
  const extractTables = (source) => [
    ...(Array.isArray(source?.tables) ? source.tables.map((t) => t?.tableName || t?.table) : []),
    ...(source?.table ? [source.table] : [])
  ].filter(Boolean).map(String);
  const requestedTables = new Set(extractTables(payload));
  const pendingActions = await bigquery.listPendingActions();
  const duplicate = pendingActions.find((action) => {
    if (action.connectionId !== connectionId || action.actionType !== actionType) {
      return false;
    }
    if (actionType !== "BLOCK_TABLE" || requestedTables.size === 0) {
      return true;
    }
    const existingTables = extractTables(action.actionPayload);
    // Unknown scope on the pending action -> treat it as covering everything.
    return existingTables.length === 0 || existingTables.some((t) => requestedTables.has(t));
  });
  if (duplicate) {
    response.json({
      ok: false,
      duplicate: true,
      existingActionId: duplicate.actionId,
      message: `A ${actionType} approval for ${connectionId} is already pending (action ${duplicate.actionId}). Not creating a duplicate.`
    });
    return;
  }

  const actionPayload = payload && typeof payload === "object" && !Array.isArray(payload)
    ? { ...payload, ...(runId ? { runId } : {}) }
    : payload;
  const estimatedMarSavings = Number(
    readValue(request.body, "estimated_mar_savings", "estimatedMarSavings")
      ?? payload.estimatedMarSavings
      ?? 0
  );

  // BLOCK_TABLE with multiple tables fans out into one approval per table so the
  // operator can approve/reject each table individually. The UI groups them by run.
  const tablesList = actionType === "BLOCK_TABLE" && Array.isArray(actionPayload?.tables)
    ? actionPayload.tables
    : null;
  const items = tablesList && tablesList.length > 1
    ? tablesList.map((table) => {
        const savings = Number(table?.monthlyMar) || Math.round(estimatedMarSavings / tablesList.length);
        return {
          actionPayload: { ...actionPayload, tables: [table], estimatedMarSavings: savings },
          estimatedMarSavings: savings,
          title: `Disable cold table ${table?.tableName} on ${connectionId}`
        };
      })
    : [{
        actionPayload,
        estimatedMarSavings,
        title: readValue(request.body, "title") || (
          actionType === "BLOCK_TABLE" && requestedTables.size > 0
            ? `Disable cold table ${[...requestedTables].join(", ")} on ${connectionId}`
            : `${actionType.replaceAll("_", " ")} on ${connectionId} requires approval`
        )
      }];

  const created = [];
  for (const item of items) {
    const itemActionId = created.length === 0 ? actionId : randomUUID();
    const itemApprovalId = created.length === 0 ? approvalId : randomUUID();

    await bigquery.insertAction({
      actionId: itemActionId,
      timestamp,
      subAgent: readValue(request.body, "sub_agent", "subAgent") || "AGENT_BUILDER",
      connectionId,
      actionType,
      actionPayload: item.actionPayload,
      triggerEvent: readValue(request.body, "trigger_event", "triggerEvent") || null,
      geminiReasoning: readValue(request.body, "reasoning", "geminiReasoning") || null,
      status: "PENDING_APPROVAL",
      impactMarBefore: readValue(request.body, "impact_mar_before", "impactMarBefore") ?? null,
      impactMarAfter: readValue(request.body, "impact_mar_after", "impactMarAfter") ?? null
    });

    await bigquery.insertApproval({
      approvalId: itemApprovalId,
      actionId: itemActionId,
      tsCreated: timestamp,
      status: "PENDING",
      riskLevel: readValue(request.body, "risk_level", "riskLevel") || "MEDIUM",
      title: item.title,
      description: readValue(request.body, "description") || "Created by Agent Builder tool call.",
      estimatedMarSavings: item.estimatedMarSavings
    });

    created.push({ actionId: itemActionId, approvalId: itemApprovalId });
  }

  events.publish("approval_created", {
    actionId,
    approvalId,
    message: created.length > 1
      ? `${created.length} approvals created for ${connectionId} (one per table)`
      : `Approval created for ${connectionId}`
  });
  response.json({
    ok: true,
    approvalId,
    actionId,
    approvals: created,
    count: created.length,
    approval: await bigquery.getApprovalById(approvalId)
  });
}));

app.post("/tools/create-alert", asyncHandler(async (request, response) => {
  const alertId = randomUUID();
  await bigquery.createAlert({
    alertId,
    createdAt: new Date().toISOString(),
    connectionId: requireValue(readValue(request.body, "connection_id", "connectionId"), "connection_id"),
    severity: readValue(request.body, "severity") || "WARNING",
    diagnosis: readValue(request.body, "diagnosis") || null,
    recommendedAction: readValue(request.body, "recommended_action", "recommendedAction") || null,
    status: readValue(request.body, "status") || "OPEN"
  });
  response.json({ ok: true, alertId });
}));

app.post("/tools/write-chargeback", asyncHandler(async (request, response) => {
  const reportId = readValue(request.body, "report_id", "reportId") || randomUUID();
  const reportMonth = getMonthStart(readValue(request.body, "report_month", "reportMonth", "month"));
  const topConnectionFields = buildTopConnectionFields(readValue(request.body, "top_connections", "topConnections") || []);
  await bigquery.writeChargebackRecord({
    reportId,
    reportMonth,
    teamId: requireValue(readValue(request.body, "team_id", "teamId"), "team_id"),
    teamName: readValue(request.body, "team_name", "teamName") || null,
    teamSlackChannel: readValue(request.body, "team_slack_channel", "teamSlackChannel") || null,
    totalMar: readValue(request.body, "total_mar", "totalMar") || 0,
    budgetMar: readValue(request.body, "budget_mar", "budgetMar") || 0,
    costUsdEstimated: readValue(request.body, "cost_usd_estimated", "costUsdEstimated") || 0,
    budgetUsd: readValue(request.body, "budget_usd", "budgetUsd") || 0,
    pendingOptimizationsCount: readValue(request.body, "pending_optimizations_count", "pendingOptimizationsCount") || 0,
    potentialSavingsMar: readValue(request.body, "potential_savings_mar", "potentialSavingsMar") || 0,
    reportUrl: readValue(request.body, "report_url", "reportUrl") || null,
    chargebackMessage: readValue(request.body, "chargeback_message", "chargebackMessage") || null,
    generatedAt: new Date().toISOString(),
    ...topConnectionFields
  });
  response.json({ ok: true, reportId, reportMonth });
}));

app.post("/tools/trigger-activations", asyncHandler(async (request, response) => {
  if (!config.fivetranActivationsConnectionId) {
    const error = new Error("FIVETRAN_ACTIVATIONS_CONNECTION_ID is not configured.");
    error.statusCode = 501;
    throw error;
  }

  const result = await fivetran.triggerSync(config.fivetranActivationsConnectionId);
  response.json({
    ok: true,
    connectionId: config.fivetranActivationsConnectionId,
    result
  });
}));

app.post("/internal/trigger-analysis", requireInternalSecret, asyncHandler(async (request, response) => {
  const results = await analyzeConnections();
  response.json({ created: results.length, results });
}));

let missionRunning = false;

const MISSION_AGENT_LABELS = {
  ORCHESTRATOR: "conductor",
  COST: "cost_agent",
  PERF: "perf_agent",
  CHARGEBACK: "chargeback_agent"
};

function formatMissionStep(step) {
  const content = String(step.content || "");
  if (step.stepType === "TOOL_CALL") {
    return `tool call: ${step.toolName}(${content.slice(0, 180)})`;
  }
  if (step.stepType === "TOOL_RESULT") {
    return `${step.toolName}: ${content.slice(0, 240)}`;
  }
  return content.slice(0, 280);
}

// Cloud Run image ships without the Python/ADK runtime, so the hosted demo
// replays the same governance mission through the built-in analyzer instead.
// It creates REAL approvals whose actions execute against the live Fivetran
// API when a judge approves them.
async function runReplayMission(response) {
  const { randomUUID } = require("node:crypto");
  const runId = randomUUID();
  missionRunning = true;

  events.publish("agent_mission_started", {
    runId,
    message: `Conductor governance mission started (run ${runId.slice(0, 8)}…).`
  });
  response.json({ started: true, runId, mode: "replay" });

  const queue = [];
  let draining = false;
  const drain = () => {
    if (draining) return;
    draining = true;
    const tick = () => {
      const step = queue.shift();
      if (!step) {
        draining = false;
        return;
      }
      events.publish("agent_mission_step", step);
      setTimeout(tick, 850);
    };
    tick();
  };

  try {
    const results = await analyzeConnections(null, {
      runId,
      onStep: (step) => {
        queue.push({
          runId,
          agent: MISSION_AGENT_LABELS[step.subAgent] || "conductor",
          message: formatMissionStep(step)
        });
        drain();
      }
    });

    const finish = () => {
      if (queue.length > 0 || draining) {
        setTimeout(finish, 500);
        return;
      }
      missionRunning = false;
      events.publish("agent_mission_complete", {
        runId,
        exitCode: 0,
        message: `Mission finished: ${results.length} proposal(s) queued for approval. Trace ${runId.slice(0, 8)}… is available in Activity.`
      });
    };
    finish();
  } catch (error) {
    missionRunning = false;
    console.error("Replay mission failed", error.message);
    events.publish("agent_mission_complete", {
      runId,
      exitCode: 1,
      message: `Mission failed: ${error.message}`
    });
  }
}

app.post("/internal/run-mission", requireInternalSecret, asyncHandler(async (request, response) => {
  if (missionRunning) {
    response.status(409).json({ error: "An agent mission is already running." });
    return;
  }

  const useReplay = Boolean(process.env.K_SERVICE) || process.env.MISSION_MODE === "replay";
  if (useReplay) {
    await runReplayMission(response);
    return;
  }

  const mission = String(request.body?.mission || "").slice(0, 1000) ||
    "Run a FULL fleet audit using ALL specialists in sequence: first cost_agent (MAR waste, " +
    "cold tables, over-budget connections), then perf_agent (sync failures and latency), then " +
    "chargeback_agent (spend attribution report). Verify evidence with query activity before " +
    "proposing actions. Queue approvals for anything MEDIUM/HIGH risk. Do not duplicate " +
    "approvals that are already pending. Finish with a combined summary.";

  const { spawn } = require("node:child_process");
  const path = require("node:path");
  const agentDir = path.resolve(__dirname, "..", "..", "agent");

  missionRunning = true;
  const child = spawn("uv", ["run", "python", "smoke_agent.py", mission], {
    cwd: agentDir,
    shell: process.platform === "win32",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let runId = null;
  let stdoutBuffer = "";
  let lineBuffer = "";
  let responded = false;

  const respondStarted = () => {
    if (!responded) {
      responded = true;
      response.json({ started: true, runId });
    }
  };

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdoutBuffer += text;
    const match = stdoutBuffer.match(/\[run\] ([0-9a-f-]{36})/);
    if (match && !runId) {
      runId = match[1];
      events.publish("agent_mission_started", {
        runId,
        message: `ADK multi-agent mission started (run ${runId.slice(0, 8)}…).`
      });
      respondStarted();
    }

    // Stream each agent step line to the UI in real time via SSE.
    lineBuffer += text;
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop();
    for (const line of lines) {
      const step = line.match(/^\[([\w-]+)\] (.+)$/);
      if (!step || step[1] === "run" || step[1] === "trace") continue;
      events.publish("agent_mission_step", {
        runId,
        agent: step[1],
        message: step[2].slice(0, 280)
      });
    }
  });
  child.stderr.on("data", () => {});

  child.on("close", (code) => {
    missionRunning = false;
    events.publish("agent_mission_complete", {
      runId,
      exitCode: code,
      message: runId
        ? `ADK multi-agent mission finished. Trace ${runId.slice(0, 8)}… is available in Activity.`
        : `ADK multi-agent mission exited with code ${code} before publishing a run id.`
    });
    respondStarted();
  });

  child.on("error", (error) => {
    missionRunning = false;
    console.error("Mission spawn failed", error.message);
    if (!responded) {
      responded = true;
      response.status(500).json({ error: `Could not start agent runtime: ${error.message}` });
    }
  });

  // Safety: never leave the request hanging if the runner is slow to print the run id.
  setTimeout(respondStarted, 15000);
}));

app.post("/internal/test-notification", requireInternalSecret, asyncHandler(async (request, response) => {
  const message = request.body?.message || "Test notice: notification pipeline is wired end-to-end.";
  const results = await notifications.notifyChannels("Test notification", message, { type: "test_notification" });
  response.json({ ok: true, channels: results });
}));

app.post("/internal/trigger-sync/:id", requireInternalSecret, asyncHandler(async (request, response) => {
  const result = await fivetran.triggerSync(request.params.id);
  events.publish("sync_triggered", {
    connectionId: request.params.id,
    message: `Manual sync triggered for ${request.params.id}`
  });
  response.json(result || { ok: true });
}));

app.use((error, request, response, next) => {
  console.error(error);
  response.status(error.statusCode || 500).json({
    error: error.message,
    details: error.body || null
  });
});

bigquery.ensureConductorSchema()
  .then(() => {
    events.publish("system_ready", {
      message: "Conductor backend connected to BigQuery."
    });
  })
  .catch((error) => {
    console.error("Failed to ensure BigQuery schema", error);
    events.publish("system_warning", {
      message: `BigQuery schema bootstrap failed: ${error.message}`
    });
  })
  .finally(() => {
    notifications.register();
    app.listen(config.port, () => {
      console.log(`Conductor backend listening on port ${config.port}`);
    });
  });

module.exports = app;