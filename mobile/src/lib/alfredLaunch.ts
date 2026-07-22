/**
 * Cross-route Alfred hub launch params.
 *
 * `/capture` and `albert://capture?text=` live outside WorkflowProvider, so they
 * stash intent here; the tabs shell switches to Alfred and the hub consumes it.
 */

export type AlfredLaunchOpts = {
  /** Open embedded capture (idle → recording → parsed). */
  capture?: boolean;
  /** Prefill for capture auto-submit, or a free-chat message to send. */
  text?: string;
  mode?: "schedule" | "sms" | "reminder" | "capture";
  /** Prefill composer without sending (e.g. "Remind me "). */
  seed?: string;
};

type Listener = () => void;

let pendingOpts: AlfredLaunchOpts | null = null;
let pendingSwitchToAlfred = false;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

/** Stash launch opts and request the Alfred tab (for deep links outside Workflow). */
export function requestAlfredOpen(opts?: AlfredLaunchOpts) {
  pendingOpts = opts ?? {};
  pendingSwitchToAlfred = true;
  notify();
}

/** Used by WorkflowContext.openAlfred when already inside the tab shell. */
export function setPendingAlfredLaunch(opts: AlfredLaunchOpts) {
  pendingOpts = opts;
  notify();
}

export function consumeAlfredTabRequest(): boolean {
  const v = pendingSwitchToAlfred;
  pendingSwitchToAlfred = false;
  return v;
}

export function consumeAlfredLaunchOpts(): AlfredLaunchOpts | null {
  const o = pendingOpts;
  pendingOpts = null;
  return o;
}

export function subscribeAlfredLaunch(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
