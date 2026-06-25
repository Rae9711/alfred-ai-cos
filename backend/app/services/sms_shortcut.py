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
BACKFILL_SHORTCUT_NAME = "Albert SMS Backfill"
BACKFILL_SHORTCUT_FILENAME = "Albert-SMS-Backfill.shortcut"
BACKFILL_MESSAGE_LIMIT = 10
DEFAULT_WEBHOOK_URL = "https://alfredaitech.com/api/v1/inbox/sms"
# Must match sms_inbox.UNKNOWN_SMS_SENDER — placeholder when sender phone is unavailable.
SHORTCUT_UNKNOWN_SENDER = "+10000000000"
# Widely supported on iOS 13+ — coerces Shortcut Input (text or message object) to text.
DETECT_TEXT_ACTION = "is.workflow.actions.detect.text"
# Correct action for Message Received input (not properties.contentitems).
PROPERTIES_MESSAGES_ACTION = "is.workflow.actions.properties.messages"
DETECT_CONTACTS_ACTION = "is.workflow.actions.detect.contacts"
PROPERTIES_CONTACTS_ACTION = "is.workflow.actions.properties.contacts"
FIND_MESSAGES_ACTION = "is.workflow.actions.filter.messages"
REPEAT_EACH_ACTION = "is.workflow.actions.repeat.each"
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


def _shortcut_input_variable() -> dict[str, Any]:
    """Unwrapped variable ref — required by Get Details of Messages on some iOS builds."""
    return {
        "Type": "Variable",
        "VariableName": "Shortcut Input",
    }


def _repeat_item_variable() -> dict[str, Any]:
    return {
        "Type": "Variable",
        "VariableName": "Repeat Item",
    }


def _repeat_item_attachment() -> dict[str, Any]:
    return {
        "Value": _repeat_item_variable(),
        "WFSerializationType": "WFTextTokenAttachment",
    }


def _message_input_variable(*, repeat: bool) -> dict[str, Any]:
    return _repeat_item_variable() if repeat else _shortcut_input_variable()


def _detect_text_from_message_input(*, output_name: str, repeat: bool) -> tuple[dict[str, Any], str]:
    action_uuid = _uid()
    attachment = _repeat_item_attachment() if repeat else _shortcut_input_attachment()
    return {
        "WFWorkflowActionIdentifier": DETECT_TEXT_ACTION,
        "WFWorkflowActionParameters": {
            "UUID": action_uuid,
            "WFInput": attachment,
            "CustomOutputName": output_name,
        },
    }, action_uuid


def _detect_text_from_shortcut_input(*, output_name: str) -> tuple[dict[str, Any], str]:
    return _detect_text_from_message_input(output_name=output_name, repeat=False)


def _message_property_action(
    *,
    property_name: str,
    output_name: str,
    repeat: bool = False,
) -> tuple[dict[str, Any], str]:
    action_uuid = _uid()
    return {
        "WFWorkflowActionIdentifier": PROPERTIES_MESSAGES_ACTION,
        "WFWorkflowActionParameters": {
            "UUID": action_uuid,
            "WFContentItemPropertyName": property_name,
            "WFInput": _message_input_variable(repeat=repeat),
            "CustomOutputName": output_name,
        },
    }, action_uuid


def _detect_contacts_from_message_input(*, repeat: bool) -> tuple[dict[str, Any], str]:
    action_uuid = _uid()
    wf_input = _repeat_item_variable() if repeat else _shortcut_input_variable()
    return {
        "WFWorkflowActionIdentifier": DETECT_CONTACTS_ACTION,
        "WFWorkflowActionParameters": {
            "UUID": action_uuid,
            "WFInput": wf_input,
            "CustomOutputName": "Contacts",
        },
    }, action_uuid


def _detect_contacts_from_shortcut_input() -> tuple[dict[str, Any], str]:
    return _detect_contacts_from_message_input(repeat=False)


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


def _dict_field_text(key: str, text: str) -> dict[str, Any]:
    return {
        "WFKey": {"Value": {"string": key, "attachmentsByRange": {}}},
        "WFItemType": 0,
        "WFValue": {"Value": {"string": text, "attachmentsByRange": {}}, "WFSerializationType": "WFTextTokenString"},
    }


def _find_incoming_messages_action(*, limit: int = BACKFILL_MESSAGE_LIMIT) -> tuple[dict[str, Any], str]:
    action_uuid = _uid()
    return {
        "WFWorkflowActionIdentifier": FIND_MESSAGES_ACTION,
        "WFWorkflowActionParameters": {
            "UUID": action_uuid,
            "WFContentItemFilter": {
                "Value": {
                    "WFActionParameterFilterPrefix": 1,
                    "WFContentPredicateBoundedDate": False,
                    "WFActionParameterFilterTemplates": [
                        {
                            "Operator": 4,
                            "Property": "Is From Me",
                            "Removable": True,
                            "Values": {"Bool": False},
                        }
                    ],
                },
                "WFSerializationType": "WFContentPredicateTableTemplate",
            },
            "WFContentItemSortProperty": "Date",
            "WFContentItemSortOrder": "Latest First",
            "WFContentItemLimitEnabled": True,
            "WFContentItemLimitNumber": limit,
            "CustomOutputName": "Messages",
        },
    }, action_uuid


def _repeat_each_start(*, list_uuid: str, list_name: str, group_uuid: str) -> dict[str, Any]:
    return {
        "WFWorkflowActionIdentifier": REPEAT_EACH_ACTION,
        "WFWorkflowActionParameters": {
            "GroupingIdentifier": group_uuid,
            "WFControlFlowMode": 0,
            "WFInput": _attachment(list_uuid, list_name),
        },
    }


def _repeat_each_end(*, group_uuid: str) -> dict[str, Any]:
    return {
        "WFWorkflowActionIdentifier": REPEAT_EACH_ACTION,
        "WFWorkflowActionParameters": {
            "UUID": _uid(),
            "GroupingIdentifier": group_uuid,
            "WFControlFlowMode": 2,
        },
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

    Message Received passes the incoming message as Shortcut Input. We read:
    - body via detect.text
    - sender phone via Get Details of Messages → Phone Number
      (``is.workflow.actions.properties.messages``, not ``properties.contentitems``)
    - sender name via Get Contacts from Input → Get Name
    """
    dict_uuid = _uid()

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
        token_action, token_header_value, import_questions = _token_prompt_action()
        actions = [
            token_action,
            get_body,
            get_phone,
            get_contacts,
            get_name,
            payload_dict,
        ]

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


def signed_backfill_shortcut_path() -> Path:
    return Path(__file__).resolve().parents[2] / "integrations" / "ios" / BACKFILL_SHORTCUT_FILENAME


def backfill_shortcut_download_url(*, app_base_url: str) -> str:
    base = app_base_url.rstrip("/")
    return f"{base}/api/v1/integrations/ios/{BACKFILL_SHORTCUT_FILENAME}"


def build_sms_backfill_install_urls(*, app_base_url: str) -> tuple[str, str]:
    """Return (import_url, shortcut_url) for the one-time SMS backfill shortcut."""
    shortcut_url = backfill_shortcut_download_url(app_base_url=app_base_url)
    query = urlencode({"url": shortcut_url, "name": BACKFILL_SHORTCUT_NAME})
    import_url = f"shortcuts://import-shortcut/?{query}"
    return import_url, shortcut_url


def build_sms_backfill_shortcut(
    *,
    webhook_url: str = DEFAULT_WEBHOOK_URL,
    sms_token: str | None = None,
    message_limit: int = BACKFILL_MESSAGE_LIMIT,
) -> bytes:
    """Return binary plist bytes for the one-time SMS backfill shortcut.

    Run manually from Shortcuts: finds the latest incoming texts, then POSTs each
    to the Albert webhook. Re-running is safe — ``message_id`` is a stable hash of
    the message body for dedup via ``external_id``.
    """
    find_messages, messages_uuid = _find_incoming_messages_action(limit=message_limit)
    repeat_group = _uid()

    get_body, body_uuid = _detect_text_from_message_input(output_name="Message Text", repeat=True)
    get_phone, phone_uuid = _message_property_action(
        property_name="Phone Number",
        output_name="Sender Phone",
        repeat=True,
    )
    get_date, date_uuid = _message_property_action(
        property_name="Date",
        output_name="Message Date",
        repeat=True,
    )
    get_contacts, contacts_uuid = _detect_contacts_from_message_input(repeat=True)
    get_name, name_uuid = _contact_property_action(
        property_name="Name",
        contact_uuid=contacts_uuid,
        output_name="Sender Name",
    )
    get_hash, hash_uuid = _hash_action(
        input_attachment=_attachment(body_uuid, "Message Text"),
        output_name="Message ID",
    )

    dict_uuid = _uid()
    payload_dict = {
        "WFWorkflowActionIdentifier": "is.workflow.actions.dictionary",
        "WFWorkflowActionParameters": {
            "UUID": dict_uuid,
            "WFItems": {
                "Value": {
                    "WFDictionaryFieldValueItems": [
                        _dict_field("body", _attachment(body_uuid, "Message Text")),
                        _dict_field("from_number", _attachment(phone_uuid, "Sender Phone")),
                        _dict_field("from_name", _attachment(name_uuid, "Sender Name")),
                        _dict_field("message_id", _attachment(hash_uuid, "Message ID")),
                        _dict_field("received_at", _attachment(date_uuid, "Message Date")),
                        _dict_field_text("backfill", "true"),
                    ]
                },
                "WFSerializationType": "WFDictionaryFieldValue",
            },
        },
    }

    loop_actions: list[dict[str, Any]] = [
        get_body,
        get_phone,
        get_date,
        get_contacts,
        get_name,
        get_hash,
        payload_dict,
    ]

    if sms_token:
        token_header_value: dict[str, Any] = {
            "Value": {"string": sms_token, "attachmentsByRange": {}},
            "WFSerializationType": "WFTextTokenString",
        }
        import_questions: list[dict[str, Any]] = []
        prefix_actions: list[dict[str, Any]] = [find_messages]
    else:
        token_action, token_header_value, import_questions = _token_prompt_action()
        prefix_actions = [token_action, find_messages]

    loop_actions.append(
        _post_sms_webhook_action(
            webhook_url=webhook_url,
            dict_uuid=dict_uuid,
            token_header_value=token_header_value,
        )
    )

    actions: list[dict[str, Any]] = [
        *prefix_actions,
        _repeat_each_start(list_uuid=messages_uuid, list_name="Messages", group_uuid=repeat_group),
        *loop_actions,
        _repeat_each_end(group_uuid=repeat_group),
    ]

    shortcut: dict[str, Any] = {
        "WFWorkflowClientVersion": "2302.0.4",
        "WFWorkflowClientRelease": "2302.0.4",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowName": BACKFILL_SHORTCUT_NAME,
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
