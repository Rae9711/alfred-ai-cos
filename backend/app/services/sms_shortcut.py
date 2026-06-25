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
DEFAULT_WEBHOOK_URL = "https://alfredaitech.com/api/v1/inbox/sms"
# Must match sms_inbox.UNKNOWN_SMS_SENDER — placeholder when sender phone is unavailable.
SHORTCUT_UNKNOWN_SENDER = "+10000000000"
# Widely supported on iOS 13+ — coerces Shortcut Input (text or message object) to text.
DETECT_TEXT_ACTION = "is.workflow.actions.detect.text"
# Correct action for Message Received input (not properties.contentitems).
PROPERTIES_MESSAGES_ACTION = "is.workflow.actions.properties.messages"
DETECT_CONTACTS_ACTION = "is.workflow.actions.detect.contacts"
PROPERTIES_CONTACTS_ACTION = "is.workflow.actions.properties.contacts"


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


def _shortcut_input_variable() -> dict[str, Any]:
    """Unwrapped variable ref — required by Get Details of Messages on some iOS builds."""
    return {
        "Type": "Variable",
        "VariableName": "Shortcut Input",
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


def _message_property_action(
    *,
    property_name: str,
    output_name: str,
) -> tuple[dict[str, Any], str]:
    action_uuid = _uid()
    return {
        "WFWorkflowActionIdentifier": PROPERTIES_MESSAGES_ACTION,
        "WFWorkflowActionParameters": {
            "UUID": action_uuid,
            "WFContentItemPropertyName": property_name,
            "WFInput": _shortcut_input_variable(),
            "CustomOutputName": output_name,
        },
    }, action_uuid


def _detect_contacts_from_shortcut_input() -> tuple[dict[str, Any], str]:
    action_uuid = _uid()
    return {
        "WFWorkflowActionIdentifier": DETECT_CONTACTS_ACTION,
        "WFWorkflowActionParameters": {
            "UUID": action_uuid,
            "WFInput": _shortcut_input_variable(),
            "CustomOutputName": "Contacts",
        },
    }, action_uuid


def _contact_property_action(
    *,
    property_name: str,
    contact_uuid: str,
    output_name: str,
) -> tuple[dict[str, Any], str]:
    action_uuid = _uid()
    return {
        "WFWorkflowActionIdentifier": PROPERTIES_CONTACTS_ACTION,
        "WFWorkflowActionParameters": {
            "UUID": action_uuid,
            "WFContentItemPropertyName": property_name,
            "WFInput": _attachment(contact_uuid, "Contacts"),
            "CustomOutputName": output_name,
        },
    }, action_uuid


def _dict_field(key: str, value_attachment: dict[str, Any]) -> dict[str, Any]:
    return {
        "WFKey": {"Value": {"string": key, "attachmentsByRange": {}}},
        "WFItemType": 0,
        "WFValue": value_attachment,
    }


def build_sms_forward_shortcut(
    *,
    webhook_url: str = DEFAULT_WEBHOOK_URL,
    sms_token: str | None = None,
) -> bytes:
    """Return binary plist bytes for the SMS forward shortcut.

    When ``sms_token`` is set (personalized download), it is embedded in the header.
    Otherwise the shortcut prompts for the token on import via WFWorkflowImportQuestions.

    Message Received passes the incoming message as Shortcut Input. We read:
    - body via detect.text
    - sender phone via Get Details of Messages → Phone Number
      (``is.workflow.actions.properties.messages``, not ``properties.contentitems``)
    - sender name via Get Contacts from Input → Get Name
    """
    dict_uuid = _uid()
    post_uuid = _uid()
    token_uuid = _uid()

    get_body, body_uuid = _detect_text_from_shortcut_input(output_name="Message Text")
    get_phone, phone_uuid = _message_property_action(
        property_name="Phone Number",
        output_name="Sender Phone",
    )
    get_contacts, contacts_uuid = _detect_contacts_from_shortcut_input()
    get_name, _name_uuid = _contact_property_action(
        property_name="Name",
        contact_uuid=contacts_uuid,
        output_name="Sender Name",
    )

    payload_dict = {
        "WFWorkflowActionIdentifier": "is.workflow.actions.dictionary",
        "WFWorkflowActionParameters": {
            "UUID": dict_uuid,
            "WFItems": {
                "Value": {
                    "WFDictionaryFieldValueItems": [
                        _dict_field("body", _attachment(body_uuid, "Message Text")),
                        _dict_field("from_number", _attachment(phone_uuid, "Sender Phone")),
                        _dict_field("from_name", _attachment(_name_uuid, "Sender Name")),
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
            get_body,
            get_phone,
            get_contacts,
            get_name,
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
            get_body,
            get_phone,
            get_contacts,
            get_name,
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
