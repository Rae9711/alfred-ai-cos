"""SMS forward and share shortcut plist builders."""

from __future__ import annotations

import plistlib

from app.services.sms_shortcut import (
    DEFAULT_WEBHOOK_URL,
    DETECT_TEXT_ACTION,
    HASH_ACTION,
    LEGACY_BACKFILL_SHORTCUT_FILENAME,
    SHARE_SHORTCUT_FILENAME,
    SHARE_SHORTCUT_NAME,
    SHORTCUT_NAME,
    build_sms_backfill_install_urls,
    build_sms_forward_shortcut,
    build_sms_install_urls,
    build_sms_share_shortcut,
    share_shortcut_download_url,
    shortcut_download_url,
)


def _action_ids(data: dict) -> list[str]:
    return [a["WFWorkflowActionIdentifier"] for a in data["WFWorkflowActions"]]


def test_build_sms_forward_shortcut_maps_shortcut_input_to_json_body() -> None:
    data = plistlib.loads(build_sms_forward_shortcut(sms_token="tok"))
    assert _action_ids(data) == [
        "is.workflow.actions.dictionary",
        "is.workflow.actions.downloadurl",
    ]

    dict_action = data["WFWorkflowActions"][0]
    items = dict_action["WFWorkflowActionParameters"]["WFItems"]["Value"]["WFDictionaryFieldValueItems"]
    assert len(items) == 3
    keys = {item["WFKey"]["Value"]["string"] for item in items}
    assert keys == {"body", "shortcut_input", "text"}
    by_key = {item["WFKey"]["Value"]["string"]: item for item in items}
    for key in ("body", "text", "shortcut_input"):
        val = by_key[key]["WFValue"]["Value"]
        assert val["Type"] == "Variable"
        assert val["VariableName"] == "Shortcut Input"
        assert "OutputUUID" not in val

    post = data["WFWorkflowActions"][-1]
    assert post["WFWorkflowActionParameters"]["WFHTTPBodyType"] == "Json"
    json_items = post["WFWorkflowActionParameters"]["WFJSONValues"]["Value"][
        "WFDictionaryFieldValueItems"
    ]
    assert len(json_items) == 3


def test_build_sms_forward_shortcut_does_not_use_unsupported_message_actions() -> None:
    data = plistlib.loads(build_sms_forward_shortcut(sms_token="tok"))
    forbidden = {
        "is.workflow.actions.properties.messages",
        "is.workflow.actions.properties.contentitems",
        "is.workflow.actions.contentitemproperties",
        "is.workflow.actions.detect.contacts",
        "is.workflow.actions.properties.contacts",
        "is.workflow.actions.filter.messages",
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
    assert data["WFWorkflowActions"][0]["WFWorkflowActionIdentifier"] == (
        "is.workflow.actions.dictionary"
    )
    dict_items = data["WFWorkflowActions"][0]["WFWorkflowActionParameters"]["WFItems"]["Value"][
        "WFDictionaryFieldValueItems"
    ]
    assert len(dict_items) == 3
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


def test_build_sms_share_shortcut_posts_shared_message() -> None:
    data = plistlib.loads(build_sms_share_shortcut(sms_token="tok"))
    assert data["WFWorkflowName"] == SHARE_SHORTCUT_NAME
    assert data["WFWorkflowTypes"] == ["ActionExtension"]
    assert _action_ids(data) == [
        DETECT_TEXT_ACTION,
        HASH_ACTION,
        "is.workflow.actions.dictionary",
        "is.workflow.actions.downloadurl",
    ]

    dict_action = next(
        a for a in data["WFWorkflowActions"] if a["WFWorkflowActionIdentifier"] == "is.workflow.actions.dictionary"
    )
    items = dict_action["WFWorkflowActionParameters"]["WFItems"]["Value"]["WFDictionaryFieldValueItems"]
    keys = {item["WFKey"]["Value"]["string"] for item in items}
    assert keys == {"body", "text", "shortcut_input", "message_id", "backfill"}

    post = data["WFWorkflowActions"][-1]
    assert post["WFWorkflowActionParameters"]["WFHTTPBodyType"] == "Json"


def test_build_sms_share_shortcut_does_not_use_unsupported_message_actions() -> None:
    data = plistlib.loads(build_sms_share_shortcut(sms_token="tok"))
    forbidden = {
        "is.workflow.actions.properties.messages",
        "is.workflow.actions.filter.messages",
        "is.workflow.actions.detect.contacts",
        "is.workflow.actions.properties.contacts",
        "is.workflow.actions.repeat.each",
    }
    for action in data["WFWorkflowActions"]:
        assert action["WFWorkflowActionIdentifier"] not in forbidden


def test_share_shortcut_download_url() -> None:
    assert (
        share_shortcut_download_url(app_base_url="https://alfredaitech.com")
        == f"https://alfredaitech.com/api/v1/integrations/ios/{SHARE_SHORTCUT_FILENAME}"
    )


def test_build_sms_backfill_install_urls_serves_share_shortcut() -> None:
    import_url, shortcut_url = build_sms_backfill_install_urls(app_base_url="https://alfredaitech.com")
    assert shortcut_url.endswith(f"/{SHARE_SHORTCUT_FILENAME}")
    assert import_url.startswith("shortcuts://import-shortcut/?")
    assert "Share" in import_url or "Share" in shortcut_url
    assert LEGACY_BACKFILL_SHORTCUT_FILENAME != SHARE_SHORTCUT_FILENAME
