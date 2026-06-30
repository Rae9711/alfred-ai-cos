"""Build LLM prompts for revising email drafts with cumulative user feedback."""

from __future__ import annotations


def format_revision_notes(
    revision_history: list[str] | None, latest_instruction: str | None
) -> str | None:
    """Merge prior notes and the latest instruction into one numbered list."""
    notes = [n.strip() for n in (revision_history or []) if n and n.strip()]
    latest = (latest_instruction or "").strip()
    if latest and (not notes or notes[-1] != latest):
        notes.append(latest)
    if not notes:
        return None
    lines = [f"{i}. {note}" for i, note in enumerate(notes, start=1)]
    return "\n".join(lines)


def build_draft_user_content(
    *,
    thread_context: str,
    tone: str,
    user_name: str | None,
    instruction: str | None = None,
    current_draft: str | None = None,
    revision_history: list[str] | None = None,
    writing_style_prompt: str | None = None,
) -> str:
    """User message for draft_reply — initial draft or multi-turn revision."""
    name_line = (
        f"\nSign off as: {user_name}"
        if user_name
        else "\nThe user's name is unknown; omit the signature line."
    )
    style_line = f"\n\n{writing_style_prompt}" if writing_style_prompt else ""
    revision_notes = format_revision_notes(revision_history, instruction)
    draft_body = (current_draft or "").strip()

    if draft_body and revision_notes:
        return (
            f"Tone: {tone}{name_line}{style_line}\n\n"
            "Revise the CURRENT DRAFT below to answer the original email.\n"
            "The user gave these notes across multiple rounds — apply ALL of them. "
            "Earlier notes still apply unless a later note explicitly overrides.\n\n"
            f"User notes:\n{revision_notes}\n\n"
            f"Current draft:\n{draft_body}\n\n"
            f"Original email:\n{thread_context}"
        )

    instruction_line = f"\nUser instruction: {instruction}" if instruction else ""
    return f"Tone: {tone}{name_line}{style_line}{instruction_line}\n\nThread:\n{thread_context}"
