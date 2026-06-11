import asyncio
import json
import sys
import uuid

# Windows consoles default to cp1252; LLM output may contain any Unicode char.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from google.adk.runners import InMemoryRunner
from google.genai import types

from conductor_operator import agent as conductor
from conductor_operator.agent import root_agent

MAX_CONTENT = 4000


def _shorten(value, limit: int = MAX_CONTENT) -> str:
    text = value if isinstance(value, str) else json.dumps(value, default=str, ensure_ascii=False)
    return text if len(text) <= limit else text[:limit] + " …[truncated]"


async def main() -> None:
    prompt = sys.argv[1] if len(sys.argv) > 1 else (
        "List the Fivetran connections in the account and summarize the portfolio "
        "(name, health, monthly MAR). Do not execute any changes."
    )

    run_id = str(uuid.uuid4())
    conductor.set_run_id(run_id)
    print(f"[run] {run_id}")

    steps: list[dict] = [{
        "seq": 0,
        "subAgent": "conductor",
        "stepType": "MISSION",
        "toolName": None,
        "content": prompt,
    }]

    runner = InMemoryRunner(agent=root_agent)
    session = await runner.session_service.create_session(
        app_name=runner.app_name, user_id="smoke"
    )
    content = types.Content(role="user", parts=[types.Part(text=prompt)])
    seq = 1
    async for event in runner.run_async(
        user_id="smoke", session_id=session.id, new_message=content
    ):
        author = getattr(event, "author", None) or "conductor"
        if not (event.content and event.content.parts):
            continue
        for part in event.content.parts:
            if part.function_call:
                name = part.function_call.name
                args = part.function_call.args or {}
                step_type = "TRANSFER" if name == "transfer_to_agent" else "TOOL_CALL"
                steps.append({
                    "seq": seq,
                    "subAgent": author,
                    "stepType": step_type,
                    "toolName": name,
                    "content": _shorten(args, 1500),
                })
                print(f"[{author}] tool call: {name}")
                seq += 1
            elif part.function_response:
                steps.append({
                    "seq": seq,
                    "subAgent": author,
                    "stepType": "TOOL_RESULT",
                    "toolName": part.function_response.name,
                    "content": _shorten(part.function_response.response or {}, 2500),
                })
                seq += 1
            elif part.text and part.text.strip():
                steps.append({
                    "seq": seq,
                    "subAgent": author,
                    "stepType": "REASONING",
                    "toolName": None,
                    "content": _shorten(part.text.strip()),
                })
                print(f"[{author}] {part.text.strip()[:400]}")
                seq += 1

    try:
        result = conductor._post("/tools/append-trace", {"run_id": run_id, "steps": steps})
        print(f"[trace] published {result.get('inserted', 0)} steps for run {run_id}")
    except Exception as error:
        print(f"[trace] WARNING: could not publish trace: {error}")


if __name__ == "__main__":
    asyncio.run(main())
