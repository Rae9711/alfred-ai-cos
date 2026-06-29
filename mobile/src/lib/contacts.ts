import { requireOptionalNativeModule } from "expo-modules-core";
import type * as Contacts from "expo-contacts";

export type ContactMatch = {
  id: string;
  name: string;
  phone: string;
};

export type ContactsPermissionStatus =
  | "granted"
  | "denied"
  | "undetermined"
  | "unavailable";

const ExpoContactsNative = requireOptionalNativeModule("ExpoContacts");

export function isContactsNativeAvailable(): boolean {
  return ExpoContactsNative != null;
}

async function loadContactsModule(): Promise<typeof Contacts> {
  if (!isContactsNativeAvailable()) {
    throw new Error(
      "Contacts is not available in this build — reinstall Albert from TestFlight or rebuild the app.",
    );
  }
  try {
    return await import("expo-contacts");
  } catch {
    throw new Error(
      "Contacts is not available in this build — reinstall Albert from TestFlight or rebuild the app.",
    );
  }
}

function displayName(contact: Contacts.Contact): string {
  const parts = [contact.firstName, contact.lastName].filter(Boolean);
  if (parts.length > 0) return parts.join(" ").trim();
  return contact.name?.trim() || "Unknown";
}

function pickPhone(numbers: Contacts.PhoneNumber[]): string | null {
  const mobile = numbers.find((n) => n.label?.toLowerCase() === "mobile");
  const raw = (mobile ?? numbers[0])?.number?.trim();
  if (!raw) return null;
  return raw.replace(/[^\d+]/g, "") || null;
}

function nameMatches(query: string, contact: Contacts.Contact): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const candidates = [
    contact.name,
    contact.firstName,
    contact.lastName,
    contact.nickname,
    [contact.firstName, contact.lastName].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .map((s) => s!.toLowerCase());
  return candidates.some(
    (c) => c.includes(q) || q.includes(c) || c.replace(/\s/g, "").includes(q.replace(/\s/g, "")),
  );
}

export async function getContactsPermissionStatus(): Promise<ContactsPermissionStatus> {
  if (!isContactsNativeAvailable()) return "unavailable";
  try {
    const Contacts = await loadContactsModule();
    const { status } = await Contacts.getPermissionsAsync();
    if (status === Contacts.PermissionStatus.GRANTED) return "granted";
    if (status === Contacts.PermissionStatus.DENIED) return "denied";
    return "undetermined";
  } catch {
    return "unavailable";
  }
}

export async function requestContactsPermission(): Promise<boolean> {
  if (!isContactsNativeAvailable()) return false;
  try {
    const Contacts = await loadContactsModule();
    const { status } = await Contacts.requestPermissionsAsync();
    return status === Contacts.PermissionStatus.GRANTED;
  } catch {
    return false;
  }
}

export async function searchContactsByName(name: string): Promise<ContactMatch[]> {
  const Contacts = await loadContactsModule();
  const { data } = await Contacts.getContactsAsync({
    fields: [
      Contacts.Fields.PhoneNumbers,
      Contacts.Fields.FirstName,
      Contacts.Fields.LastName,
      Contacts.Fields.Name,
      Contacts.Fields.Nickname,
    ],
  });

  const matches: ContactMatch[] = [];
  const seen = new Set<string>();

  for (const contact of data) {
    if (!nameMatches(name, contact)) continue;
    const phone = pickPhone(contact.phoneNumbers ?? []);
    if (!phone) continue;
    const key = `${contact.id}:${phone}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({
      id: contact.id ?? key,
      name: displayName(contact),
      phone,
    });
  }

  return matches.sort((a, b) => a.name.localeCompare(b.name));
}
