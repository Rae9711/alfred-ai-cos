import { Linking, Platform } from "react-native";

/** Open the system Messages app with recipient and body pre-filled (user taps Send). */
export function openSmsCompose(phone: string, body: string): void {
  const digits = phone.trim();
  if (!digits) return;
  const encoded = encodeURIComponent(body);
  const query = Platform.OS === "ios" ? `&body=${encoded}` : `?body=${encoded}`;
  void Linking.openURL(`sms:${digits}${query}`);
}
