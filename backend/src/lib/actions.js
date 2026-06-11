const bigquery = require("./bigquery");
const events = require("./events");
const fivetran = require("./fivetran");
const { buildPortfolio, invalidatePortfolioCache } = require("./portfolio");

async function executeAction(actionId) {
  const action = await bigquery.getActionById(actionId);
  if (!action) {
    throw new Error(`Action ${actionId} was not found.`);
  }

  const snapshot = await buildPortfolio({ force: true });
  const connection = snapshot.connections.find((item) => item.id === action.connectionId);
  const payload = action.actionPayload || {};
  const beforeMar = connection?.monthlyMarCurrent ?? null;

  try {
    if (action.actionType === "CHANGE_FREQUENCY") {
      if (connection?.syncFrequencyMin && payload.previousSyncFrequencyMin === undefined) {
        payload.previousSyncFrequencyMin = connection.syncFrequencyMin;
        await bigquery.updateAction(actionId, { actionPayload: payload });
      }
      await fivetran.patchSyncFrequency(action.connectionId, payload.newSyncFrequencyMin);
    } else if (action.actionType === "BLOCK_TABLE") {
      for (const table of payload.tables || []) {
        await fivetran.setTableEnabled(action.connectionId, table.schemaName, table.tableName, false);
      }
    } else if (action.actionType === "PAUSE") {
      await fivetran.setPaused(action.connectionId, true);
    } else if (action.actionType === "UNPAUSE") {
      await fivetran.setPaused(action.connectionId, false);
    } else if (action.actionType === "REVIEW_NEW_CONNECTOR") {
      if (payload.enforced) {
        await fivetran.setPaused(action.connectionId, false);
      }
    } else {
      throw new Error(`Unsupported action type: ${action.actionType}`);
    }

    await bigquery.updateAction(actionId, {
      status: "EXECUTED",
      impactMarBefore: beforeMar,
      impactMarAfter: beforeMar !== null && payload.estimatedMarSavings
        ? Math.max(0, beforeMar - Number(payload.estimatedMarSavings))
        : beforeMar
    });

    invalidatePortfolioCache();
    events.publish("action_executed", {
      actionId,
      connectionId: action.connectionId,
      message: `Executed ${action.actionType} for ${action.connectionId}`
    });

    return bigquery.getActionById(actionId);
  } catch (error) {
    await bigquery.updateAction(actionId, { status: "FAILED" });
    events.publish("action_failed", {
      actionId,
      connectionId: action.connectionId,
      message: error.message
    });
    throw error;
  }
}

async function rejectAction(actionId) {
  await bigquery.updateAction(actionId, { status: "REJECTED" });
  events.publish("action_rejected", {
    actionId,
    message: `Rejected ${actionId}`
  });
}

async function revertAction(actionId) {
  const action = await bigquery.getActionById(actionId);
  if (!action) {
    throw new Error(`Action ${actionId} was not found.`);
  }
  if (action.status !== "EXECUTED") {
    throw new Error(`Only EXECUTED actions can be reverted (current status: ${action.status}).`);
  }

  const payload = action.actionPayload || {};

  if (action.actionType === "BLOCK_TABLE") {
    for (const table of payload.tables || []) {
      await fivetran.setTableEnabled(action.connectionId, table.schemaName, table.tableName, true);
    }
  } else if (action.actionType === "PAUSE") {
    await fivetran.setPaused(action.connectionId, false);
  } else if (action.actionType === "UNPAUSE") {
    await fivetran.setPaused(action.connectionId, true);
  } else if (action.actionType === "CHANGE_FREQUENCY") {
    if (!payload.previousSyncFrequencyMin) {
      throw new Error("The previous sync frequency was not recorded, so this action cannot be reverted automatically.");
    }
    await fivetran.patchSyncFrequency(action.connectionId, payload.previousSyncFrequencyMin);
  } else {
    throw new Error(`Action type ${action.actionType} cannot be reverted automatically.`);
  }

  await bigquery.updateAction(actionId, { status: "ROLLED_BACK" });
  invalidatePortfolioCache();
  events.publish("action_rolled_back", {
    actionId,
    connectionId: action.connectionId,
    message: `Reverted ${action.actionType} on ${action.connectionId}`
  });

  return bigquery.getActionById(actionId);
}

module.exports = {
  executeAction,
  rejectAction,
  revertAction
};