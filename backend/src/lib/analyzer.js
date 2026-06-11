const { randomUUID } = require("node:crypto");
const bigquery = require("./bigquery");
const events = require("./events");
const { buildPortfolio } = require("./portfolio");
const { executeAction } = require("./actions");

const ALLOWED_FREQUENCIES = [5, 15, 30, 60, 120, 180, 360, 480, 720, 1440];

function buildEquivalentKey(connectionId, actionType) {
  // Dedup by connection + action type: payloads vary slightly between runs
  // (timestamps, recomputed MAR figures), but a pending PAUSE on a connector
  // is still the same pending PAUSE.
  return `${connectionId}:${actionType}`;
}

function nextSlowerFrequency(connection) {
  const current = connection.syncFrequencyMin || 0;
  const minAllowed = connection.minSyncFrequencyMin || 0;

  for (const candidate of ALLOWED_FREQUENCIES) {
    if (candidate > current && (minAllowed === 0 || candidate >= minAllowed)) {
      return candidate;
    }
  }

  return null;
}

async function createProposal(connection, proposal, pendingKeys, run) {
  const equivalentKey = buildEquivalentKey(connection.id, proposal.actionType, proposal.actionPayload);
  if (pendingKeys.has(equivalentKey)) {
    run.trace({
      subAgent: proposal.subAgent,
      stepType: "REASONING",
      content: `Skipped "${proposal.title}": an equivalent proposal is already pending for ${connection.id}.`
    });
    return null;
  }

  if (connection.customPolicy && proposal.riskLevel === "LOW") {
    proposal = { ...proposal, riskLevel: "MEDIUM" };
    run.trace({
      subAgent: proposal.subAgent,
      stepType: "REASONING",
      content: `Custom policy present on ${connection.id} ("${connection.customPolicy}"). Risk escalated LOW -> MEDIUM so a human evaluates the policy before execution.`
    });
  }

  const actionId = randomUUID();
  const approvalId = proposal.riskLevel === "LOW" && connection.autoOptimize ? null : randomUUID();
  const timestamp = new Date().toISOString();

  const ruleReasoning = [
    proposal.description,
    `Current MAR: ${connection.monthlyMarCurrent} / budget ${connection.monthlyMarBudget || "n/a"}.`,
    `Estimated savings: ${proposal.estimatedMarSavings} MAR/month (estimated).`,
    connection.customPolicy
      ? `Operator custom policy for this connector: "${connection.customPolicy}". This proposal was escalated to human review so the policy can be evaluated before execution.`
      : null
  ].filter(Boolean).join(" ");

  run.trace({
    subAgent: proposal.subAgent,
    stepType: "TOOL_CALL",
    toolName: approvalId ? "create_approval" : "execute_action",
    content: JSON.stringify({ actionType: proposal.actionType, riskLevel: proposal.riskLevel, connectionId: connection.id, estimatedMarSavings: proposal.estimatedMarSavings })
  });

  await bigquery.insertAction({
    actionId,
    timestamp,
    subAgent: proposal.subAgent,
    connectionId: connection.id,
    actionType: proposal.actionType,
    actionPayload: {
      ...proposal.actionPayload,
      estimatedMarSavings: proposal.estimatedMarSavings,
      runId: run.runId
    },
    triggerEvent: proposal.triggerEvent,
    geminiReasoning: ruleReasoning,
    status: approvalId ? "PENDING_APPROVAL" : "EXECUTED",
    impactMarBefore: connection.monthlyMarCurrent,
    impactMarAfter: approvalId ? null : Math.max(0, connection.monthlyMarCurrent - proposal.estimatedMarSavings)
  });

  if (approvalId) {
    await bigquery.insertApproval({
      approvalId,
      actionId,
      tsCreated: timestamp,
      status: "PENDING",
      riskLevel: proposal.riskLevel,
      title: proposal.title,
      description: proposal.description,
      estimatedMarSavings: proposal.estimatedMarSavings
    });
    events.publish("approval_created", {
      approvalId,
      actionId,
      connectionId: connection.id,
      message: proposal.title
    });
  } else {
    await executeAction(actionId);
  }

  run.trace({
    subAgent: proposal.subAgent,
    stepType: "TOOL_RESULT",
    toolName: approvalId ? "create_approval" : "execute_action",
    content: approvalId
      ? `Approval ${approvalId} queued (${proposal.riskLevel} risk) for action ${actionId}.`
      : `Action ${actionId} auto-executed (LOW risk, auto-optimize enabled).`
  });

  pendingKeys.add(equivalentKey);
  return { actionId, approvalId };
}

async function analyzeConnections(targetConnectionId = null, { runId: providedRunId = null, onStep = null } = {}) {
  const runId = providedRunId || randomUUID();
  const traceSteps = [];
  const run = {
    runId,
    trace(step) {
      const fullStep = { seq: traceSteps.length, ts: new Date().toISOString(), ...step };
      traceSteps.push(fullStep);
      if (onStep) {
        try {
          onStep(fullStep);
        } catch {
          // Streaming is best effort; never break the analysis.
        }
      }
    }
  };

  run.trace({
    subAgent: "ORCHESTRATOR",
    stepType: "MISSION",
    content: targetConnectionId
      ? `Analyze connector ${targetConnectionId} against its governance policy and propose corrective actions.`
      : "Analyze the full Fivetran portfolio against governance policies and propose corrective actions."
  });
  run.trace({
    subAgent: "ORCHESTRATOR",
    stepType: "TOOL_CALL",
    toolName: "build_portfolio",
    content: JSON.stringify({ force: true, target: targetConnectionId || "all" })
  });

  const [{ connections }, pendingActions] = await Promise.all([
    buildPortfolio({ force: true }),
    bigquery.listPendingActions()
  ]);

  run.trace({
    subAgent: "ORCHESTRATOR",
    stepType: "TOOL_RESULT",
    toolName: "build_portfolio",
    content: `${connections.length} connector(s) discovered, ${pendingActions.length} action(s) already pending.`
  });

  const pendingKeys = new Set(
    pendingActions.map((action) => buildEquivalentKey(action.connectionId, action.actionType, action.actionPayload))
  );

  const results = [];
  const candidates = targetConnectionId
    ? connections.filter((connection) => connection.id === targetConnectionId)
    : connections;

  for (const connection of candidates) {
    if (!connection.policyConfigured) {
      run.trace({
        subAgent: "ORCHESTRATOR",
        stepType: "REASONING",
        content: `${connection.name} (${connection.id}) skipped: no governance policy configured, the agent never acts without one.`
      });
      continue;
    }

    run.trace({
      subAgent: "ORCHESTRATOR",
      stepType: "TRANSFER",
      content: `Handing ${connection.name} (${connection.id}) to COST and PERF sub-agents. SLA tier ${connection.slaTier}, MAR ${connection.monthlyMarCurrent}/${connection.monthlyMarBudget || "no budget"}, cadence ${connection.syncFrequencyMin} min.`
    });

    const proposals = [];

    if (connection.monthlyMarBudget > 0 && connection.monthlyMarCurrent > connection.monthlyMarBudget) {
      const newSyncFrequencyMin = nextSlowerFrequency(connection);
      run.trace({
        subAgent: "COST",
        stepType: "REASONING",
        content: `${connection.name} is OVER BUDGET: ${connection.monthlyMarCurrent} MAR vs ${connection.monthlyMarBudget} allowed. ${newSyncFrequencyMin ? `Slowing cadence ${connection.syncFrequencyMin} -> ${newSyncFrequencyMin} min stays within the SLA floor (${connection.minSyncFrequencyMin} min).` : "No slower cadence available within the SLA floor; no frequency action possible."}`
      });
      if (newSyncFrequencyMin) {
        const estimatedMarSavings = Math.round(
          connection.monthlyMarCurrent * (1 - connection.syncFrequencyMin / newSyncFrequencyMin)
        );

        proposals.push({
          subAgent: "COST",
          actionType: "CHANGE_FREQUENCY",
          title: `Slow ${connection.name} to ${newSyncFrequencyMin} minutes`,
          description: `${connection.name} is above its approved MAR budget. Conductor proposes a slower sync cadence while staying within the SLA floor.`,
          riskLevel: "LOW",
          estimatedMarSavings,
          triggerEvent: "budget_threshold",
          actionPayload: {
            currentSyncFrequencyMin: connection.syncFrequencyMin,
            newSyncFrequencyMin
          }
        });
      }
    }

    const blockableColdTables = connection.coldTablesList.filter(() => connection.slaTier !== "CRITICAL");
    if (connection.coldTablesList.length > 0) {
      run.trace({
        subAgent: "COST",
        stepType: "REASONING",
        content: connection.slaTier === "CRITICAL"
          ? `${connection.coldTablesList.length} cold table(s) found on ${connection.name}, but SLA tier is CRITICAL: hands off, no proposal.`
          : `${connection.coldTablesList.length} cold table(s) on ${connection.name} generate MAR with zero downstream queries in 30 days: ${connection.coldTablesList.map((table) => `${table.name} (${table.monthlyMar} MAR)`).join(", ")}. Proposing BLOCK_TABLE (MEDIUM risk, human approval required).`
      });
    }
    if (blockableColdTables.length > 0) {
      proposals.push({
        subAgent: "COST",
        actionType: "BLOCK_TABLE",
        title: `Disable ${blockableColdTables.length} cold table(s) on ${connection.name}`,
        description: `${blockableColdTables.length} table(s) generate MAR but have no downstream queries in the last 30 days.`,
        riskLevel: "MEDIUM",
        estimatedMarSavings: blockableColdTables.reduce((sum, table) => sum + table.monthlyMar, 0),
        triggerEvent: "cold_tables_detected",
        actionPayload: {
          tables: blockableColdTables.map((table) => ({
            schemaName: table.schema,
            tableName: table.name,
            monthlyMar: table.monthlyMar,
            daysSinceLastQuery: table.daysSinceLastQuery
          }))
        }
      });
    }

    if (connection.consecutiveFailures >= 3 && connection.slaTier !== "CRITICAL") {
      run.trace({
        subAgent: "PERF",
        stepType: "REASONING",
        content: `${connection.name} failed ${connection.consecutiveFailures} consecutive syncs. Proposing PAUSE (HIGH risk) to stop the waste until the source is fixed.`
      });
      proposals.push({
        subAgent: "PERF",
        actionType: "PAUSE",
        title: `Pause ${connection.name} after repeated failures`,
        description: `${connection.name} has failed ${connection.consecutiveFailures} syncs in a row. Pausing prevents further waste until the source is fixed.`,
        riskLevel: "HIGH",
        estimatedMarSavings: connection.monthlyMarCurrent,
        triggerEvent: "repeated_failures",
        actionPayload: {
          consecutiveFailures: connection.consecutiveFailures
        }
      });
    }

    if (proposals.length === 0) {
      run.trace({
        subAgent: "ORCHESTRATOR",
        stepType: "REASONING",
        content: `${connection.name} is healthy: within budget, no cold tables to act on, no repeated failures. No action needed.`
      });
    }

    for (const proposal of proposals) {
      const result = await createProposal(connection, proposal, pendingKeys, run);
      if (result) {
        results.push(result);
      }
    }
  }

  run.trace({
    subAgent: "ORCHESTRATOR",
    stepType: "REASONING",
    content: `Run complete: ${results.length} new proposal(s) created across ${candidates.length} connector(s).`
  });

  try {
    await bigquery.insertTraceSteps(runId, traceSteps);
  } catch (error) {
    console.error("Failed to persist agent trace", error.message);
  }

  events.publish("analysis_complete", {
    connectionId: targetConnectionId,
    runId,
    created: results.length,
    message: `Analysis completed with ${results.length} new proposal(s).`
  });

  return results;
}

module.exports = {
  analyzeConnections
};