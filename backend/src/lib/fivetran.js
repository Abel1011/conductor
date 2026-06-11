const { Buffer } = require("node:buffer");
const config = require("./config");

function getAuthHeader() {
  if (!process.env.FIVETRAN_API_KEY || !process.env.FIVETRAN_API_SECRET) {
    throw new Error("Missing Fivetran API credentials in environment.");
  }

  const pair = `${process.env.FIVETRAN_API_KEY}:${process.env.FIVETRAN_API_SECRET}`;
  return `Basic ${Buffer.from(pair).toString("base64")}`;
}

async function fivetranRequest(path, options = {}) {
  const response = await fetch(`${config.fivetranApiBaseUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(15000),
    headers: {
      Accept: "application/json;version=2",
      Authorization: getAuthHeader(),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      body = { raw: text };
    }
  }

  console.log(`[fivetran] ${options.method || "GET"} ${path} -> ${response.status}`);

  if (!response.ok) {
    const error = new Error(`Fivetran request failed (${response.status}) for ${path}`);
    error.statusCode = response.status;
    error.body = body;
    throw error;
  }

  return body?.data ?? body ?? null;
}

async function listConnections() {
  const data = await fivetranRequest("/connections");
  return data?.items ?? [];
}

async function getConnection(connectionId) {
  return fivetranRequest(`/connections/${encodeURIComponent(connectionId)}`);
}

async function listSchemas(connectionId) {
  const data = await fivetranRequest(`/connections/${encodeURIComponent(connectionId)}/schemas`);
  return data?.items ?? data?.schemas ?? data ?? [];
}

async function patchSyncFrequency(connectionId, minutes) {
  return fivetranRequest(`/connections/${encodeURIComponent(connectionId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ sync_frequency: minutes })
  });
}

async function setTableEnabled(connectionId, schemaName, tableName, enabled) {
  return fivetranRequest(
    `/connections/${encodeURIComponent(connectionId)}/schemas/${encodeURIComponent(schemaName)}/tables/${encodeURIComponent(tableName)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ enabled })
    }
  );
}

async function setColumnEnabled(connectionId, schemaName, tableName, columnName, enabled) {
  return fivetranRequest(
    `/connections/${encodeURIComponent(connectionId)}/schemas/${encodeURIComponent(schemaName)}/tables/${encodeURIComponent(tableName)}/columns/${encodeURIComponent(columnName)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ enabled })
    }
  );
}

async function setPaused(connectionId, paused) {
  return fivetranRequest(`/connections/${encodeURIComponent(connectionId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ paused })
  });
}

async function triggerSync(connectionId) {
  try {
    return await fivetranRequest(`/connections/${encodeURIComponent(connectionId)}/sync`, {
      method: "POST"
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return fivetranRequest(`/connections/${encodeURIComponent(connectionId)}/force`, {
        method: "POST"
      });
    }

    throw error;
  }
}

async function reloadSchema(connectionId) {
  return fivetranRequest(`/connections/${encodeURIComponent(connectionId)}/schemas/reload`, {
    method: "POST"
  });
}

module.exports = {
  fivetranRequest,
  getConnection,
  listConnections,
  listSchemas,
  patchSyncFrequency,
  reloadSchema,
  setColumnEnabled,
  setPaused,
  setTableEnabled,
  triggerSync
};