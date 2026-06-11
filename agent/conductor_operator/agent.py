import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from google.adk.agents import Agent
from google.adk.tools.mcp_tool.mcp_session_manager import StdioConnectionParams
from google.adk.tools.mcp_tool.mcp_toolset import McpToolset
from mcp import StdioServerParameters

_BACKEND_ENV = Path(__file__).resolve().parents[2] / "backend" / ".env"
load_dotenv(_BACKEND_ENV)
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)

if os.environ.get("GOOGLE_API_KEY"):
    os.environ.pop("GOOGLE_CLOUD_PROJECT", None)
    os.environ.pop("GOOGLE_CLOUD_LOCATION", None)

BACKEND_BASE_URL = os.environ.get("CONDUCTOR_BACKEND_URL", "http://localhost:5000")
INTERNAL_SECRET = os.environ.get("INTERNAL_TRIGGER_SECRET", "")

# retries=2 survives backend dev-server restarts (node --watch) mid-mission.
_client = httpx.Client(
    base_url=BACKEND_BASE_URL,
    timeout=60.0,
    transport=httpx.HTTPTransport(retries=2),
)

CURRENT_RUN_ID: str | None = None


def set_run_id(run_id: str) -> None:
    global CURRENT_RUN_ID
    CURRENT_RUN_ID = run_id


def _get(path: str, params: dict | None = None) -> dict:
    response = _client.get(path, params=params or {})
    response.raise_for_status()
    return response.json()


def _post(path: str, body: dict) -> dict:
    response = _client.post(path, json=body)
    response.raise_for_status()
    return response.json()

def get_portfolio() -> dict:
    """Returns the full Conductor portfolio: every Fivetran connection enriched with
    monthly MAR (rows synced), MAR by table, budget from team policy, budget %, cold
    tables (synced but never queried downstream in 30 days), health status and policy.
    Always call this FIRST to understand the fleet before any other analysis."""
    return _get("/tools/portfolio", {"force": "true"})


def get_table_query_activity(table_fqn: str, days: int = 30) -> dict:
    """Returns BigQuery downstream query activity for a destination table over the last
    N days: last query timestamp and query count. Use it to verify a table is truly
    cold (zero downstream queries) before proposing to disable it.

    Args:
        table_fqn: fully qualified table, e.g. "shop_raw.clickstream_raw".
        days: lookback window in days (default 30).
    """
    return _get("/tools/bq-query-activity", {"table": table_fqn, "days": days})


def get_sync_history(connection_id: str, limit: int = 10) -> dict:
    """Returns the recent sync history (start/end/status/duration) for one Fivetran
    connection, read from the fivetran_metadata Platform Connector logs in BigQuery.

    Args:
        connection_id: Fivetran connection id, e.g. "pitched_hurray".
        limit: number of recent syncs to return.
    """
    return _get("/tools/sync-history", {"connection_id": connection_id, "n": limit})


def estimate_cost_usd(mar_count: int) -> dict:
    """Converts a MAR (monthly active rows) count into an ESTIMATED USD figure using the
    configured rate (Fivetran does not expose account pricing). Always label the result
    as estimated when reporting to the operator.

    Args:
        mar_count: monthly active rows to price.
    """
    return _get("/tools/estimate-cost-usd", {"mar_count": mar_count})


def simulate_optimization_impact(connection_id: str, action_type: str,
                                 frequency_min: int | None = None,
                                 schema: str | None = None,
                                 table: str | None = None) -> dict:
    """Simulates the MAR impact of a proposed optimization BEFORE executing it.

    Args:
        connection_id: Fivetran connection id.
        action_type: one of CHANGE_FREQUENCY, BLOCK_TABLE, PAUSE.
        frequency_min: target sync frequency in minutes (for CHANGE_FREQUENCY).
        schema: destination schema name (for BLOCK_TABLE).
        table: table name (for BLOCK_TABLE).
    """
    body: dict = {"connection_id": connection_id, "action_type": action_type, "params": {}}
    if frequency_min is not None:
        body["params"]["frequencyMin"] = frequency_min
    if schema:
        body["params"]["schema"] = schema
    if table:
        body["params"]["table"] = table
    return _post("/tools/simulate-optimization-impact", body)


def create_approval_request(connection_id: str, action_type: str, reasoning: str,
                            estimated_mar_savings: int,
                            frequency_min: int | None = None,
                            schema: str | None = None,
                            tables: list[str] | None = None,
                            table_mar_savings: list[int] | None = None) -> dict:
    """Creates a pending approval in the Conductor approval queue (BigQuery) so a HUMAN
    operator can review and approve/reject the proposed action in the console. This is
    the REQUIRED path for MEDIUM/HIGH risk actions (BLOCK_TABLE, PAUSE) and any action
    on a connection whose policy has auto_optimize=false. Include your full reasoning.

    IMPORTANT: create ONE approval per connection per action type. For BLOCK_TABLE,
    pass ALL cold tables of the connection together in `tables` — do NOT create one
    approval per table.

    Args:
        connection_id: Fivetran connection id the action targets.
        action_type: CHANGE_FREQUENCY, BLOCK_TABLE or PAUSE.
        reasoning: justification in markdown citing real numbers (MAR, query activity).
        estimated_mar_savings: TOTAL estimated monthly MAR saved if executed.
        frequency_min: target frequency (CHANGE_FREQUENCY only).
        schema: destination schema of the tables (BLOCK_TABLE only).
        tables: ALL table names to disable in that schema (BLOCK_TABLE only).
        table_mar_savings: monthly MAR of each table, aligned by index with `tables`,
            so operators can approve/reject each table individually with real numbers.
    """
    payload: dict = {}
    if frequency_min is not None:
        payload["newSyncFrequencyMin"] = frequency_min
    if tables:
        payload["tables"] = [
            {
                "schemaName": schema,
                "tableName": table_name,
                **(
                    {"monthlyMar": table_mar_savings[i]}
                    if table_mar_savings and i < len(table_mar_savings)
                    else {}
                ),
            }
            for i, table_name in enumerate(tables)
        ]
    elif schema:
        payload["schema"] = schema
    if estimated_mar_savings:
        payload["estimatedMarSavings"] = estimated_mar_savings
    if CURRENT_RUN_ID:
        payload["runId"] = CURRENT_RUN_ID
    return _post("/tools/create-approval", {
        "connection_id": connection_id,
        "action_type": action_type,
        "reasoning": reasoning,
        "estimated_mar_savings": estimated_mar_savings,
        "payload": payload,
        "sub_agent": "CONDUCTOR_OPERATOR_ADK",
    })


def log_executed_action(connection_id: str, action_type: str, reasoning: str,
                        payload_json: str = "{}") -> dict:
    """Records an action you already executed directly (LOW risk only, e.g. a
    CHANGE_FREQUENCY allowed by policy auto_optimize=true) into the Conductor audit
    trail in BigQuery, so the console and spend page reflect it.

    Args:
        connection_id: Fivetran connection id.
        action_type: action performed.
        reasoning: why it was performed.
        payload_json: JSON string with action parameters.
    """
    import json
    payload = json.loads(payload_json or "{}")
    if CURRENT_RUN_ID:
        payload["runId"] = CURRENT_RUN_ID
    return _post("/tools/log-action", {
        "connection_id": connection_id,
        "action_type": action_type,
        "reasoning": reasoning,
        "payload": payload,
        "sub_agent": "CONDUCTOR_OPERATOR_ADK",
        "status": "EXECUTED",
    })


fivetran_mcp = McpToolset(
    connection_params=StdioConnectionParams(
        server_params=StdioServerParameters(
            command="uvx",
            args=["--from", "git+https://github.com/fivetran/fivetran-mcp", "fivetran-mcp"],
            env={
                "FIVETRAN_API_KEY": os.environ.get("FIVETRAN_API_KEY", ""),
                "FIVETRAN_API_SECRET": os.environ.get("FIVETRAN_API_SECRET", ""),
                "FIVETRAN_ALLOW_WRITES": os.environ.get("FIVETRAN_ALLOW_WRITES", "true"),
            },
        ),
        timeout=60.0,
    ),
    tool_filter=[
        "list_connections",
        "get_connection_details",
        "get_connection_schema_config",
        "modify_connection",
        "modify_connection_table_config",
        "sync_connection",
        "list_groups",
        "list_destinations",
    ],
)

SHARED_RULES = """
Shared operating rules (apply to EVERY specialist):
- You govern a REAL Fivetran fleet syncing into BigQuery (project conductor-260609-2862).
- Risk routing is MANDATORY:
  - LOW risk (CHANGE_FREQUENCY within policy, auto_optimize=true): you MAY execute
    directly via MCP modify_connection, then log_executed_action().
  - MEDIUM (BLOCK_TABLE) and HIGH (PAUSE) risk, or auto_optimize=false:
    create_approval_request() and STOP. A human approves in the Conductor console;
    the backend executes. NEVER execute these yourself.
  - NEVER touch connections whose policy sla is CRITICAL (e.g. the Platform
    Connector fivetran_metadata).
- Style: precise, numeric, honest. Cite connection ids, table names, MAR figures and
  evidence. Always label USD figures as "estimated". If data is missing (e.g. MAR
  baseline still accruing), say so plainly instead of inventing numbers.
- Teamwork: when the mission involves multiple specialists and YOUR part is done,
  summarize your findings briefly and transfer_to_agent back to "conductor" so it can
  engage the next specialist. Only end the conversation if you are the conductor.
"""

MODEL = os.environ.get("AGENT_MODEL", "gemini-3.5-flash")

gate_agent = Agent(
    name="gate_agent",
    model=MODEL,
    description="Reviews newly created Fivetran connectors BEFORE they accumulate MAR: "
                "checks schema, sync frequency and policy fit, then queues a review.",
    instruction="You are the Gate Agent of Conductor." + SHARED_RULES + """
When a new connector appears (create_connector webhook or operator request):
  1. get_connection_details + get_connection_schema_config via Fivetran MCP for ground truth.
  2. get_portfolio() to compare against similar existing connections and policies.
  3. Recommend: initial sync frequency, tables to exclude, expected MAR range.
  4. create_approval_request() with your recommendation — never apply it yourself.""",
    tools=[get_portfolio, create_approval_request, fivetran_mcp],
)

cost_agent = Agent(
    name="cost_agent",
    model=MODEL,
    description="Audits the fleet for MAR waste: cold tables (synced but never queried), "
                "over-sync vs policy, connections over budget. Quantifies savings.",
    instruction="You are the Cost Agent of Conductor." + SHARED_RULES + """
Audit procedure (multi-step, always in this order):
  1. get_portfolio() for the enriched fleet view (budgets, cold tables, health).
  2. Cross-check suspicious tables with get_table_query_activity() — never propose
     disabling a table without verifying it is cold (zero downstream queries, 30 days).
  3. Use Fivetran MCP (get_connection_details, get_connection_schema_config) for live truth.
  4. simulate_optimization_impact() to quantify savings; estimate_cost_usd() to express
     them in estimated USD.
  5. Route by risk (see shared rules). Group ALL cold tables of one connection into a
     SINGLE create_approval_request (tables=[...]) — never one approval per table.
     Then report: findings table, numbers, what you queued for approval and why.""",
    tools=[get_portfolio, get_table_query_activity, estimate_cost_usd,
           simulate_optimization_impact, create_approval_request, log_executed_action,
           fivetran_mcp],
)

perf_agent = Agent(
    name="perf_agent",
    model=MODEL,
    description="Triages sync failures and latency: classifies the failure pattern, "
                "checks history, and proposes or executes the fix per risk policy.",
    instruction="You are the Perf Agent of Conductor." + SHARED_RULES + """
Triage procedure for a degraded or failing connection:
  1. get_sync_history() — is this the first failure or a repeated pattern (>=3)?
  2. get_connection_details via Fivetran MCP for current status and config.
  3. Classify: auth failure / schema drift / quota / unknown.
  4. LOW risk fix (e.g. trigger sync_connection after transient failure): execute and
     log_executed_action(). Repeated failures on non-CRITICAL connections: propose PAUSE
     via create_approval_request(). Never pause CRITICAL connections.""",
    tools=[get_sync_history, create_approval_request, log_executed_action, fivetran_mcp],
)

chargeback_agent = Agent(
    name="chargeback_agent",
    model=MODEL,
    description="Produces cost attribution reports: MAR per connection/team vs budget, "
                "estimated USD, top drivers and available savings from pending approvals.",
    instruction="You are the Chargeback Agent of Conductor." + SHARED_RULES + """
Reporting procedure:
  1. get_portfolio() for MAR per connection, budgets and policies.
  2. estimate_cost_usd() for each relevant MAR figure (always "estimated").
  3. Produce a clear report: MAR consumed vs budget per connection, top drivers,
     pending optimizations and their potential savings. Informative CFO tone, no blame.
  4. You are read-only: never execute changes or create approvals.""",
    tools=[get_portfolio, estimate_cost_usd],
)

root_agent = Agent(
    name="conductor",
    model=MODEL,
    description="Orchestrator of the Conductor multi-agent system for Fivetran fleet "
                "governance: routes missions to Gate, Cost, Perf and Chargeback specialists.",
    instruction="You are Conductor, the orchestrator of a multi-agent pipeline-governance system."
                + SHARED_RULES + """
You do not execute analyses yourself — you decompose the mission and delegate:
  - New/unreviewed connector or onboarding question  -> gate_agent
  - Waste audit, cold tables, over-sync, budget      -> cost_agent
  - Failures, broken or slow syncs                   -> perf_agent
  - Cost reports, spend attribution, USD estimates   -> chargeback_agent
For a FULL fleet audit you MUST consult the specialists in sequence, one at a time:
  1. transfer_to_agent -> cost_agent (waste, cold tables, budgets).
  2. When cost_agent reports back, transfer_to_agent -> perf_agent (sync health,
     failures, latency) — even if cost found nothing.
  3. When perf_agent reports back, transfer_to_agent -> chargeback_agent for the
     final spend-attribution report.
After all three report, summarize the combined findings for the operator: what was
found, what was executed (LOW risk), what awaits human approval and why.""",
    sub_agents=[gate_agent, cost_agent, perf_agent, chargeback_agent],
)
