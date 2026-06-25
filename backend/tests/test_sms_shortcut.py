"""SMS forward shortcut plist builder."""

from __future__ import annotations

import plistlib

from app.services.sms_shortcut import (
    DEFAULT_WEBHOOK_URL,
    DETECT_CONTACTS_ACTION,
    DETECT_TEXT_ACTION,
    PROPERTIES_CONTACTS_ACTION,
    PROPERTIES_MESSAGES_ACTION,
    SHORTCUT_NAME,
    build_sms_forward_shortcut,
    build_sms_install_urls,
    shortcut_download_url,
)


def test_build_sms_forward_shortcut_extracts_sender_phone_from_message() -> None:
    data = plistlib.loads(build_sms_forward_shortcut(sms_token="tok"))
    detect_actions = [
        a
        for a in data["WFWorkflowActions"]
        if a["WFWorkflowActionIdentifier"] == DETECT_TEXT_ACTION
    ]
    assert len(detect_actions) == 1
    wf_input = detect_actions[0]["WFWorkflowActionParameters"]["WFInput"]
    assert wf_input["WFSerializationType"] == "WFTextTokenAttachment"
    assert wf_input["Value"]["VariableName"] == "Shortcut Input"
    assert detect_actions[0]["WFWorkflowActionParameters"]["CustomOutputName"] == "Message Text"

    phone_action = next(
        a
        for a in data["WFWorkflowActions"]
        if a["WFWorkflowActionIdentifier"] == PROPERTIES_MESSAGES_ACTION
    )
    assert phone_action["WFWorkflowActionParameters"]["WFContentItemPropertyName"] == "Phone Number"
    assert phone_action["WFWorkflowActionParameters"]["CustomOutputName"] == "Sender Phone"

    dict_action = next(
        a for a in data["WFWorkflowActions"] if a["WFWorkflowActionIdentifier"] == "is.workflow.actions.dictionary"
    )
    items = dict_action["WFWorkflowActionParameters"]["WFItems"]["Value"]["WFDictionaryFieldValueItems"]
    keys = {item["WFKey"]["Value"]["string"] for item in items}
    assert keys == {"body", "from_number", "from_name"}
    from_number = next(item for item in items if item["WFKey"]["Value"]["string"] == "from_number")
    assert from_number["WFValue"]["Value"]["OutputName"] == "Sender Phone"


def test_build_sms_forward_shortcut_includes_contact_name_extraction() -> None:
    data = plistlib.loads(build_sms_forward_shortcut(sms_token="tok"))
    assert any(
        a["WFWorkflowActionIdentifier"] == DETECT_CONTACTS_ACTION for a in data["WFWorkflowActions"]
    )
    name_action = next(
        a
        for a in data["WFWorkflowActions"]
        if a["WFWorkflowActionIdentifier"] == PROPERTIES_CONTACTS_ACTION
    )
    assert name_action["WFWorkflowActionParameters"]["WFContentItemPropertyName"] == "Name"
    assert name_action["WFWorkflowActionParameters"]["CustomOutputName"] == "Sender Name"


def test_build_sms_forward_shortcut_does_not_use_broken_contentitems_action() -> None:
    data = plistlib.loads(build_sms_forward_shortcut(sms_token="tok"))
    forbidden = {
        "is.workflow.actions.properties.contentitems",
        "is.workflow.actions.contentitemproperties",
    }
    for action in data["WFWorkflowActions"]:
        assert action["WFWorkflowActionIdentifier"] not in forbidden


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
    assert data["WFWorkflowActions"][0]["WFWorkflowActionIdentifier"] == DETECT_TEXT_ACTION
    post = data["WFWorkflowActions"][-1]
    headers = post["WFWorkflowActionParameters"]["WFHTTPHeaders"]["Value"][
        "WFDictionaryFieldValueItems"
    ]
    token_header = next(h for h in headers if h["WFKey"]["Value"]["string"] == "X-Sms-Token")
    assert token_header["WFValue"]["Value"]["string"] == "tok"
    assert post["WFWorkflowActionParameters"]["WFURL"] == "https://example.test/sms"


def test_shortcut_download_url() -> None:
    assert (
        shortcut_download_url(app_base_url="https://alfredaitech.com")
        == "https://alfredaitech.com/api/v1/integrations/ios/Albert-SMS-Forward.shortcut"
    )


def test_build_sms_install_urls() -> None:
    import_url, shortcut_url = build_sms_install_urls(app_base_url="https://alfredaitech.com")
    assert shortcut_url.endswith("/Albert-SMS-Forward.shortcut")
    assert import_url.startswith("shortcuts://import-shortcut/?")
    assert "url=https%3A%2F%2Falfredaitech.com%2Fapi%2Fv1%2Fintegrations%2Fios%2FAlbert-SMS-Forward.shortcut" in import_url
    assert "name=Albert" in import_url and "Forward" in import_url
