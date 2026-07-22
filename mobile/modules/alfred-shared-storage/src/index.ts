import { NativeModulesProxy, requireNativeModule } from "expo-modules-core";

type ConfirmedAction = {
  kind?: string;
  id?: string;
  title?: string;
  evidence?: string | null;
  remind_at?: string | null;
  confirmed_at?: string;
};

type PendingHandoff = {
  conversation_id?: string;
  conversation?: Record<string, unknown>;
  insight?: string;
  replies?: unknown[];
  actions?: unknown[];
  clipboard_text?: string;
  [key: string]: unknown;
};

type AlfredSharedStorageNative = {
  isAppGroupAvailable(): Promise<boolean>;
  setAuthToken(token: string | null): Promise<boolean | void>;
  getAuthToken(): Promise<string | null>;
  getAuthTokenUpdatedAt(): Promise<string | null>;
  getKeyboardLastSeen(): Promise<string | null>;
  setApiBaseUrl(url: string): Promise<boolean | void>;
  drainConfirmedActions(): Promise<ConfirmedAction[]>;
  takePendingHandoff(): Promise<PendingHandoff | null>;
  peekPendingHandoff(): Promise<PendingHandoff | null>;
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

export class AppGroupSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppGroupSyncError";
  }
}

export async function isAppGroupAvailable(): Promise<boolean> {
  const mod = getNative();
  if (!mod?.isAppGroupAvailable) return false;
  try {
    return await mod.isAppGroupAvailable();
  } catch {
    return false;
  }
}

export async function setSharedAuthToken(token: string | null): Promise<void> {
  const mod = getNative();
  if (!mod) {
    throw new AppGroupSyncError(
      "Native module 未链接 — 当前 IPA 无法写入 App Group，需重新构建",
    );
  }
  const ok = await mod.setAuthToken(token);
  // Older builds returned void; treat undefined as success only if we can read back.
  if (ok === false) {
    throw new AppGroupSyncError(
      "App Group 不可访问 — 检查 entitlements / provisioning（group.com.haoruiwang.alfred）",
    );
  }
}

export async function getSharedAuthToken(): Promise<string | null> {
  const mod = getNative();
  if (!mod) return null;
  return mod.getAuthToken();
}

export async function getSharedAuthTokenUpdatedAt(): Promise<string | null> {
  const mod = getNative();
  if (!mod?.getAuthTokenUpdatedAt) return null;
  try {
    return await mod.getAuthTokenUpdatedAt();
  } catch {
    return null;
  }
}

export async function getKeyboardLastSeen(): Promise<string | null> {
  const mod = getNative();
  if (!mod?.getKeyboardLastSeen) return null;
  try {
    return await mod.getKeyboardLastSeen();
  } catch {
    return null;
  }
}

export async function setSharedApiBaseUrl(url: string): Promise<void> {
  const mod = getNative();
  if (!mod) {
    throw new AppGroupSyncError(
      "Native module 未链接 — 当前 IPA 无法写入 App Group，需重新构建",
    );
  }
  const ok = await mod.setApiBaseUrl(url);
  if (ok === false) {
    throw new AppGroupSyncError(
      "App Group 不可访问 — 检查 entitlements / provisioning（group.com.haoruiwang.alfred）",
    );
  }
}

export async function drainKeyboardConfirmedActions(): Promise<ConfirmedAction[]> {
  const mod = getNative();
  if (!mod) return [];
  return mod.drainConfirmedActions();
}

export async function takePendingConversationHandoff(): Promise<PendingHandoff | null> {
  const mod = getNative();
  if (!mod?.takePendingHandoff) return null;
  try {
    return await mod.takePendingHandoff();
  } catch {
    return null;
  }
}

export async function peekPendingConversationHandoff(): Promise<PendingHandoff | null> {
  const mod = getNative();
  if (!mod?.peekPendingHandoff) return null;
  try {
    return await mod.peekPendingHandoff();
  } catch {
    return null;
  }
}

/** True when the native App Group module is linked (custom/dev client). */
export function isSharedStorageNativeAvailable(): boolean {
  return getNative() != null;
}

export type { ConfirmedAction, PendingHandoff };
