"""Data objects shared by the tools and the agent."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class Course(BaseModel):
    """One row of data/yale_som_classes.json, with friendlier field names.

    The JSON uses keys like "Course Title"; the aliases map those onto
    snake_case names, so Course.model_validate(row) works on a raw row.
    """

    model_config = ConfigDict(populate_by_name=True)

    course_id: str = Field(alias="Course ID")
    number: str = Field(alias="Course Number")
    section: str = Field(alias="Section")
    title: str = Field(alias="Course Title")
    category: str = Field(alias="Course Category")
    course_type: str = Field(alias="Course Type")
    session: str = Field(alias="Course Session")
    units: str = Field(alias="Units")
    daytimes: str = Field(alias="Daytimes", description="e.g. 'M  W 10:05 AM-11:25 AM'; empty if not scheduled")
    room: str = Field(alias="Room")
    faculty: str = Field(alias="Faculty 1", description="'Last, First'")
    faculty_email: str = Field(alias="Faculty 1 Email")
    bid_or_permission: str = Field(alias="Bid Or Permission")
    description: str = Field(alias="Course Description")
    faculty_bio: str = Field(default="", alias="faculty_bio")
    syllabus: str = Field(default="", alias="Syllabus")


class CourseSearchResult(BaseModel):
    """What search_courses hands back to the agent."""

    total_matches: int = Field(description="How many rows (course sections) matched in total, even if not all are returned")
    unique_courses: int = Field(description="How many distinct course numbers matched (one course can have several sections)")
    returned: int
    courses: list[Course]


class ToolCallRecord(BaseModel):
    """One tool call, as written to the audit trail."""

    tool: str
    args: dict
    result_summary: str


class AgentResult(BaseModel):
    """What run_agent returns to main.py."""

    reply: str
    tools_used: list[str] = Field(default_factory=list)


class AuditEntry(BaseModel):
    """One agent run in output/audit_trail.json."""

    time: str
    user_message: str
    thoughts: list[str] = Field(default_factory=list)
    tool_calls: list[ToolCallRecord] = Field(default_factory=list)
    reply: str
    stop_reason: str
    model_requests: int = 0
