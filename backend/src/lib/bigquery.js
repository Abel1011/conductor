const { BigQuery } = require("@google-cloud/bigquery");
const config = require("./config");

const bigquery = new BigQuery({
  projectId: config.bigqueryProjectId || undefined,
  credentials: config.googleCredentials || undefined
});
let authWarningShown = false;

function tablePath(datasetId, tableName) {
  return `\`${config.bigqueryProjectId}.${datasetId}.${tableName}\``;
}

function jobsInformationSchemaPath() {
  const location = String(config.fivetranMetadataLocation || "us").toLowerCase().replace(/[^a-z0-9-]/g, "");
  return `\`${config.bigqueryProjectId}.region-${location}\`.INFORMATION_SCHEMA.JOBS_BY_PROJECT`;
}

function missingResource(error) {
  return error?.code === 404 || /not found/i.test(error?.message || "");
}

function missingCredentials(error) {
  return /default credentials|application default credentials|could not load the default credentials/i.test(error?.message || "");
}

function warnAuthOnce(error) {
  if (!authWarningShown) {
    authWarningShown = true;
    console.warn(`[bigquery] ${error.message}`);
  }
}

async function runQuery(query, params = {}, options = {}) {
  const [rows] = await bigquery.query({
    query,
    params,
    ...(options.types ? { types: options.types } : {}),
    location: options.location || config.bigqueryLocation,
    useLegacySql: false
  });

  return rows.map(normalizeBqRow);
}

async function safeSelect(query, params = {}, options = {}) {
  try {
    return await runQuery(query, params, options);
  } catch (error) {
    if (missingResource(error)) {
      return [];
    }

    if (missingCredentials(error)) {
      warnAuthOnce(error);
      return [];
    }

    throw error;
  }
}

// BigQuery returns TIMESTAMP/DATE/DATETIME/NUMERIC as {value:"..."} objects.
// This helper normalizes them to plain primitives so the JSON sent to the
// frontend is always a string or number, never a {value} object.
function normalizeBqRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v !== null && typeof v === "object" && !Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, "value")) {
      // BigQuery typed value wrapper — extract the primitive
      out[k] = v.value ?? null;
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) => (item !== null && typeof item === "object" && Object.prototype.hasOwnProperty.call(item, "value") ? (item.value ?? null) : item));
    } else {
      out[k] = v;
    }
  }
  return out;
}

function parseJsonField(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function normalizeActionPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const normalized = { ...payload };
  if (typeof normalized.run_id === "string" && typeof normalized.runId !== "string") {
    normalized.runId = normalized.run_id;
  }

  return normalized;
}

async function ensureConductorSchema() {
  if (!config.bigqueryProjectId) {
    return;
  }

  const dataset = bigquery.dataset(config.conductorDataset);
  const [exists] = await dataset.exists();

  if (!exists) {
    await dataset.create({ location: config.bigqueryLocation });
  }

  const ddl = [
    `
      CREATE TABLE IF NOT EXISTS ${tablePath(config.conductorDataset, "connection_policy")} (
        connection_id STRING NOT NULL,
        team_owner STRING NOT NULL,
        team_slack_channel STRING,
        sla_tier STRING NOT NULL,
        max_monthly_mar INT64 NOT NULL,
        min_sync_frequency_min INT64 NOT NULL,
        auto_optimize BOOL NOT NULL,
        updated_at TIMESTAMP NOT NULL
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tablePath(config.conductorDataset, "agent_actions")} (
        action_id STRING NOT NULL,
        ts TIMESTAMP NOT NULL,
        sub_agent STRING NOT NULL,
        connection_id STRING NOT NULL,
        action_type STRING NOT NULL,
        action_payload JSON,
        trigger_event STRING,
        gemini_reasoning STRING,
        status STRING NOT NULL,
        impact_mar_before INT64,
        impact_mar_after INT64
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tablePath(config.conductorDataset, "approval_queue")} (
        approval_id STRING NOT NULL,
        action_id STRING NOT NULL,
        ts_created TIMESTAMP NOT NULL,
        ts_resolved TIMESTAMP,
        resolved_by STRING,
        status STRING NOT NULL,
        risk_level STRING NOT NULL,
        title STRING,
        description STRING,
        estimated_mar_savings INT64
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tablePath(config.conductorDataset, "alerts")} (
        alert_id STRING NOT NULL,
        ts TIMESTAMP NOT NULL,
        connection_id STRING NOT NULL,
        severity STRING NOT NULL,
        diagnosis STRING,
        recommended_action STRING,
        status STRING NOT NULL
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tablePath(config.conductorDataset, "agent_traces")} (
        run_id STRING NOT NULL,
        seq INT64 NOT NULL,
        ts TIMESTAMP NOT NULL,
        sub_agent STRING,
        step_type STRING NOT NULL,
        tool_name STRING,
        content STRING
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tablePath(config.conductorDataset, "workspace_settings")} (
        setting_key STRING NOT NULL,
        setting_value STRING NOT NULL,
        updated_at TIMESTAMP NOT NULL
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS ${tablePath(config.conductorDataset, "monthly_chargebacks")} (
        report_id STRING NOT NULL,
        report_month DATE NOT NULL,
        team_id STRING NOT NULL,
        team_name STRING,
        team_slack_channel STRING,
        total_mar INT64,
        budget_mar INT64,
        cost_usd_estimated FLOAT64,
        budget_usd FLOAT64,
        top_connection_1 STRING,
        top_connection_1_mar INT64,
        top_connection_2 STRING,
        top_connection_2_mar INT64,
        top_connection_3 STRING,
        top_connection_3_mar INT64,
        pending_optimizations_count INT64,
        potential_savings_mar INT64,
        report_url STRING,
        chargeback_message STRING,
        generated_at TIMESTAMP NOT NULL
      )
    `
  ];

  for (const statement of ddl) {
    await runQuery(statement);
  }
}

async function insertTraceSteps(runId, steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return 0;
  }

  const now = new Date().toISOString();
  const rows = steps.map((step, index) => ({
    run_id: runId,
    seq: Number(step.seq ?? index),
    ts: step.ts || now,
    sub_agent: step.subAgent || step.sub_agent || null,
    step_type: String(step.stepType || step.step_type || "REASONING").toUpperCase(),
    tool_name: step.toolName || step.tool_name || null,
    content: step.content != null ? String(step.content).slice(0, 6000) : null
  }));

  await bigquery.dataset(config.conductorDataset).table("agent_traces").insert(rows);
  return rows.length;
}

async function getTraceByRunId(runId) {
  return safeSelect(`
    SELECT
      run_id AS runId,
      seq,
      ts,
      sub_agent AS subAgent,
      step_type AS stepType,
      tool_name AS toolName,
      content
    FROM ${tablePath(config.conductorDataset, "agent_traces")}
    WHERE run_id = @runId
    ORDER BY seq ASC
  `, { runId });
}

async function listTraceRuns(limit = 10) {
  return safeSelect(`
    SELECT
      run_id AS runId,
      MIN(ts) AS startedAt,
      COUNT(*) AS stepCount,
      COUNTIF(step_type = 'TOOL_CALL') AS toolCalls,
      ARRAY_AGG(DISTINCT sub_agent IGNORE NULLS) AS subAgents,
      ANY_VALUE(IF(step_type = 'MISSION', content, NULL)) AS mission
    FROM ${tablePath(config.conductorDataset, "agent_traces")}
    GROUP BY run_id
    ORDER BY startedAt DESC
    LIMIT @limit
  `, { limit: Number(limit) });
}

async function getWorkspaceSetting(key) {
  const rows = await safeSelect(`
    SELECT setting_value AS value
    FROM ${tablePath(config.conductorDataset, "workspace_settings")}
    WHERE setting_key = @key
    ORDER BY updated_at DESC
    LIMIT 1
  `, { key });

  return rows[0]?.value ?? null;
}

async function setWorkspaceSetting(key, value) {
  await runQuery(`
    MERGE ${tablePath(config.conductorDataset, "workspace_settings")} AS target
    USING (
      SELECT @key AS setting_key, @value AS setting_value, CURRENT_TIMESTAMP() AS updated_at
    ) AS source
    ON target.setting_key = source.setting_key
    WHEN MATCHED THEN UPDATE SET
      setting_value = source.setting_value,
      updated_at = source.updated_at
    WHEN NOT MATCHED THEN INSERT (setting_key, setting_value, updated_at)
    VALUES (source.setting_key, source.setting_value, source.updated_at)
  `, { key, value: String(value) });
}

async function getConnectionPolicies() {
  return safeSelect(`
    SELECT
      connection_id AS connectionId,
      team_owner AS teamOwner,
      team_slack_channel AS teamSlackChannel,
      sla_tier AS slaTier,
      max_monthly_mar AS maxMonthlyMar,
      min_sync_frequency_min AS minSyncFrequencyMin,
      auto_optimize AS autoOptimize,
      schema_change_protection AS schemaChangeProtection,
      custom_policy AS customPolicy,
      updated_at AS updatedAt
    FROM ${tablePath(config.conductorDataset, "connection_policy")}
    QUALIFY ROW_NUMBER() OVER (PARTITION BY connection_id ORDER BY updated_at DESC) = 1
    ORDER BY updated_at DESC
  `);
}

async function getConnectionPolicy(connectionId) {
  const rows = await safeSelect(`
    SELECT
      connection_id AS connectionId,
      team_owner AS teamOwner,
      team_slack_channel AS teamSlackChannel,
      sla_tier AS slaTier,
      max_monthly_mar AS maxMonthlyMar,
      min_sync_frequency_min AS minSyncFrequencyMin,
      auto_optimize AS autoOptimize,
      schema_change_protection AS schemaChangeProtection,
      custom_policy AS customPolicy,
      updated_at AS updatedAt
    FROM ${tablePath(config.conductorDataset, "connection_policy")}
    WHERE connection_id = @connectionId
    ORDER BY updated_at DESC
    LIMIT 1
  `, { connectionId });

  return rows[0] || null;
}

async function upsertConnectionPolicy(policy) {
  await runQuery(`
    MERGE ${tablePath(config.conductorDataset, "connection_policy")} AS target
    USING (
      SELECT
        @connectionId AS connection_id,
        @teamOwner AS team_owner,
        @teamSlackChannel AS team_slack_channel,
        @slaTier AS sla_tier,
        @maxMonthlyMar AS max_monthly_mar,
        @minSyncFrequencyMin AS min_sync_frequency_min,
        @autoOptimize AS auto_optimize,
        @schemaChangeProtection AS schema_change_protection,
        @customPolicy AS custom_policy,
        CURRENT_TIMESTAMP() AS updated_at
    ) AS source
    ON target.connection_id = source.connection_id
    WHEN MATCHED THEN UPDATE SET
      team_owner = source.team_owner,
      team_slack_channel = source.team_slack_channel,
      sla_tier = source.sla_tier,
      max_monthly_mar = source.max_monthly_mar,
      min_sync_frequency_min = source.min_sync_frequency_min,
      auto_optimize = source.auto_optimize,
      schema_change_protection = source.schema_change_protection,
      custom_policy = source.custom_policy,
      updated_at = source.updated_at
    WHEN NOT MATCHED THEN INSERT (
      connection_id,
      team_owner,
      team_slack_channel,
      sla_tier,
      max_monthly_mar,
      min_sync_frequency_min,
      auto_optimize,
      schema_change_protection,
      custom_policy,
      updated_at
    ) VALUES (
      source.connection_id,
      source.team_owner,
      source.team_slack_channel,
      source.sla_tier,
      source.max_monthly_mar,
      source.min_sync_frequency_min,
      source.auto_optimize,
      source.schema_change_protection,
      source.custom_policy,
      source.updated_at
    )
  `, {
    connectionId: policy.connectionId,
    teamOwner: policy.teamOwner,
    teamSlackChannel: policy.teamSlackChannel || null,
    slaTier: policy.slaTier,
    maxMonthlyMar: Number(policy.maxMonthlyMar),
    minSyncFrequencyMin: Number(policy.minSyncFrequencyMin),
    autoOptimize: Boolean(policy.autoOptimize),
    schemaChangeProtection: Boolean(policy.schemaChangeProtection),
    customPolicy: policy.customPolicy || null
  }, {
    types: {
      teamSlackChannel: "STRING",
      customPolicy: "STRING"
    }
  });

  return getConnectionPolicy(policy.connectionId);
}

async function insertAction(action) {
  await runQuery(`
    INSERT INTO ${tablePath(config.conductorDataset, "agent_actions")} (
      action_id,
      ts,
      sub_agent,
      connection_id,
      action_type,
      action_payload,
      trigger_event,
      gemini_reasoning,
      status,
      impact_mar_before,
      impact_mar_after
    ) VALUES (
      @actionId,
      TIMESTAMP(@timestamp),
      @subAgent,
      @connectionId,
      @actionType,
      PARSE_JSON(@actionPayload),
      @triggerEvent,
      @geminiReasoning,
      @status,
      @impactMarBefore,
      @impactMarAfter
    )
  `, {
    actionId: action.actionId,
    timestamp: action.timestamp,
    subAgent: action.subAgent,
    connectionId: action.connectionId,
    actionType: action.actionType,
    actionPayload: JSON.stringify(action.actionPayload || null),
    triggerEvent: action.triggerEvent || null,
    geminiReasoning: action.geminiReasoning || null,
    status: action.status,
    impactMarBefore: action.impactMarBefore ?? null,
    impactMarAfter: action.impactMarAfter ?? null
  }, {
    types: {
      triggerEvent: "STRING",
      geminiReasoning: "STRING",
      impactMarBefore: "INT64",
      impactMarAfter: "INT64"
    }
  });
}

async function insertApproval(approval) {
  await runQuery(`
    INSERT INTO ${tablePath(config.conductorDataset, "approval_queue")} (
      approval_id,
      action_id,
      ts_created,
      ts_resolved,
      resolved_by,
      status,
      risk_level,
      title,
      description,
      estimated_mar_savings
    ) VALUES (
      @approvalId,
      @actionId,
      TIMESTAMP(@tsCreated),
      NULL,
      NULL,
      @status,
      @riskLevel,
      @title,
      @description,
      @estimatedMarSavings
    )
  `, {
    approvalId: approval.approvalId,
    actionId: approval.actionId,
    tsCreated: approval.tsCreated,
    status: approval.status,
    riskLevel: approval.riskLevel,
    title: approval.title,
    description: approval.description,
    estimatedMarSavings: approval.estimatedMarSavings ?? 0
  });
}

async function getActionById(actionId) {
  const rows = await safeSelect(`
    SELECT
      action_id AS actionId,
      ts AS timestamp,
      sub_agent AS subAgent,
      connection_id AS connectionId,
      action_type AS actionType,
      TO_JSON_STRING(action_payload) AS actionPayloadJson,
      trigger_event AS triggerEvent,
      gemini_reasoning AS geminiReasoning,
      status,
      impact_mar_before AS impactMarBefore,
      impact_mar_after AS impactMarAfter
    FROM ${tablePath(config.conductorDataset, "agent_actions")}
    WHERE action_id = @actionId
    LIMIT 1
  `, { actionId });

  if (!rows[0]) {
    return null;
  }

  return {
    ...rows[0],
    actionPayload: normalizeActionPayload(parseJsonField(rows[0].actionPayloadJson))
  };
}

async function listActions(options = {}) {
  const limit = Number(options.limit || 20);
  const connectionFilter = options.connectionId ? "WHERE connection_id = @connectionId" : "";
  const rows = await safeSelect(`
    SELECT
      action_id AS id,
      ts AS timestamp,
      sub_agent AS subAgent,
      connection_id AS connectionId,
      action_type AS actionType,
      TO_JSON_STRING(action_payload) AS actionPayloadJson,
      trigger_event AS triggerEvent,
      gemini_reasoning AS geminiReasoning,
      status,
      impact_mar_before AS impactMarBefore,
      impact_mar_after AS impactMarAfter
    FROM ${tablePath(config.conductorDataset, "agent_actions")}
    ${connectionFilter}
    ORDER BY ts DESC
    LIMIT @limit
  `, {
    limit,
    ...(options.connectionId ? { connectionId: options.connectionId } : {})
  });

  return rows.map((row) => ({
    ...row,
    actionPayload: normalizeActionPayload(parseJsonField(row.actionPayloadJson))
  }));
}

async function listPendingActions() {
  const rows = await safeSelect(`
    SELECT
      action_id AS actionId,
      connection_id AS connectionId,
      action_type AS actionType,
      TO_JSON_STRING(action_payload) AS actionPayloadJson,
      status
    FROM ${tablePath(config.conductorDataset, "agent_actions")}
    WHERE status = 'PENDING_APPROVAL'
  `);

  return rows.map((row) => ({
    ...row,
    actionPayload: normalizeActionPayload(parseJsonField(row.actionPayloadJson))
  }));
}

async function updateAction(actionId, updates) {
  const clauses = [];
  const params = { actionId };

  if (Object.prototype.hasOwnProperty.call(updates, "status")) {
    clauses.push("status = @status");
    params.status = updates.status;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "impactMarBefore")) {
    clauses.push("impact_mar_before = @impactMarBefore");
    params.impactMarBefore = updates.impactMarBefore;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "impactMarAfter")) {
    clauses.push("impact_mar_after = @impactMarAfter");
    params.impactMarAfter = updates.impactMarAfter;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "actionPayload")) {
    clauses.push("action_payload = PARSE_JSON(@actionPayload)");
    params.actionPayload = JSON.stringify(updates.actionPayload || null);
  }

  if (!clauses.length) {
    return;
  }

  await runQuery(`
    UPDATE ${tablePath(config.conductorDataset, "agent_actions")}
    SET ${clauses.join(", ")}
    WHERE action_id = @actionId
  `, params);
}

async function getApprovalById(approvalId) {
  const rows = await safeSelect(`
    SELECT
      approval.approval_id AS id,
      approval.action_id AS actionId,
      approval.ts_created AS createdAt,
      approval.ts_resolved AS resolvedAt,
      approval.resolved_by AS resolvedBy,
      approval.status,
      approval.risk_level AS riskLevel,
      approval.title,
      approval.description,
      approval.estimated_mar_savings AS estimatedMarSavings,
      action.sub_agent AS subAgent,
      action.connection_id AS connectionId,
      action.action_type AS actionType,
      action.gemini_reasoning AS geminiReasoning,
      TO_JSON_STRING(action.action_payload) AS actionPayloadJson
    FROM ${tablePath(config.conductorDataset, "approval_queue")} AS approval
    JOIN ${tablePath(config.conductorDataset, "agent_actions")} AS action
      ON approval.action_id = action.action_id
    WHERE approval.approval_id = @approvalId
    LIMIT 1
  `, { approvalId });

  if (!rows[0]) {
    return null;
  }

  return {
    ...rows[0],
    actionPayload: normalizeActionPayload(parseJsonField(rows[0].actionPayloadJson))
  };
}

async function listApprovals(status = "PENDING") {
  const rows = await safeSelect(`
    SELECT
      approval.approval_id AS id,
      approval.action_id AS actionId,
      approval.ts_created AS createdAt,
      approval.ts_resolved AS resolvedAt,
      approval.resolved_by AS resolvedBy,
      approval.status,
      approval.risk_level AS riskLevel,
      approval.title,
      approval.description,
      approval.estimated_mar_savings AS estimatedMarSavings,
      action.sub_agent AS subAgent,
      action.connection_id AS connectionId,
      action.action_type AS actionType,
      action.gemini_reasoning AS geminiReasoning,
      TO_JSON_STRING(action.action_payload) AS actionPayloadJson
    FROM ${tablePath(config.conductorDataset, "approval_queue")} AS approval
    JOIN ${tablePath(config.conductorDataset, "agent_actions")} AS action
      ON approval.action_id = action.action_id
    WHERE approval.status = @status
    ORDER BY approval.ts_created DESC
  `, { status });

  return rows.map((row) => ({
    ...row,
    actionPayload: normalizeActionPayload(parseJsonField(row.actionPayloadJson))
  }));
}

async function resolveApproval(approvalId, status, resolvedBy) {
  await runQuery(`
    UPDATE ${tablePath(config.conductorDataset, "approval_queue")}
    SET
      status = @status,
      ts_resolved = CURRENT_TIMESTAMP(),
      resolved_by = @resolvedBy
    WHERE approval_id = @approvalId
  `, {
    approvalId,
    status,
    resolvedBy
  });

  return getApprovalById(approvalId);
}

async function createAlert(alert) {
  await runQuery(`
    INSERT INTO ${tablePath(config.conductorDataset, "alerts")} (
      alert_id,
      ts,
      connection_id,
      severity,
      diagnosis,
      recommended_action,
      status
    ) VALUES (
      @alertId,
      TIMESTAMP(@createdAt),
      @connectionId,
      @severity,
      @diagnosis,
      @recommendedAction,
      @status
    )
  `, {
    alertId: alert.alertId,
    createdAt: alert.createdAt,
    connectionId: alert.connectionId,
    severity: alert.severity,
    diagnosis: alert.diagnosis || null,
    recommendedAction: alert.recommendedAction || null,
    status: alert.status
  }, {
    types: {
      diagnosis: "STRING",
      recommendedAction: "STRING"
    }
  });
}

async function listAlerts(status = null) {
  const where = status ? "WHERE status = @status" : "";
  return safeSelect(`
    SELECT
      alert_id AS id,
      ts AS createdAt,
      connection_id AS connectionId,
      severity,
      diagnosis,
      recommended_action AS recommendedAction,
      status
    FROM ${tablePath(config.conductorDataset, "alerts")}
    ${where}
    ORDER BY ts DESC
  `, status ? { status } : {});
}

async function acknowledgeAlert(alertId) {
  await runQuery(`
    UPDATE ${tablePath(config.conductorDataset, "alerts")}
    SET status = 'ACKNOWLEDGED'
    WHERE alert_id = @alertId
  `, { alertId });
}

async function getConnectionMetadata() {
  return safeSelect(`
    SELECT
      connection_id AS connectionId,
      connection_name AS connectionName,
      connector_type_id AS connectorType,
      sync_frequency AS syncFrequencyMin,
      CAST(NULL AS TIMESTAMP) AS succeededAt,
      CAST(NULL AS TIMESTAMP) AS failedAt,
      paused,
      signed_up AS createdAt
    FROM ${tablePath(config.fivetranMetadataDataset, "connection")}
    WHERE COALESCE(_fivetran_deleted, FALSE) = FALSE
  `, {}, { location: config.fivetranMetadataLocation });
}

async function getMarByConnection() {
  return safeSelect(`
    SELECT
      conn.connection_id AS connectionId,
      mar.connection_name AS connectionName,
      mar.schema_name AS schemaName,
      mar.table_name AS tableName,
      CAST(SUM(mar.incremental_rows) AS INT64) AS monthlyMar
    FROM ${tablePath(config.fivetranMetadataDataset, "incremental_mar")} AS mar
    JOIN ${tablePath(config.fivetranMetadataDataset, "connection")} AS conn
      ON conn.connection_name = mar.connection_name
    WHERE COALESCE(conn._fivetran_deleted, FALSE) = FALSE
      AND COALESCE(mar.free_type, 'PAID') != 'SYSTEM'
      AND DATE_TRUNC(mar.measured_date, MONTH) = DATE_TRUNC(CURRENT_DATE(), MONTH)
    GROUP BY connectionId, connectionName, schemaName, tableName
    ORDER BY monthlyMar DESC
  `, {}, { location: config.fivetranMetadataLocation });
}

async function getMarHistoryByConnection() {
  return safeSelect(`
    SELECT
      conn.connection_id AS connectionId,
      DATE_TRUNC(mar.measured_date, MONTH) AS measuredMonth,
      CAST(SUM(mar.incremental_rows) AS INT64) AS monthlyMar
    FROM ${tablePath(config.fivetranMetadataDataset, "incremental_mar")} AS mar
    JOIN ${tablePath(config.fivetranMetadataDataset, "connection")} AS conn
      ON conn.connection_name = mar.connection_name
    WHERE COALESCE(conn._fivetran_deleted, FALSE) = FALSE
      AND COALESCE(mar.free_type, 'PAID') != 'SYSTEM'
    GROUP BY connectionId, measuredMonth
    ORDER BY measuredMonth ASC
  `, {}, { location: config.fivetranMetadataLocation });
}

async function getSyncStats() {
  const rows = await safeSelect(`
    WITH sync_pairs AS (
      SELECT
        connection_id,
        sync_id,
        MIN(IF(event = 'sync_start', time_stamp, NULL)) AS startTs,
        MAX(IF(event = 'sync_end', time_stamp, NULL)) AS endTs,
        ARRAY_AGG(
          COALESCE(
            JSON_VALUE(message_data, '$.status'),
            JSON_VALUE(message_data, '$.data.status'),
            JSON_VALUE(message_data, '$.result.status'),
            event
          )
          ORDER BY time_stamp DESC
          LIMIT 1
        )[SAFE_OFFSET(0)] AS syncStatus
      FROM ${tablePath(config.fivetranMetadataDataset, "log")}
      WHERE event IN ('sync_start', 'sync_end')
        AND time_stamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
      GROUP BY connection_id, sync_id
    ),
    aggregated AS (
      SELECT
        connection_id,
        MAX(endTs) AS lastSyncAt,
        ARRAY_AGG(syncStatus ORDER BY endTs DESC LIMIT 1)[SAFE_OFFSET(0)] AS lastSyncStatus,
        AVG(TIMESTAMP_DIFF(endTs, startTs, MINUTE)) AS avgDurationMin,
        ARRAY_AGG(STRUCT(endTs, syncStatus) ORDER BY endTs DESC LIMIT 10) AS recentSyncs,
        COUNTIF(
          endTs >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
          AND REGEXP_CONTAINS(UPPER(syncStatus), r'FAILURE')
        ) AS failureCount7d
      FROM sync_pairs
      WHERE startTs IS NOT NULL AND endTs IS NOT NULL
      GROUP BY connection_id
    )
    SELECT
      connection_id AS connectionId,
      lastSyncAt,
      lastSyncStatus,
      avgDurationMin,
      failureCount7d,
      TO_JSON_STRING(recentSyncs) AS recentSyncsJson
    FROM aggregated
  `, {}, { location: config.fivetranMetadataLocation });

  return rows.map((row) => {
    const recentSyncs = parseJsonField(row.recentSyncsJson) || [];
    let consecutiveFailures = 0;
    for (const sync of recentSyncs) {
      if (/FAILURE/i.test(sync.syncStatus || "")) {
        consecutiveFailures += 1;
      } else {
        break;
      }
    }

    return {
      connectionId: row.connectionId,
      lastSyncAt: row.lastSyncAt,
      lastSyncStatus: row.lastSyncStatus,
      avgDurationMin: row.avgDurationMin,
      failureCount7d: row.failureCount7d,
      consecutiveFailures
    };
  });
}

async function getConnectionSyncHistory(connectionId, limit = 12) {
  return safeSelect(`
    WITH sync_pairs AS (
      SELECT
        sync_id AS id,
        connection_id AS connectionId,
        MIN(IF(event = 'sync_start', time_stamp, NULL)) AS startedAt,
        MAX(IF(event = 'sync_end', time_stamp, NULL)) AS endedAt,
        ARRAY_AGG(
          COALESCE(
            JSON_VALUE(message_data, '$.status'),
            JSON_VALUE(message_data, '$.data.status'),
            JSON_VALUE(message_data, '$.result.status'),
            event
          )
          ORDER BY time_stamp DESC
          LIMIT 1
        )[SAFE_OFFSET(0)] AS status
      FROM ${tablePath(config.fivetranMetadataDataset, "log")}
      WHERE connection_id = @connectionId
        AND event IN ('sync_start', 'sync_end')
      GROUP BY sync_id, connection_id
    )
    SELECT
      id,
      connectionId,
      startedAt,
      endedAt,
      status,
      TIMESTAMP_DIFF(endedAt, startedAt, MINUTE) AS durationMin
    FROM sync_pairs
    WHERE endedAt IS NOT NULL
    ORDER BY endedAt DESC
    LIMIT @limit
  `, { connectionId, limit }, { location: config.fivetranMetadataLocation });
}

async function getTableUsage() {
  return safeSelect(`
    SELECT
      ref.dataset_id AS datasetId,
      ref.table_id AS tableId,
      MAX(creation_time) AS lastQueryTs,
      COUNT(*) AS queryCount30d
    FROM ${jobsInformationSchemaPath()},
      UNNEST(referenced_tables) AS ref
    WHERE state = 'DONE'
      AND error_result IS NULL
      AND job_type = 'QUERY'
      AND statement_type = 'SELECT'
      -- Fivetran's own loader service account reads tables while syncing; that is not downstream usage.
      AND user_email NOT LIKE '%fivetran-production.iam.gserviceaccount.com'
      AND creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
      AND ref.project_id = @projectId
      AND ref.dataset_id IN UNNEST(@datasets)
    GROUP BY datasetId, tableId
  `, {
    projectId: config.bigqueryProjectId,
    datasets: config.rawDatasets
  }, { location: config.fivetranMetadataLocation });
}

async function getBqQueryActivity(tableFqn, days = 30) {
  const parts = String(tableFqn || "").split(".").filter(Boolean);
  if (parts.length < 2 || parts.length > 3) {
    throw new Error("table must be provided as dataset.table or project.dataset.table");
  }

  const [projectId, datasetId, tableId] = parts.length === 3
    ? parts
    : [config.bigqueryProjectId, parts[0], parts[1]];
  const rows = await safeSelect(`
    SELECT
      MAX(creation_time) AS lastQueryTs,
      COUNT(*) AS queryCount
    FROM ${jobsInformationSchemaPath()},
      UNNEST(referenced_tables) AS ref
    WHERE state = 'DONE'
      AND error_result IS NULL
      AND job_type = 'QUERY'
      AND statement_type = 'SELECT'
      AND user_email NOT LIKE '%fivetran-production.iam.gserviceaccount.com'
      AND creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
      AND ref.project_id = @projectId
      AND ref.dataset_id = @datasetId
      AND ref.table_id = @tableId
  `, {
    days: Number(days),
    projectId,
    datasetId,
    tableId
  }, { location: config.fivetranMetadataLocation });

  return {
    projectId,
    datasetId,
    tableId,
    days: Number(days),
    lastQueryTs: rows[0]?.lastQueryTs || null,
    queryCount: Number(rows[0]?.queryCount || 0)
  };
}

async function getMonthlyMarByTeam(reportMonth) {
  const [marRows, policies] = await Promise.all([
    safeSelect(`
      SELECT
        conn.connection_id AS connectionId,
        mar.connection_name AS connectionName,
        CAST(SUM(mar.incremental_rows) AS INT64) AS monthlyMar
      FROM ${tablePath(config.fivetranMetadataDataset, "incremental_mar")} AS mar
      JOIN ${tablePath(config.fivetranMetadataDataset, "connection")} AS conn
        ON conn.connection_name = mar.connection_name
      WHERE COALESCE(mar.free_type, 'PAID') != 'SYSTEM'
        AND DATE_TRUNC(mar.measured_date, MONTH) = DATE(@reportMonth)
      GROUP BY connectionId, connectionName
    `, { reportMonth }, { location: config.fivetranMetadataLocation }),
    getConnectionPolicies()
  ]);

  const policyByConnection = new Map(policies.map((policy) => [policy.connectionId, policy]));
  const teams = new Map();

  for (const row of marRows) {
    const policy = policyByConnection.get(row.connectionId);
    const teamId = policy?.teamOwner || "unassigned";
    if (!teams.has(teamId)) {
      teams.set(teamId, {
        teamId,
        teamSlackChannel: policy?.teamSlackChannel || "",
        totalMar: 0,
        connections: []
      });
    }
    const team = teams.get(teamId);
    team.totalMar += Number(row.monthlyMar || 0);
    team.connections.push({
      connectionId: row.connectionId,
      connectionName: row.connectionName,
      monthlyMar: Number(row.monthlyMar || 0)
    });
  }

  return [...teams.values()]
    .map((team) => ({
      ...team,
      connections: team.connections.sort((a, b) => b.monthlyMar - a.monthlyMar).slice(0, 20)
    }))
    .sort((a, b) => b.totalMar - a.totalMar);
}

async function getPendingApprovalsForTeam(teamId) {
  const rows = await safeSelect(`
    SELECT
      approval.approval_id AS id,
      approval.action_id AS actionId,
      approval.ts_created AS createdAt,
      approval.status,
      approval.risk_level AS riskLevel,
      approval.title,
      approval.description,
      approval.estimated_mar_savings AS estimatedMarSavings,
      action.sub_agent AS subAgent,
      action.connection_id AS connectionId,
      action.action_type AS actionType,
      action.gemini_reasoning AS geminiReasoning,
      TO_JSON_STRING(action.action_payload) AS actionPayloadJson
    FROM ${tablePath(config.conductorDataset, "approval_queue")} AS approval
    JOIN ${tablePath(config.conductorDataset, "agent_actions")} AS action
      ON approval.action_id = action.action_id
    LEFT JOIN ${tablePath(config.conductorDataset, "connection_policy")} AS policy
      ON action.connection_id = policy.connection_id
    WHERE approval.status = 'PENDING'
      AND COALESCE(policy.team_owner, 'unassigned') = @teamId
    ORDER BY approval.ts_created DESC
  `, { teamId });

  return rows.map((row) => ({
    ...row,
    actionPayload: parseJsonField(row.actionPayloadJson)
  }));
}

async function writeChargebackRecord(record) {
  await runQuery(`
    INSERT INTO ${tablePath(config.conductorDataset, "monthly_chargebacks")} (
      report_id,
      report_month,
      team_id,
      team_name,
      team_slack_channel,
      total_mar,
      budget_mar,
      cost_usd_estimated,
      budget_usd,
      top_connection_1,
      top_connection_1_mar,
      top_connection_2,
      top_connection_2_mar,
      top_connection_3,
      top_connection_3_mar,
      pending_optimizations_count,
      potential_savings_mar,
      report_url,
      chargeback_message,
      generated_at
    ) VALUES (
      @reportId,
      DATE(@reportMonth),
      @teamId,
      @teamName,
      @teamSlackChannel,
      @totalMar,
      @budgetMar,
      @costUsdEstimated,
      @budgetUsd,
      @topConnection1,
      @topConnection1Mar,
      @topConnection2,
      @topConnection2Mar,
      @topConnection3,
      @topConnection3Mar,
      @pendingOptimizationsCount,
      @potentialSavingsMar,
      @reportUrl,
      @chargebackMessage,
      TIMESTAMP(@generatedAt)
    )
  `, {
    reportId: record.reportId,
    reportMonth: record.reportMonth,
    teamId: record.teamId,
    teamName: record.teamName || null,
    teamSlackChannel: record.teamSlackChannel || null,
    totalMar: Number(record.totalMar || 0),
    budgetMar: Number(record.budgetMar || 0),
    costUsdEstimated: Number(record.costUsdEstimated || 0),
    budgetUsd: Number(record.budgetUsd || 0),
    topConnection1: record.topConnection1 || null,
    topConnection1Mar: Number(record.topConnection1Mar || 0),
    topConnection2: record.topConnection2 || null,
    topConnection2Mar: Number(record.topConnection2Mar || 0),
    topConnection3: record.topConnection3 || null,
    topConnection3Mar: Number(record.topConnection3Mar || 0),
    pendingOptimizationsCount: Number(record.pendingOptimizationsCount || 0),
    potentialSavingsMar: Number(record.potentialSavingsMar || 0),
    reportUrl: record.reportUrl || null,
    chargebackMessage: record.chargebackMessage || null,
    generatedAt: record.generatedAt
  }, {
    types: {
      teamName: "STRING",
      teamSlackChannel: "STRING",
      topConnection1: "STRING",
      topConnection2: "STRING",
      topConnection3: "STRING",
      reportUrl: "STRING",
      chargebackMessage: "STRING"
    }
  });
}

module.exports = {
  acknowledgeAlert,
  createAlert,
  ensureConductorSchema,
  getBqQueryActivity,
  getActionById,
  getApprovalById,
  getConnectionMetadata,
  getConnectionPolicies,
  getConnectionPolicy,
  getConnectionSyncHistory,
  getMarByConnection,
  getMarHistoryByConnection,
  getMonthlyMarByTeam,
  getPendingApprovalsForTeam,
  getSyncStats,
  getTableUsage,
  getTraceByRunId,
  getWorkspaceSetting,
  insertAction,
  insertApproval,
  insertTraceSteps,
  listActions,
  listAlerts,
  listApprovals,
  listPendingActions,
  listTraceRuns,
  resolveApproval,
  setWorkspaceSetting,
  updateAction,
  upsertConnectionPolicy,
  writeChargebackRecord
};