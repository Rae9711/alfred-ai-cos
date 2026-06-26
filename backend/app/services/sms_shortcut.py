"""Build the iOS Shortcut that forwards SMS to Albert's webhook.

Signed .shortcut files are produced by `backend/scripts/build_sms_shortcut.py` on macOS.
"""

from __future__ import annotations

import plistlib
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

SHORTCUT_NAME = "Albert SMS Forward"
SHORTCUT_FILENAME = "Albert-SMS-Forward.shortcut"
SHARE_SHORTCUT_NAME = "Albert SMS Share"
SHARE_SHORTCUT_FILENAME = "Albert-SMS-Share.shortcut"
# Legacy filename — still served so old install links resolve.
LEGACY_BACKFILL_SHORTCUT_FILENAME = "Albert-SMS-Backfill.shortcut"
DEFAULT_WEBHOOK_URL = "https://alfredaitech.com/api/v1/inbox/sms"
# Widely supported on iOS 13+ — coerces Shortcut Input (text or message object) to text.
DETECT_TEXT_ACTION = "is.workflow.actions.detect.text"
HASH_ACTION = "is.workflow.actions.hash"


def _uid() -> str:
    return str(uuid.uuid4()).upper()


def _attachment(output_uuid: str, output_name: str) -> dict[str, Any]:
    return {
        "Value": {
            "OutputUUID": output_uuid,
            "Type": "ActionOutput",
            "OutputName": output_name,
        },
        "WFSerializationType": "WFTextTokenAttachment",
    }


def _shortcut_input_attachment() -> dict[str, Any]:
    return {
        "Value": {
            "Type": "Variable",
            "VariableName": "Shortcut Input",
        },
        "WFSerializationType": "WFTextTokenAttachment",
    }


def _detect_text_from_shortcut_input(*, output_name: str) -> tuple[dict[str, Any], str]:
    action_uuid = _uid()
    return {
        "WFWorkflowActionIdentifier": DETECT_TEXT_ACTION,
        "WFWorkflowActionParameters": {
            "UUID": action_uuid,
            "WFInput": _shortcut_input_attachment(),
            "CustomOutputName": output_name,
        },
    }, action_uuid


def _dict_field(key: str, value_attachment: dict[str, Any]) -> dict[str, Any]:
    return {
        "WFKey": {"Value": {"string": key, "attachmentsByRange": {}}},
        "WFItemType": 0,
        "WFValue": value_attachment,
    }


def _dict_field_text(key: str, text: str) -> dict[str, Any]:
    return {
        "WFKey": {"Value": {"string": key, "attachmentsByRange": {}}},
        "WFItemType": 0,
        "WFValue": {"Value": {"string": text, "attachmentsByRange": {}}, "WFSerializationType": "WFTextTokenString"},
    }


def _hash_action(*, input_attachment: dict[str, Any], output_name: str) -> tuple[dict[str, Any], str]:
    action_uuid = _uid()
    return {
        "WFWorkflowActionIdentifier": HASH_ACTION,
        "WFWorkflowActionParameters": {
            "UUID": action_uuid,
            "WFInput": input_attachment,
            "WFHashType": "SHA-256",
            "CustomOutputName": output_name,
        },
    }, action_uuid


def _post_sms_webhook_action(
    *,
    webhook_url: str,
    dict_uuid: str,
    token_header_value: dict[str, Any],
) -> dict[str, Any]:
    post_uuid = _uid()
    return {
        "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
        "WFWorkflowActionParameters": {
            "UUID": post_uuid,
            "WFURL": webhook_url,
            "WFHTTPMethod": "POST",
            "WFHTTPBodyType": "File",
            "WFRequestVariable": _attachment(dict_uuid, "Dictionary"),
            "WFHTTPHeaders": {
                "Value": {
                    "WFDictionaryFieldValueItems": [
                        {
                            "WFKey": {
                                "Value": {"string": "Content-Type", "attachmentsByRange": {}},
                            },
                            "WFItemType": 0,
                            "WFValue": {
                                "Value": {"string": "application/json", "attachmentsByRange": {}},
                                "WFSerializationType": "WFTextTokenString",
                            },
                        },
                        {
                            "WFKey": {
                                "Value": {"string": "X-Sms-Token", "attachmentsByRange": {}},
                            },
                            "WFItemType": 0,
                            "WFValue": token_header_value,
                        },
                    ]
                },
                "WFSerializationType": "WFDictionaryFieldValue",
            },
        },
    }


def _token_prompt_action() -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    token_uuid = _uid()
    token_action = {
        "WFWorkflowActionIdentifier": "is.workflow.actions.gettext",
        "WFWorkflowActionParameters": {
            "UUID": token_uuid,
            "WFTextActionText": "",
            "CustomOutputName": "Albert Token",
        },
    }
    token_header_value = _attachment(token_uuid, "Albert Token")
    import_questions = [
        {
            "ActionIndex": 0,
            "Category": "Parameter",
            "DefaultValue": "",
            "ParameterKey": "WFTextActionText",
            "Text": "Paste your X-Sms-Token from Albert → You → SMS forwarding:",
        }
    ]
    return token_action, token_header_value, import_questions


def build_sms_forward_shortcut(
    *,
    webhook_url: str = DEFAULT_WEBHOOK_URL,
    sms_token: str | None = None,
) -> bytes:
    """Return binary plist bytes for the SMS forward shortcut.

    When ``sms_token`` is set (personalized download), it is embedded in the header.
    Otherwise the shortcut prompts for the token on import via WFWorkflowImportQuestions.

    Message Received passes the incoming message as Shortcut Input. We read body via
    detect.text only — sender phone/name actions often show as *Unknown Action* on
    recent iOS builds when embedded in signed plists. Users can add **Get Details of
    Messages** manually in Shortcuts if their device supports it.
    """
    dict_uuid = _uid()
    get_body, body_uuid = _detect_text_from_shortcut_input(output_name="Message Text")

    payload_dict = {
        "WFWorkflowActionIdentifier": "is.workflow.actions.dictionary",
        "WFWorkflowActionParameters": {
            "UUID": dict_uuid,
            "WFItems": {
                "Value": {
                    "WFDictionaryFieldValueItems": [
                        _dict_field("body", _attachment(body_uuid, "Message Text")),
                    ]
                },
                "WFSerializationType": "WFDictionaryFieldValue",
            },
        },
    }

    token_header_value: dict[str, Any]
    if sms_token:
        token_header_value = {
            "Value": {"string": sms_token, "attachmentsByRange": {}},
            "WFSerializationType": "WFTextTokenString",
        }
        import_questions: list[dict[str, Any]] = []
        actions: list[dict[str, Any]] = [get_body, payload_dict]
    else:
        token_action, token_header_value, import_questions = _token_prompt_action()
        actions = [token_action, get_body, payload_dict]

    actions.append(
        _post_sms_webhook_action(
            webhook_url=webhook_url,
            dict_uuid=dict_uuid,
            token_header_value=token_header_value,
        )
    )

    shortcut: dict[str, Any] = {
        "WFWorkflowClientVersion": "2302.0.4",
        "WFWorkflowClientRelease": "2302.0.4",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowName": SHORTCUT_NAME,
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": 4282601983,
            "WFWorkflowIconGlyphNumber": 59511,
        },
        "WFWorkflowInputContentItemClasses": [
            "WFStringContentItem",
            "WFMessageContentItem",
        ],
        "WFWorkflowTypes": ["NCWidget", "Watch"],
        "WFWorkflowImportQuestions": import_questions,
        "WFWorkflowActions": actions,
    }

    return plistlib.dumps(shortcut, fmt=plistlib.FMT_BINARY)


def signed_shortcut_path() -> Path:
    return Path(__file__).resolve().parents[2] / "integrations" / "ios" / SHORTCUT_FILENAME


def shortcut_download_url(*, app_base_url: str) -> str:
    base = app_base_url.rstrip("/")
    return f"{base}/api/v1/integrations/ios/{SHORTCUT_FILENAME}"


def build_sms_install_urls(*, app_base_url: str) -> tuple[str, str]:
    """Return (import_url, shortcut_url) for iOS Shortcut install.

    ``import_url`` uses Apple's ``shortcuts://import-shortcut`` scheme (Safari or
    Shortcuts). ``shortcut_url`` is the signed HTTPS download — preferred from in-app
    ``Linking.openURL`` because RN/iOS often mangle nested query encoding on the
    shortcuts:// form.
    """
    shortcut_url = shortcut_download_url(app_base_url=app_base_url)
    query = urlencode({"url": shortcut_url, "name": SHORTCUT_NAME})
    import_url = f"shortcuts://import-shortcut/?{query}"
    return import_url, shortcut_url


def signed_share_shortcut_path() -> Path:
    return Path(__file__).resolve().parents[2] / "integrations" / "ios" / SHARE_SHORTCUT_FILENAME


def share_shortcut_download_url(*, app_base_url: str) -> str:
    base = app_base_url.rstrip("/")
    return f"{base}/api/v1/integrations/ios/{SHARE_SHORTCUT_FILENAME}"


def build_sms_share_install_urls(*, app_base_url: str) -> tuple[str, str]:
    """Return (import_url, shortcut_url) for the Share-sheet SMS import shortcut."""
    shortcut_url = share_shortcut_download_url(app_base_url=app_base_url)
    query = urlencode({"url": shortcut_url, "name": SHARE_SHORTCUT_NAME})
    import_url = f"shortcuts://import-shortcut/?{query}"
    return import_url, shortcut_url


# Backward-compatible aliases for API routes and mobile client.
signed_backfill_shortcut_path = signed_share_shortcut_path
backfill_shortcut_download_url = share_shortcut_download_url
build_sms_backfill_install_urls = build_sms_share_install_urls


def build_sms_share_shortcut(
    *,
    webhook_url: str = DEFAULT_WEBHOOK_URL,
    sms_token: str | None = None,
) -> bytes:
    """Return binary plist bytes for the Share-sheet SMS import shortcut.

    Run from the iOS Share sheet on a message: POSTs one text at a time to Albert.
    Re-running on the same body is safe — ``message_id`` is a stable hash for dedup.
    """
    dict_uuid = _uid()
    get_body, body_uuid = _detect_text_from_shortcut_input(output_name="Message Text")
    get_hash, hash_uuid = _hash_action(
        input_attachment=_attachment(body_uuid, "Message Text"),
        output_name="Message ID",
    )

    payload_dict = {
        "WFWorkflowActionIdentifier": "is.workflow.actions.dictionary",
        "WFWorkflowActionParameters": {
            "UUID": dict_uuid,
            "WFItems": {
                "Value": {
                    "WFDictionaryFieldValueItems": [
                        _dict_field("body", _attachment(body_uuid, "Message Text")),
                        _dict_field("message_id", _attachment(hash_uuid, "Message ID")),
                        _dict_field_text("backfill", "true"),
                    ]
                },
                "WFSerializationType": "WFDictionaryFieldValue",
            },
        },
    }

    token_header_value: dict[str, Any]
    if sms_token:
        token_header_value = {
            "Value": {"string": sms_token, "attachmentsByRange": {}},
            "WFSerializationType": "WFTextTokenString",
        }
        import_questions: list[dict[str, Any]] = []
        actions: list[dict[str, Any]] = [get_body, get_hash, payload_dict]
    else:
        token_action, token_header_value, import_questions = _token_prompt_action()
        actions = [token_action, get_body, get_hash, payload_dict]

    actions.append(
        _post_sms_webhook_action(
            webhook_url=webhook_url,
            dict_uuid=dict_uuid,
            token_header_value=token_header_value,
        )
    )

    shortcut: dict[str, Any] = {
        "WFWorkflowClientVersion": "2302.0.4",
        "WFWorkflowClientRelease": "2302.0.4",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowName": SHARE_SHORTCUT_NAME,
        "WFWorkflowIcon": {
            "WFWorkflowIconStartColor": 4282601983,
            "WFWorkflowIconGlyphNumber": 59511,
        },
        "WFWorkflowInputContentItemClasses": [
            "WFStringContentItem",
            "WFMessageContentItem",
            "WFAttributedStringContentItem",
        ],
        "WFWorkflowTypes": ["ActionExtension"],
        "WFWorkflowImportQuestions": import_questions,
        "WFWorkflowActions": actions,
    }

    return plistlib.dumps(shortcut, fmt=plistlib.FMT_BINARY)


build_sms_backfill_shortcut = build_sms_share_shortcut
