// Companion avatar state shared across Today, Ask, and the tab bar home button.
//
// The center "+" on the tab bar is Alfred's companion "home". When the user is on
// Today the avatar floats top-right; on Ask it sits bottom-right; on Inbox / You it
// rests inside the home button instead of the plus glyph.
//
// Wrap the tab shell (app/(tabs)/index.tsx) with CompanionAvatarProvider so screens
// can call useCompanionAvatar() to sync mood (e.g. thinking while Ask is loading).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  loadCompanionMeta,
  moodForContext,
  recordCompanionEvent,
  updateCompanionColor,
} from "@/lib/companionMeta";
import {
  getDefaultMeta,
  type AgentMeta,
  type AvatarPlacement,
  type AvatarState,
} from "@/lib/agentMeta";

type CompanionAvatarApi = {
  /** Persisted XP / level / cosmetics. */
  meta: AgentMeta;
  /** Where the shell is currently showing the avatar. */
  placement: AvatarPlacement;
  /** Derived visual mood from placement + flags. */
  state: AvatarState;
  /** True while Ask is waiting on the assistant API. */
  thinking: boolean;
  /** Update which tab owns the avatar (home | today | ask). */
  setPlacement: (p: AvatarPlacement) => void;
  /** Ask screen toggles this while api.ask is in flight. */
  setThinking: (v: boolean) => void;
  /** Grant XP for an agent event and refresh meta. Resolves with whether this
   * event crossed a level threshold, so callers can surface that (toast text,
   * accessibility announcement) — see T-D4/T-D5 in the avatar design doc. */
  recordEvent: (
    eventType: Parameters<typeof recordCompanionEvent>[0],
  ) => Promise<{ leveledUp: boolean; level: number }>;
  /** Persist a tint-color change and refresh meta (future settings sheet). */
  setColor: (color: string) => Promise<void>;
  /** Briefly override the placement-derived mood with a real backend outcome
   * (e.g. "error" on a failed approval), then auto-revert. Reserved for real
   * status, not UI flourishes — see CompanionAvatar.tsx's tap-bounce comment
   * for why the center-button tap animation deliberately stays local instead
   * of going through this. */
  flashState: (state: AvatarState, durationMs?: number) => void;
};

const CompanionAvatarContext = createContext<CompanionAvatarApi | null>(null);

export function useCompanionAvatar(): CompanionAvatarApi {
  const ctx = useContext(CompanionAvatarContext);
  if (!ctx) {
    throw new Error(
      "useCompanionAvatar must be used within <CompanionAvatarProvider>",
    );
  }
  return ctx;
}

export function CompanionAvatarProvider({ children }: { children: ReactNode }) {
  // Start with defaults so the shell renders immediately; SecureStore hydrates async.
  const [meta, setMeta] = useState<AgentMeta>(getDefaultMeta);
  const [placement, setPlacement] = useState<AvatarPlacement>("home");
  const [thinking, setThinking] = useState(false);
  const [flash, setFlash] = useState<AvatarState | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate persisted growth meta from SecureStore on mount.
  useEffect(() => {
    void loadCompanionMeta().then(setMeta);
  }, []);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  // A flash (real backend outcome) always wins over the placement-derived mood.
  const state =
    flash ?? moodForContext({ placement, thinking, sleeping: false });

  const flashState = useCallback<CompanionAvatarApi["flashState"]>(
    (next, durationMs = 1800) => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      setFlash(next);
      flashTimer.current = setTimeout(() => {
        setFlash(null);
        flashTimer.current = null;
      }, durationMs);
    },
    [],
  );

  const recordEvent = useCallback<
    CompanionAvatarApi["recordEvent"]
  >(async (eventType) => {
    const result = await recordCompanionEvent(eventType);
    setMeta(result.meta);
    return { leveledUp: result.leveledUp, level: result.meta.level };
  }, []);

  // REVISION (stale-UI bug fix): the original PR exposed updateCompanionColor as
  // a bare module function. Calling it wrote the new tint to SecureStore but
  // never touched this provider's `meta` state, so the avatar kept rendering the
  // old color until the next app launch — storage and the on-screen UI disagreed.
  //
  // Fix: color changes now flow through this provider method, which (1) persists
  // via the serialized queue in companionMeta and (2) pushes the returned meta
  // into React state with setMeta so every subscribed screen re-renders with the
  // new tint immediately. Regression-tested in CompanionAvatarContext.test.tsx
  // ("updates the in-memory context, not just storage").
  const setColor = useCallback<CompanionAvatarApi["setColor"]>(
    async (color) => {
      const next = await updateCompanionColor(color);
      setMeta(next);
    },
    [],
  );

  const api = useMemo<CompanionAvatarApi>(
    () => ({
      meta,
      placement,
      state,
      thinking,
      setPlacement,
      setThinking,
      recordEvent,
      setColor,
      flashState,
    }),
    [meta, placement, state, thinking, recordEvent, setColor, flashState],
  );

  return (
    <CompanionAvatarContext.Provider value={api}>
      {children}
    </CompanionAvatarContext.Provider>
  );
}
