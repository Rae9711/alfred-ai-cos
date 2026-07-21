import { NativeModulesProxy, requireNativeModule } from "expo-modules-core";

type ConfirmedAction = {
  kind?: string;
  id?: string;
  title?: string;
  evidence?: string | null;
  remind_at?: string | null;
  confirmed_at?: string;
};

type AlfredSharedStorageNative = {
  setAuthToken(token: string | null): Promise<void>;
  getAuthToken(): Promise<string | null>;
  setApiBaseUrl(url: string): Promise<void>;
  drainConfirmedActions(): Promise<ConfirmedAction[]>;
};

let native: AlfredSharedStorageNative | null = null;

function getNative(): AlfredSharedStorageNative | null {
  if (native) return native;
  try {
    native = requireNativeModule<AlfredSharedStorageNative>("AlfredSharedStorage");
    return native;
  } catch {
    // Expo Go / web — App Group bridge unavailable until a custom/dev build.
    return (NativeModulesProxy.AlfredSharedStorage as AlfredSharedStorageNative | undefined) ?? null;
  }
}

export async function setSharedAuthToken(token: string | null): Promise<void> {
  const mod = getNative();
  if (!mod) return;
  await mod.setAuthToken(token);
}

export async function getSharedAuthToken(): Promise<string | null> {
  const mod = getNative();
  if (!mod) return null;
  return mod.getAuthToken();
}

export async function setSharedApiBaseUrl(url: string): Promise<void> {
  const mod = getNative();
  if (!mod) return;
  await mod.setApiBaseUrl(url);
}

export async function drainKeyboardConfirmedActions(): Promise<ConfirmedAction[]> {
  const mod = getNative();
  if (!mod) return [];
  return mod.drainConfirmedActions();
}

export type { ConfirmedAction };
