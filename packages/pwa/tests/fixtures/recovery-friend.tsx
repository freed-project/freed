import React from "react";
import { createRoot } from "react-dom/client";
import { PwaRecoveryFriendEditor } from "../../src/components/PwaRecoveryFriendEditor";
import type { LibraryCoreRecoveryIntentReviewResponseV1, LibraryCoreRecoveryReissueReceiptV1 } from "@freed/shared/library-core";
import "../../src/index.css";

// The browser test supplies mocked verification and signing modules before this
// entry loads. This harness never opens or mutates a Library.
const proof = { prepared: 0, attempts: 0, busy: [] as boolean[], replacement: null as LibraryCoreRecoveryReissueReceiptV1 | null };
Object.assign(window, { __friendProof: proof });
createRoot(document.getElementById("root")!).render(<main style={{ padding: 16 }}>
  <PwaRecoveryFriendEditor review={{ transactionId: "original" } as LibraryCoreRecoveryIntentReviewResponseV1}
    onReplacement={value => { proof.replacement = value; }}
    onMutating={value => { proof.busy.push(value); }} />
</main>);
