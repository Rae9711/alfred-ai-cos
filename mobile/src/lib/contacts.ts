import { requireOptionalNativeModule } from "expo-modules-core";
import type * as Contacts from "expo-contacts";

import {
  pickAutoContact,
  scoreContactNameMatch,
  type NameScored,
} from "@/lib/contactNameMatch";

export type ContactMatch = {
  id: string;
  name: string;
  phone: string;
};

export type EmailContactMatch = {
  id: string;
  name: string;
  email: string;
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
      "Contacts is not available in this build — reinstall Alfred from TestFlight or rebuild the app.",
    );
  }
  try {
    return await import("expo-contacts");
  } catch {
    throw new Error(
      "Contacts is not available in this build — reinstall Alfred from TestFlight or rebuild the app.",
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

function pickEmail(addresses: Contacts.EmailAddress[]): string | null {
  const work = addresses.find((n) => n.label?.toLowerCase() === "work");
  const home = addresses.find((n) => n.label?.toLowerCase() === "home");
  const raw = (work ?? home ?? addresses[0])?.email?.trim();
  if (!raw || !raw.includes("@")) return null;
  return raw.toLowerCase();
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

export async function searchContactsByName(
  name: string,
): Promise<NameScored<ContactMatch>[]> {
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

  const matches: NameScored<ContactMatch>[] = [];
  const seen = new Set<string>();

  for (const contact of data) {
    const score = scoreContactNameMatch(name, contact);
    if (score < 50) continue;
    const phone = pickPhone(contact.phoneNumbers ?? []);
    if (!phone) continue;
    const key = `${contact.id}:${phone}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({
      id: contact.id ?? key,
      name: displayName(contact),
      phone,
      score,
    });
  }

  return matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export async function searchContactsEmailByName(
  name: string,
): Promise<NameScored<EmailContactMatch>[]> {
  const Contacts = await loadContactsModule();
  const { data } = await Contacts.getContactsAsync({
    fields: [
      Contacts.Fields.Emails,
      Contacts.Fields.FirstName,
      Contacts.Fields.LastName,
      Contacts.Fields.Name,
      Contacts.Fields.Nickname,
    ],
  });

  const matches: NameScored<EmailContactMatch>[] = [];
  const seen = new Set<string>();

  for (const contact of data) {
    const score = scoreContactNameMatch(name, contact);
    if (score < 50) continue;
    const email = pickEmail(contact.emails ?? []);
    if (!email) continue;
    const key = `${contact.id}:${email}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({
      id: contact.id ?? key,
      name: displayName(contact),
      email,
      score,
    });
  }

  return matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export { pickAutoContact, scoreContactNameMatch } from "@/lib/contactNameMatch";

/** Last-10-digit suffix → contact display name for SMS sender resolution. */
export async function loadContactNamesByPhone(): Promise<Map<string, string>> {
  const Contacts = await loadContactsModule();
  const { data } = await Contacts.getContactsAsync({
    fields: [
      Contacts.Fields.PhoneNumbers,
      Contacts.Fields.FirstName,
      Contacts.Fields.LastName,
      Contacts.Fields.Name,
    ],
  });

  const map = new Map<string, string>();
  for (const contact of data) {
    const name = displayName(contact);
    for (const entry of contact.phoneNumbers ?? []) {
      const digits = (entry.number ?? "").replace(/\D/g, "");
      const suffix = digits.slice(-10);
      if (suffix.length < 7) continue;
      if (!map.has(suffix)) map.set(suffix, name);
    }
  }
  return map;
}
