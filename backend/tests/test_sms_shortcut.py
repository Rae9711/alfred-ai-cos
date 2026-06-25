"""SMS forward shortcut plist builder."""

from __future__ import annotations

import plistlib

from app.services.sms_shortcut import (
    DEFAULT_WEBHOOK_URL,
    SHORTCUT_NAME,
    build_sms_forward_shortcut,
)


def test_build_sms_forward_shortcut_default_prompts_for_token() -> None:
    data = plistlib.loads(build_sms_forward_shortcut())
    assert data["WFWorkflowName"] == SHORTCUT_NAME
    assert data["WFWorkflowImportQuestions"]
    assert data["WFWorkflowActions"][0]["WFWorkflowActionIdentifier"] == (
        "is.workflow.actions.gettext"
    )
    post = data["WFWorkflowActions"][-1]
    assert post["WFWorkflowActionIdentifier"] == "is.workflow.actions.downloadurl"
    assert post["WFWorkflowActionParameters"]["WFURL"] == DEFAULT_WEBHOOK_URL
    assert post["WFWorkflowActionParameters"]["WFHTTPMethod"] == "POST"


def test_build_sms_forward_shortcut_embeds_token_when_given() -> None:
    data = plistlib.loads(
        build_sms_forward_shortcut(webhook_url="https://example.test/sms", sms_token="tok")
    )
    assert data["WFWorkflowImportQuestions"] == []
    assert data["WFWorkflowActions"][0]["WFWorkflowActionIdentifier"] != (
        "is.workflow.actions.gettext"
    )
    post = data["WFWorkflowActions"][-1]
    headers = post["WFWorkflowActionParameters"]["WFHTTPHeaders"]["Value"][
        "WFDictionaryFieldValueItems"
    ]
    token_header = next(h for h in headers if h["WFKey"]["Value"]["string"] == "X-Sms-Token")
    assert token_header["WFValue"]["Value"]["string"] == "tok"
    assert post["WFWorkflowActionParameters"]["WFURL"] == "https://example.test/sms"
