import { useCallback, useRef, useState } from "react";
import { ProviderRiskDialog } from "@freed/ui/components/legal/ProviderRiskDialog";
import type { ProviderRiskId } from "@freed/shared";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import {
  acceptProviderRisk,
  hasAcceptedProviderRisk,
} from "../lib/legal-consent";

export function useProviderRiskGate(provider: ProviderRiskId) {
  const [open, setOpen] = useState(false);
  const pendingAction = useRef<null | (() => Promise<void>)>(null);

  const confirm = useCallback(
    async (action: () => Promise<void> | void) => {
      if (await hasAcceptedProviderRisk(provider)) {
        await action();
        return;
      }

      pendingAction.current = async () => {
        await action();
      };
      setOpen(true);
    },
    [provider],
  );

  const dialog = (
    <ProviderRiskDialog
      open={open}
      provider={provider}
      openUrl={(url: string) => {
        void shellOpen(url);
      }}
      onClose={() => setOpen(false)}
      onAccept={async () => {
        await acceptProviderRisk(provider);
        setOpen(false);
        const action = pendingAction.current;
        pendingAction.current = null;
        if (action) await action();
      }}
    />
  );

  return {
    confirm,
    dialog,
  };
}
