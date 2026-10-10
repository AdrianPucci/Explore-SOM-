"""The agent's two tools: search_courses (the course JSON) and web_search (the public web)."""

from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path

from openai import OpenAI

from models import Course, CourseSearchResult

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data" / "yale_som_classes.json"

MAX_RESULTS = 15  # cap on courses sent back to the model per search
DESCRIPTION_CHARS = 500  # long descriptions/bios are trimmed so the model isn't flooded
BIO_CHARS = 400

STOPWORDS = {"a", "an", "the", "and", "or", "of", "in", "on", "for", "to", "with", "course", "courses", "class", "classes"}
DAY_ALIASES = {
    "m": "M", "mon": "M", "monday": "M",
    "t": "T", "tu": "T", "tue": "T", "tues": "T", "tuesday": "T",
    "w": "W", "wed": "W", "wednesday": "W",
    "th": "Th", "thu": "Th", "thur": "Th", "thurs": "Th", "thursday": "Th",
    "f": "F", "fri": "F", "friday": "F",
}


@lru_cache(maxsize=1)
def load_courses() -> tuple[Course, ...]:
    """Read every course row once and keep it in memory."""
    rows = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    return tuple(Course.model_validate(row) for row in rows)


def meeting_days(course: Course) -> set[str]:
    """'M  W 10:05 AM-11:25 AM' -> {'M', 'W'}."""
    days = set()
    for token in course.daytimes.split():
        if any(ch.isdigit() for ch in token):
            break  # reached the time part
        days.add(token)
    return days


def _matches_term(term: str, text: str) -> bool:
    # Short terms like "AI" must be whole words (so "ai" doesn't match "maintain");
    # longer terms can match the start of a word ("financ" -> "finance", "financial").
    pattern = rf"\b{re.escape(term)}\b" if len(term) <= 3 else rf"\b{re.escape(term)}"
    return re.search(pattern, text) is not None


def _trim(text: str, limit: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def search_courses(
    query: str = "",
    category: str | None = None,
    faculty: str | None = None,
    day: str | None = None,
    session: str | None = None,
) -> CourseSearchResult:
    """Return course rows where every query word appears somewhere in the row, plus optional filters."""
    terms = [t for t in re.findall(r"[\w&'-]+", query.lower()) if t not in STOPWORDS]
    wanted_day = DAY_ALIASES.get(day.lower().strip(), day.strip()) if day else None

    matches = []
    for course in load_courses():
        if category and category.lower() not in f"{course.category} {course.course_type}".lower():
            continue
        if faculty and faculty.lower() not in course.faculty.lower():
            continue
        if wanted_day and wanted_day not in meeting_days(course):
            continue
        if session and session.lower() != course.session.lower():
            continue
        haystack = " ".join([
            course.number, course.number.replace(" ", ""), course.title, course.category, course.course_type,
            course.faculty, course.daytimes, course.room, course.session, course.description, course.faculty_bio,
        ]).lower()
        if all(_matches_term(term, haystack) for term in terms):
            matches.append(course)

    # Title hits first, so "marketing" shows marketing courses before ones that only mention it.
    matches.sort(key=lambda c: -sum(_matches_term(t, c.title.lower()) for t in terms))
    shown = [
        c.model_copy(update={
            "description": _trim(c.description, DESCRIPTION_CHARS),
            "faculty_bio": _trim(c.faculty_bio, BIO_CHARS),
        })
        for c in matches[:MAX_RESULTS]
    ]
    return CourseSearchResult(
        total_matches=len(matches),
        unique_courses=len({c.number for c in matches}),
        returned=len(shown),
        courses=shown,
    )


def _portkey_client() -> OpenAI:
    api_key = os.getenv("PORTKEY_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("PORTKEY_API_KEY is missing. Set it in .env or as an environment variable.")
    headers = {"x-portkey-api-key": api_key}
    if os.getenv("PORTKEY_VIRTUAL_KEY", "").strip():
        headers["x-portkey-virtual-key"] = os.environ["PORTKEY_VIRTUAL_KEY"].strip()
    return OpenAI(
        api_key=api_key,
        base_url=os.getenv("PORTKEY_BASE_URL", "https://api.portkey.ai/v1").strip(),
        default_headers=headers,
    )


def web_search(query: str) -> str:
    """Ask the model's built-in web search tool (through Portkey) and return its answer with source links."""
    response = _portkey_client().responses.create(
        model=os.getenv("PORTKEY_MODEL", "gpt-5.6-luna").strip(),
        tools=[{"type": "web_search", "search_context_size": "low"}],
        input=f"Search the web and answer briefly with source links: {query}",
        max_tool_calls=2,
        max_output_tokens=1500,
    )
    return response.output_text.strip() or "Web search returned no text."
