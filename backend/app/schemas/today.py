"""Response shapes for the Today dashboard. Mirrors packages/shared-types Today types."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel

from app.db.enums import Priority

PlanningItemType = Literal["commitment", "task"]


class TodayPriority(BaseModel):
    id: str
    title: str
    priority: Priority
    reason: str
    due_date: date | None
    counterparty: str | None
    confidence: float


class WaitingItem(BaseModel):
    id: str
    description: str
    person: str | None


class MeetingToPrepare(BaseModel):
    id: str
    title: str | None
    start_time: str | None


class TimeBlockSuggestion(BaseModel):
    gap_start: str
    gap_end: str
    duration_minutes: int
    item_id: str
    item_type: PlanningItemType
    title: str
    estimated_minutes: int
    reason: str


class QuickWin(BaseModel):
    id: str
    title: str
    item_type: PlanningItemType
    estimated_minutes: int


class ScheduleConflictOut(BaseModel):
    event_id: str
    title: str


class ScheduleProposalOut(BaseModel):
    id: str
    source_message_id: str
    title: str
    start_time: str
    end_time: str
    timezone: str
    location: str | None
    participants: list[str]
    confidence: float
    counterparty: str | None = None
    conflicts: list[ScheduleConflictOut] = []


class HabitSuggestionOut(BaseModel):
    habit_id: str
    activity: str
    pattern_summary: str
    prompt: str
    suggested_start: str
    suggested_end: str
    typical_days: list[int]
    confidence: float


class WeekAheadOut(BaseModel):
    summary: str
    meeting_count: int
    busiest_day: str | None
    pending_invites: int
    fuzzy_commitments: int
    show_prominently: bool = False


class TodayDashboard(BaseModel):
    summary: str
    day_overview: str | None = None
    top_priorities: list[TodayPriority]
    people_waiting_on_you: list[WaitingItem]
    you_are_waiting_on: list[WaitingItem]
    meetings_to_prepare: list[MeetingToPrepare]
    suggestions: list[TimeBlockSuggestion] = []
    quick_wins: list[QuickWin] = []
    schedule_proposals: list[ScheduleProposalOut] = []
    habit_suggestions: list[HabitSuggestionOut] = []
    week_ahead: WeekAheadOut | None = None
