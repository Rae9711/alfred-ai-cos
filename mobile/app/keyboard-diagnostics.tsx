// Keyboard / App Group diagnostics — reachable from Settings.

import { KeyboardDiagnosticsScreen } from "@/screens/KeyboardDiagnosticsScreen";
import { LocaleProvider } from "@/context/LocaleContext";

export default function KeyboardDiagnosticsRoute() {
  return (
    <LocaleProvider>
      <KeyboardDiagnosticsScreen />
    </LocaleProvider>
  );
}
