"""Build the iOS Shortcut that forwards SMS to Albert's webhook.

Signed .shortcut files are produced by `backend/scripts/build_sms_shortcut.py` on macOS.
"""

from __future__ import annotations

import plistlib
import uuid
from pathlib import Path
from typing import Any

SHORTCUT_NAME = "Albert SMS Forward"
SHORTCUT_FILENAME = "Albert-SMS-Forward.shortcut"
DEFAULT_WEBHOOK_URL = "https://alfredaitech.com/api/v1/inbox/sms"


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
        "Type": "Variable",
        "VariableName": "Shortcut Input",
    }


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


def build_sms_forward_shortcut(
    *,
    webhook_url: str = DEFAULT_WEBHOOK_URL,
    sms_token: str | None = None,
) -> bytes:
    """Return binary plist bytes for the SMS forward shortcut.

    When ``sms_token`` is set (personalized download), it is embedded in the header.
    Otherwise the shortcut prompts for the token on import via WFWorkflowImportQuestions.
    """
    phone_uuid = _uid()
    body_uuid = _uid()
    dict_uuid = _uid()
    post_uuid = _uid()
    token_uuid = _uid()

    # Message Received passes the incoming message as Shortcut Input — read phone/body
    # directly from it. Find Messages + body-equals-input fails when input is a message
    # object (empty matches → null body → API 422).
    get_phone = {
        "WFWorkflowActionIdentifier": "is.workflow.actions.properties.contentitems",
        "WFWorkflowActionParameters": {
            "UUID": phone_uuid,
            "WFContentItemPropertyName": "Phone Number",
            "WFInput": _shortcut_input_attachment(),
            "CustomOutputName": "Sender Phone",
        },
    }

    get_body = {
        "WFWorkflowActionIdentifier": "is.workflow.actions.properties.contentitems",
        "WFWorkflowActionParameters": {
            "UUID": body_uuid,
            "WFContentItemPropertyName": "Body",
            "WFInput": _shortcut_input_attachment(),
            "CustomOutputName": "Message Body",
        },
    }

    payload_dict = {
        "WFWorkflowActionIdentifier": "is.workflow.actions.dictionary",
        "WFWorkflowActionParameters": {
            "UUID": dict_uuid,
            "WFItems": {
                "Value": {
                    "WFDictionaryFieldValueItems": [
                        _dict_field("from_number", _attachment(phone_uuid, "Sender Phone")),
                        _dict_field("body", _attachment(body_uuid, "Message Body")),
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
        actions: list[dict[str, Any]] = [
            get_phone,
            get_body,
            payload_dict,
        ]
    else:
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
        actions = [
            token_action,
            get_phone,
            get_body,
            payload_dict,
        ]

    post_action = {
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
    actions.append(post_action)

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
