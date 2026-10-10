"""The PydanticAI course agent: one model (through Portkey), two tools, and an audit trail."""

from __future__ import annotations

import json
import os

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")  # hide pydantic-ai's startup banner in the server log
import threading
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from openai import AsyncOpenAI
from pydantic_ai import Agent
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.messages import ModelResponse, TextPart, ThinkingPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.openai import OpenAIResponsesModel, OpenAIResponsesModelSettings
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.usage import UsageLimits

import tools
from models import AgentResult, AuditEntry, CourseSearchResult, ToolCallRecord

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
AUDIT_PATH = ROOT / "output" / "audit_trail.json"
SYSTEM_PROMPT = (HERE / "prompts" / "prompt.md").read_text(encoding="utf-8")

# Each run may ask the model at most this many times (one request per think -> tool -> think step).
# Stops a confused agent from looping on tools forever and running up the bill.
MAX_MODEL_REQUESTS = 8

load_dotenv(ROOT / ".env")
load_dotenv(ROOT.parent / ".env")


def build_portkey_model() -> OpenAIResponsesModel:
    """A PydanticAI model that sends every call through Portkey instead of straight to OpenAI."""
    api_key = os.getenv("PORTKEY_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("PORTKEY_API_KEY is missing. Set it in .env or as an environment variable.")
    headers = {"x-portkey-api-key": api_key}
    if os.getenv("PORTKEY_VIRTUAL_KEY", "").strip():
        headers["x-portkey-virtual-key"] = os.environ["PORTKEY_VIRTUAL_KEY"].strip()
    client = AsyncOpenAI(
        api_key=api_key,
        base_url=os.getenv("PORTKEY_BASE_URL", "https://api.portkey.ai/v1").strip(),
        default_headers=headers,
    )
    model_name = os.getenv("PORTKEY_MODEL", "gpt-5.6-luna").strip()
    return OpenAIResponsesModel(model_name, provider=OpenAIProvider(openai_client=client))


course_agent = Agent(
    build_portkey_model(),
    system_prompt=SYSTEM_PROMPT,
    # Ask for a short summary of the model's reasoning so the audit trail can record its "thoughts".
    model_settings=OpenAIResponsesModelSettings(openai_reasoning_effort="low", openai_reasoning_summary="concise"),
)


@course_agent.tool_plain
def search_courses(
    query: str = "",
    category: str | None = None,
    faculty: str | None = None,
    day: str | None = None,
    session: str | None = None,
) -> CourseSearchResult:
    """Search the Yale SOM Fall 2026 course file. Every word in query must appear in the course row
    (title, number, faculty, category, day/time, room, description, faculty bio). Optional filters:
    category (e.g. Core, Finance, elective), faculty (part of a name), day (e.g. Monday), session
    (fall, fall-1, fall-2). Returns match counts and up to 15 matching rows."""
    return tools.search_courses(query, category, faculty, day, session)


@course_agent.tool_plain
def web_search(query: str) -> str:
    """Search the public web. Use only when the course file isn't enough (faculty news, topic background, etc.)."""
    return tools.web_search(query)


def _short(value, limit: int = 300) -> str:
    """A one-line preview of a tool result for the audit trail."""
    if isinstance(value, CourseSearchResult):
        titles = ", ".join(f"{c.number} {c.title}" for c in value.courses[:5])
        return f"{value.total_matches} rows / {value.unique_courses} courses matched; first: {titles}"[:limit]
    text = value if isinstance(value, str) else json.dumps(value, default=str)
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit] + "…"


def _audit_from_messages(messages) -> tuple[list[str], list[ToolCallRecord], list[str]]:
    """Pull thoughts, tool calls (with args + result preview) and tool names out of the run's messages."""
    thoughts: list[str] = []
    calls: dict[str, ToolCallRecord] = {}
    tool_names: list[str] = []
    for message in messages:
        for part in message.parts:
            if isinstance(part, ThinkingPart) and part.content.strip():
                thoughts.append(part.content.strip())
            elif isinstance(part, ToolCallPart):
                calls[part.tool_call_id] = ToolCallRecord(tool=part.tool_name, args=part.args_as_dict(), result_summary="")
                if part.tool_name not in tool_names:
                    tool_names.append(part.tool_name)
            elif isinstance(part, ToolReturnPart) and part.tool_call_id in calls:
                calls[part.tool_call_id].result_summary = _short(part.content)
        # Text the model wrote alongside a tool call is also part of its reasoning, not the final reply.
        if isinstance(message, ModelResponse) and any(isinstance(p, ToolCallPart) for p in message.parts):
            thoughts += [p.content.strip() for p in message.parts if isinstance(p, TextPart) and p.content.strip()]
    return thoughts, list(calls.values()), tool_names


_audit_lock = threading.Lock()  # two chats at once must not overwrite each other's audit rows


def append_audit(entry: AuditEntry, path: Path = AUDIT_PATH) -> None:
    """Add one run to the audit trail, keeping every earlier run."""
    with _audit_lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        rows = json.loads(path.read_text(encoding="utf-8")) if path.is_file() and path.stat().st_size else []
        rows.append(entry.model_dump(mode="json"))
        path.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def run_agent(message: str) -> dict:
    """Answer one chat message. Returns {"reply": str, "tools_used": [tool names]} for main.py."""
    started = datetime.now().isoformat(timespec="seconds")
    messages = []
    try:
        result = course_agent.run_sync(message, usage_limits=UsageLimits(request_limit=MAX_MODEL_REQUESTS))
        messages = result.all_messages()
        reply = result.output
        finish = getattr(result.response, "finish_reason", None) or "stop"
        stop_reason = f"Model gave a final answer with no more tool calls (finish_reason={finish})."
        requests = result.usage.requests
    except UsageLimitExceeded:
        reply = "Sorry, I couldn't finish that one: I hit my limit of steps. Try asking a narrower question."
        stop_reason = f"Stopped by the safety limit of {MAX_MODEL_REQUESTS} model requests."
        requests = MAX_MODEL_REQUESTS
    except Exception as error:  # the chat should show a message, not crash the server
        reply = f"Sorry, something went wrong talking to the model ({type(error).__name__})."
        stop_reason = f"Error: {type(error).__name__}: {str(error)[:300]}"
        requests = 0

    thoughts, tool_calls, tool_names = _audit_from_messages(messages)
    append_audit(AuditEntry(
        time=started,
        user_message=message,
        thoughts=thoughts,
        tool_calls=tool_calls,
        reply=reply,
        stop_reason=stop_reason,
        model_requests=requests,
    ))
    return AgentResult(reply=reply, tools_used=tool_names).model_dump()
