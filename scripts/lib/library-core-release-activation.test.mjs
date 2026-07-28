import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  LIBRARY_CORE_ACTIVATION_DECISION_STATES,
  assertStableOwnerApprovalPull,
  createLibraryCoreReleaseActivation,
  fetchGithubJson,
  inspectLibraryCoreActivationManifest,
  inspectPreviousLibraryCoreActivationWitness,
  libraryCoreOwnerApprovalCommentBody,
  libraryCoreReleaseArtifactProposalDigest,
  prepareLibraryCoreReleaseActivation,
  validateLibraryCoreReleaseActivation,
  validatePreviousLibraryCoreActivationContinuity,
} from "./library-core-release-activation.mjs";

const PRODUCT_SHA = "a".repeat(40);
const NEXT_PRODUCT_SHA = "b".repeat(40);
const RANGE = Object.freeze({
  channel: "dev",
  previousPublishedTag: null,
  startMode: "complete_history",
  fromExclusiveCommitSha: null,
  toInclusiveProductCommitSha: PRODUCT_SHA,
});

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(compareAscii)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Digest(value) {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(value))
    .digest("hex")}`;
}

function migrationTransition(overrides = {}) {
  return {
    activationId: "migration-private-corpus-v1",
    gate: "C",
    kind: "migration_candidate_execution",
    rollbackTrigger:
      "The accepted checkpoint does not match the source frontier.",
    receiptExpectations: [
      "migration_receipt",
      "same_frontier_rollback_receipt",
    ],
    ...overrides,
  };
}

function manifestContents(transitions = []) {
  return `${JSON.stringify({ schemaVersion: 1, transitions }, null, 2)}\n`;
}

const EMPTY_MANIFEST_INSPECTION = inspectLibraryCoreActivationManifest({
  currentContents: manifestContents(),
});

function activationManifestInspection(transitions) {
  return inspectLibraryCoreActivationManifest({
    previousContents: manifestContents(),
    currentContents: manifestContents(transitions),
  });
}

function ownerApprovalFixture({
  inspected,
  transitions,
  releaseArtifact,
  approvalArtifact = releaseArtifact,
  bindingOverrides = {},
  commentOverrides = {},
  pullOverrides = {},
} = {}) {
  const pullNumber = 1_205;
  const commentId = 9_001;
  const proposalDigest = libraryCoreReleaseArtifactProposalDigest({
    artifact: approvalArtifact,
  });
  const marker = `<!-- freed-library-core-activation-approval:${canonicalJson({
    inspectionDigest: inspected.inspectionDigest,
    manifestCurrentDigest: inspected.manifest.currentDigest,
    manifestPath: inspected.manifest.path,
    productCommitSha: PRODUCT_SHA,
    pullNumber,
    releaseArtifactPath: "release-notes/releases/v26.7.2800-dev.json",
    releaseArtifactProposalDigest: proposalDigest,
    releaseTag: "v26.7.2800-dev",
    repository: "freed-project/freed",
    schemaVersion: 1,
    transitionSetDigest: sha256Digest({
      schemaVersion: 1,
      transitions,
    }),
    ...bindingOverrides,
  })} -->`;
  const reference = `https://github.com/freed-project/freed/pull/${pullNumber}#issuecomment-${commentId}`;
  const pull = {
    number: pullNumber,
    state: "open",
    merged_at: null,
    base: {
      ref: "dev",
      sha: "b".repeat(40),
      repo: { full_name: "freed-project/freed" },
    },
    head: {
      sha: "c".repeat(40),
      repo: { full_name: "freed-project/freed" },
    },
    ...pullOverrides,
  };
  const comment = {
    id: commentId,
    html_url: reference,
    issue_url: `https://api.github.com/repos/freed-project/freed/issues/${pullNumber}`,
    user: { login: "AubreyF", type: "User" },
    author_association: "CONTRIBUTOR",
    body: [
      "(AI Generated).",
      "",
      marker,
      "",
      "I approve this exact Library Core release activation.",
    ].join("\n"),
    ...commentOverrides,
  };
  return {
    reference,
    loadOwnerApprovalEvidence: () => ({
      pull,
      comment,
      releaseArtifact,
    }),
  };
}

function releaseArtifactFor(activation, overrides = {}) {
  return {
    tag: "v26.7.2800-dev",
    version: "26.7.2800-dev",
    channel: "dev",
    dayKey: "26.7.28",
    approved: true,
    source: {
      channel: "dev",
      productCommitSha: PRODUCT_SHA,
      libraryCoreActivation: activation,
    },
    release: {
      deck: "Library Core release activation test.",
      features: [],
      fixes: [],
      followUps: [],
    },
    ...overrides,
  };
}

test("GitHub approval reads disable ambient curl configuration", () => {
  let request = null;
  const value = fetchGithubJson("repos/freed-project/freed/pulls/1205", {
    resolveToken: () => "fixture-token",
    execFile: (command, args, options) => {
      request = { command, args, options };
      return '{"number":1205}';
    },
  });

  assert.deepEqual(value, { number: 1205 });
  assert.equal(request.command, "/usr/bin/curl");
  assert.equal(request.args[0], "--disable");
  assert.equal(request.args.includes("fixture-token"), false);
  assert.equal(
    request.options.input,
    'header = "Authorization: Bearer fixture-token"\n',
  );
});

test("fresh Library Core activation deltas remain blocked until reviewed", () => {
  const manifestInspection = activationManifestInspection([
    migrationTransition(),
  ]);
  const value = prepareLibraryCoreReleaseActivation({
    range: RANGE,
    manifestInspection,
  });

  assert.equal(
    value.decision.state,
    LIBRARY_CORE_ACTIVATION_DECISION_STATES.REVIEW_REQUIRED,
  );
  assert.throws(
    () =>
      validateLibraryCoreReleaseActivation({
        value,
        expectedRange: RANGE,
        expectedManifestInspection: manifestInspection,
      }),
    /remains review_required/,
  );
});

test("previous activation evidence requires the immutable manifest path and digest", () => {
  const previousInspection = inspectLibraryCoreActivationManifest({
    currentContents: manifestContents(),
  });
  const previousActivation = createLibraryCoreReleaseActivation({
    range: RANGE,
    manifestInspection: previousInspection,
  });
  const previousArtifact = releaseArtifactFor(previousActivation);

  assert.throws(
    () =>
      inspectPreviousLibraryCoreActivationWitness({
        releaseArtifact: previousArtifact,
        tag: "v26.7.2700-dev",
        manifestRead: { state: "absent" },
      }),
    /records Library Core activation evidence, but its immutable manifest path is absent/,
  );
  assert.throws(
    () =>
      inspectPreviousLibraryCoreActivationWitness({
        releaseArtifact: previousArtifact,
        tag: "v26.7.2700-dev",
        manifestRead: {
          state: "present",
          contents: manifestContents([migrationTransition()]),
        },
      }),
    /manifest digest does not match its immutable tag contents/,
  );

  const witness = inspectPreviousLibraryCoreActivationWitness({
    releaseArtifact: previousArtifact,
    tag: "v26.7.2700-dev",
    manifestRead: {
      state: "present",
      contents: manifestContents(),
    },
  });
  validatePreviousLibraryCoreActivationContinuity({
    witness,
    manifestInspection: inspectLibraryCoreActivationManifest({
      previousContents: manifestContents(),
      currentContents: manifestContents(),
    }),
  });
  assert.throws(
    () =>
      validatePreviousLibraryCoreActivationContinuity({
        witness,
        manifestInspection: inspectLibraryCoreActivationManifest({
          currentContents: manifestContents(),
        }),
      }),
    /does not continue from previous published release/,
  );
});

test("a reviewed release may declare no activation or one digest-bound activation", () => {
  const noActivation = createLibraryCoreReleaseActivation({
    range: RANGE,
    manifestInspection: EMPTY_MANIFEST_INSPECTION,
  });
  assert.deepEqual(
    validateLibraryCoreReleaseActivation({
      value: noActivation,
      expectedRange: RANGE,
      expectedManifestInspection: EMPTY_MANIFEST_INSPECTION,
    }),
    noActivation,
  );

  const transitions = [migrationTransition()];
  const manifestInspection = activationManifestInspection(transitions);
  const inspected = createLibraryCoreReleaseActivation({
    range: RANGE,
    manifestInspection,
  });
  const proposalArtifact = releaseArtifactFor(inspected);
  const proposalDigest = libraryCoreReleaseArtifactProposalDigest({
    artifact: proposalArtifact,
  });
  const approval = ownerApprovalFixture({
    inspected,
    transitions,
    releaseArtifact: proposalArtifact,
  });
  assert.equal(
    libraryCoreOwnerApprovalCommentBody({
      value: inspected,
      expectedRange: RANGE,
      expectedManifestInspection: manifestInspection,
      releaseArtifact: proposalArtifact,
      pullNumber: 1_205,
    }),
    approval.loadOwnerApprovalEvidence().comment.body,
  );
  const approved = createLibraryCoreReleaseActivation({
    range: RANGE,
    manifestInspection,
    decisionState: LIBRARY_CORE_ACTIVATION_DECISION_STATES.OWNER_APPROVED,
    ownerApprovalReference: approval.reference,
    approvedInspectionDigest: inspected.inspectionDigest,
    approvedReleaseArtifactDigest: proposalDigest,
    releaseArtifact: proposalArtifact,
    loadOwnerApprovalEvidence: approval.loadOwnerApprovalEvidence,
  });
  const approvedArtifact = releaseArtifactFor(approved);
  assert.deepEqual(
    validateLibraryCoreReleaseActivation({
      value: approved,
      expectedRange: RANGE,
      expectedManifestInspection: manifestInspection,
      releaseArtifact: approvedArtifact,
      loadOwnerApprovalEvidence: approval.loadOwnerApprovalEvidence,
    }),
    approved,
  );

  approved.transitions[0].rollbackTrigger =
    "A different rollback trigger after approval.";
  assert.throws(
    () =>
      validateLibraryCoreReleaseActivation({
        value: approved,
        expectedRange: RANGE,
        expectedManifestInspection: manifestInspection,
        releaseArtifact: approvedArtifact,
        loadOwnerApprovalEvidence: approval.loadOwnerApprovalEvidence,
      }),
    /manifest delta|inspection digest is invalid/,
  );
});

test("owner approval requires an authenticated GitHub owner comment", () => {
  const transitions = [migrationTransition()];
  const manifestInspection = activationManifestInspection(transitions);
  const inspected = createLibraryCoreReleaseActivation({
    range: RANGE,
    manifestInspection,
  });
  const proposalArtifact = releaseArtifactFor(inspected);
  const valid = ownerApprovalFixture({
    inspected,
    transitions,
    releaseArtifact: proposalArtifact,
  });
  const approvalInput = {
    range: RANGE,
    manifestInspection,
    decisionState: LIBRARY_CORE_ACTIVATION_DECISION_STATES.OWNER_APPROVED,
    approvedInspectionDigest: inspected.inspectionDigest,
    approvedReleaseArtifactDigest: libraryCoreReleaseArtifactProposalDigest({
      artifact: proposalArtifact,
    }),
    releaseArtifact: proposalArtifact,
  };

  assert.throws(
    () =>
      createLibraryCoreReleaseActivation({
        ...approvalInput,
        ownerApprovalReference: "owner-decision:library-core-gate-c-2026-07-28",
        loadOwnerApprovalEvidence: valid.loadOwnerApprovalEvidence,
      }),
    /must identify one canonical Freed GitHub pull request comment/,
  );
  assert.throws(
    () =>
      createLibraryCoreReleaseActivation({
        ...approvalInput,
        ownerApprovalReference: valid.reference,
        loadOwnerApprovalEvidence: () => {
          throw new Error("offline");
        },
      }),
    /approval evidence is unavailable: offline/,
  );

  for (const [label, fixture, pattern] of [
    [
      "commenter",
      ownerApprovalFixture({
        inspected,
        transitions,
        releaseArtifact: proposalArtifact,
        commentOverrides: { user: { login: "mallory", type: "User" } },
      }),
      /not an authenticated owner comment/,
    ],
    [
      "comment reference",
      ownerApprovalFixture({
        inspected,
        transitions,
        releaseArtifact: proposalArtifact,
        commentOverrides: {
          html_url:
            "https://github.com/freed-project/freed/pull/1205#issuecomment-9002",
        },
      }),
      /not an authenticated owner comment/,
    ],
    [
      "release lane",
      ownerApprovalFixture({
        inspected,
        transitions,
        releaseArtifact: proposalArtifact,
        pullOverrides: {
          base: {
            ref: "main",
            sha: "b".repeat(40),
            repo: { full_name: "freed-project/freed" },
          },
        },
      }),
      /not an authenticated owner comment/,
    ],
    [
      "missing base commit",
      ownerApprovalFixture({
        inspected,
        transitions,
        releaseArtifact: proposalArtifact,
        pullOverrides: {
          base: {
            ref: "dev",
            repo: { full_name: "freed-project/freed" },
          },
        },
      }),
      /not an authenticated owner comment/,
    ],
    [
      "malformed base commit",
      ownerApprovalFixture({
        inspected,
        transitions,
        releaseArtifact: proposalArtifact,
        pullOverrides: {
          base: {
            ref: "dev",
            sha: "not-a-commit",
            repo: { full_name: "freed-project/freed" },
          },
        },
      }),
      /not an authenticated owner comment/,
    ],
  ]) {
    assert.throws(
      () =>
        createLibraryCoreReleaseActivation({
          ...approvalInput,
          ownerApprovalReference: fixture.reference,
          loadOwnerApprovalEvidence: fixture.loadOwnerApprovalEvidence,
        }),
      pattern,
      label,
    );
  }
});

test("owner comment binds the exact inspection, product SHA, and transition set", () => {
  const transitions = [migrationTransition()];
  const manifestInspection = activationManifestInspection(transitions);
  const inspected = createLibraryCoreReleaseActivation({
    range: RANGE,
    manifestInspection,
  });
  const proposalArtifact = releaseArtifactFor(inspected);
  const approvalInput = {
    range: RANGE,
    manifestInspection,
    decisionState: LIBRARY_CORE_ACTIVATION_DECISION_STATES.OWNER_APPROVED,
    approvedInspectionDigest: inspected.inspectionDigest,
    approvedReleaseArtifactDigest: libraryCoreReleaseArtifactProposalDigest({
      artifact: proposalArtifact,
    }),
    releaseArtifact: proposalArtifact,
  };
  const invalidBindings = [
    ["inspection digest", { inspectionDigest: `sha256:${"0".repeat(64)}` }],
    ["product SHA", { productCommitSha: NEXT_PRODUCT_SHA }],
    ["transition set", { transitionSetDigest: `sha256:${"1".repeat(64)}` }],
  ];

  for (const [label, bindingOverrides] of invalidBindings) {
    const approval = ownerApprovalFixture({
      inspected,
      transitions,
      releaseArtifact: proposalArtifact,
      bindingOverrides,
    });
    assert.throws(
      () =>
        createLibraryCoreReleaseActivation({
          ...approvalInput,
          ownerApprovalReference: approval.reference,
          loadOwnerApprovalEvidence: approval.loadOwnerApprovalEvidence,
        }),
      /not bound to the exact inspection, product commit, and transition set/,
      label,
    );
  }
});

test("transition declarations use the closed gate and receipt contract", () => {
  const invalidCases = [
    ["wrong gate", migrationTransition({ gate: "D" }), /invalid for Gate D/],
    [
      "missing primary receipt",
      migrationTransition({
        receiptExpectations: ["same_frontier_rollback_receipt"],
      }),
      /requires migration_receipt/,
    ],
    [
      "missing recovery receipt",
      migrationTransition({ receiptExpectations: ["migration_receipt"] }),
      /same-frontier rollback or roll-forward recovery/,
    ],
    [
      "unknown receipt",
      migrationTransition({
        receiptExpectations: [
          "migration_receipt",
          "same_frontier_rollback_receipt",
          "unknown_receipt",
        ],
      }),
      /Unsupported Library Core receipt expectation/,
    ],
  ];

  for (const [label, transition, pattern] of invalidCases) {
    assert.throws(
      () =>
        inspectLibraryCoreActivationManifest({
          currentContents: manifestContents([transition]),
        }),
      pattern,
      label,
    );
  }
});

test("decision states cannot conceal or invent activation authority", () => {
  const transitionInspection = activationManifestInspection([
    migrationTransition(),
  ]);
  assert.throws(
    () =>
      createLibraryCoreReleaseActivation({
        range: RANGE,
        manifestInspection: transitionInspection,
        decisionState:
          LIBRARY_CORE_ACTIVATION_DECISION_STATES.NO_ACTIVATION_DECLARED,
      }),
    /no-activation decision cannot contain transition/,
  );
  assert.throws(
    () =>
      createLibraryCoreReleaseActivation({
        range: RANGE,
        manifestInspection: EMPTY_MANIFEST_INSPECTION,
        decisionState: LIBRARY_CORE_ACTIVATION_DECISION_STATES.OWNER_APPROVED,
        ownerApprovalReference: "owner-decision:empty",
      }),
    /requires a transition declaration/,
  );
  assert.throws(
    () =>
      createLibraryCoreReleaseActivation({
        range: RANGE,
        manifestInspection: transitionInspection,
        decisionState: LIBRARY_CORE_ACTIVATION_DECISION_STATES.OWNER_APPROVED,
        ownerApprovalReference: "owner-decision:missing-digest",
      }),
    /not bound to the current inspection digest/,
  );

  assert.equal(
    createLibraryCoreReleaseActivation({
      range: RANGE,
      manifestInspection: activationManifestInspection([
        migrationTransition({
          activationId: "migration-cutover-v1",
          gate: "F",
          kind: "migration_cutover",
        }),
      ]),
    }).transitions[0].kind,
    "migration_cutover",
  );
});

test("source-range drift invalidates an old decision and returns to review", () => {
  const manifestInspection = activationManifestInspection([
    migrationTransition(),
  ]);
  const reviewed = createLibraryCoreReleaseActivation({
    range: RANGE,
    manifestInspection,
  });
  const nextRange = {
    ...RANGE,
    toInclusiveProductCommitSha: NEXT_PRODUCT_SHA,
  };

  assert.throws(
    () =>
      validateLibraryCoreReleaseActivation({
        value: reviewed,
        expectedRange: nextRange,
        expectedManifestInspection: manifestInspection,
      }),
    /does not match the exact release range/,
  );
  assert.equal(
    prepareLibraryCoreReleaseActivation({
      range: nextRange,
      manifestInspection,
      existingValue: reviewed,
    }).decision.state,
    LIBRARY_CORE_ACTIVATION_DECISION_STATES.REVIEW_REQUIRED,
  );
});

test("manifest history derives activation declarations and cannot be rewritten", () => {
  const first = migrationTransition({ activationId: "activation-001" });
  const second = migrationTransition({
    activationId: "activation-002",
    gate: "F",
    kind: "migration_cutover",
  });
  const inspection = inspectLibraryCoreActivationManifest({
    previousContents: manifestContents([first]),
    currentContents: manifestContents([first, second]),
  });
  assert.deepEqual(inspection.transitions, [second]);
  assert.equal(inspection.manifest.previousPresent, true);
  assert.equal(
    inspectLibraryCoreActivationManifest({
      currentContents: manifestContents(),
    }).manifest.previousPresent,
    false,
  );

  assert.throws(
    () =>
      inspectLibraryCoreActivationManifest({
        previousContents: manifestContents([first]),
        currentContents: manifestContents([]),
      }),
    /cannot delete/,
  );
  assert.throws(
    () =>
      inspectLibraryCoreActivationManifest({
        previousContents: manifestContents([first]),
        currentContents: manifestContents([
          { ...first, rollbackTrigger: "Rewritten history." },
        ]),
      }),
    /cannot modify or reorder/,
  );
});

test("release declarations must equal the exact manifest delta", () => {
  const manifestInspection = activationManifestInspection([
    migrationTransition(),
  ]);
  const value = createLibraryCoreReleaseActivation({
    range: RANGE,
    manifestInspection,
  });
  const omitted = structuredClone(value);
  omitted.transitions = [];
  assert.throws(
    () =>
      validateLibraryCoreReleaseActivation({
        value: omitted,
        expectedRange: RANGE,
        expectedManifestInspection: manifestInspection,
        requireReviewed: false,
      }),
    /do not match the exact manifest delta/,
  );

  assert.throws(
    () =>
      validateLibraryCoreReleaseActivation({
        value,
        expectedRange: RANGE,
        expectedManifestInspection: {
          ...manifestInspection,
          manifest: {
            ...manifestInspection.manifest,
            currentDigest: `sha256:${"0".repeat(64)}`,
          },
        },
        requireReviewed: false,
      }),
    /manifest evidence does not match/,
  );
});

test("activation manifest parsing is closed, globally unique, and bounded", () => {
  assert.throws(
    () => inspectLibraryCoreActivationManifest({ currentContents: null }),
    /is missing/,
  );
  assert.throws(
    () =>
      inspectLibraryCoreActivationManifest({
        currentContents: "{not-json",
      }),
    /not valid JSON/,
  );
  assert.throws(
    () =>
      inspectLibraryCoreActivationManifest({
        currentContents: JSON.stringify({
          schemaVersion: 1,
          transitions: [],
          extra: true,
        }),
      }),
    /unsupported or missing fields/,
  );
  const duplicate = migrationTransition({ activationId: "duplicate" });
  assert.throws(
    () =>
      inspectLibraryCoreActivationManifest({
        currentContents: manifestContents([duplicate, duplicate]),
      }),
    /globally unique/,
  );
  assert.throws(
    () =>
      inspectLibraryCoreActivationManifest({
        currentContents: manifestContents(
          Array.from({ length: 65 }, (_, index) =>
            migrationTransition({
              activationId: `activation-${String(index).padStart(3, "0")}`,
            }),
          ),
        ),
      }),
    /at most 64/,
  );
});

test("release artifact approval projection ignores only the decision", () => {
  const manifestInspection = activationManifestInspection([
    migrationTransition(),
  ]);
  const inspected = createLibraryCoreReleaseActivation({
    range: RANGE,
    manifestInspection,
  });
  const artifact = releaseArtifactFor(inspected);
  const proposalDigest = libraryCoreReleaseArtifactProposalDigest({ artifact });
  const decisionChanged = structuredClone(artifact);
  decisionChanged.source.libraryCoreActivation.decision = {
    state: "owner_approved",
    ownerApprovalReference:
      "https://github.com/freed-project/freed/pull/1205#issuecomment-9001",
    approvedInspectionDigest: inspected.inspectionDigest,
    approvedReleaseArtifactDigest: proposalDigest,
  };
  assert.equal(
    libraryCoreReleaseArtifactProposalDigest({ artifact: decisionChanged }),
    proposalDigest,
  );

  const notesChanged = structuredClone(artifact);
  notesChanged.release.deck = "Changed after approval.";
  assert.notEqual(
    libraryCoreReleaseArtifactProposalDigest({ artifact: notesChanged }),
    proposalDigest,
  );

  const unapproved = structuredClone(artifact);
  unapproved.approved = false;
  assert.throws(
    () => libraryCoreReleaseArtifactProposalDigest({ artifact: unapproved }),
    /requires an approved release artifact/,
  );
});

test("owner approval rejects a changed PR-head artifact and closed unmerged pull", () => {
  const transitions = [migrationTransition()];
  const manifestInspection = activationManifestInspection(transitions);
  const inspected = createLibraryCoreReleaseActivation({
    range: RANGE,
    manifestInspection,
  });
  const proposalArtifact = releaseArtifactFor(inspected);
  const proposalDigest = libraryCoreReleaseArtifactProposalDigest({
    artifact: proposalArtifact,
  });
  const approvalInput = {
    range: RANGE,
    manifestInspection,
    decisionState: LIBRARY_CORE_ACTIVATION_DECISION_STATES.OWNER_APPROVED,
    approvedInspectionDigest: inspected.inspectionDigest,
    approvedReleaseArtifactDigest: proposalDigest,
    releaseArtifact: proposalArtifact,
  };

  const changedRemote = releaseArtifactFor(inspected);
  changedRemote.release.deck = "Different PR-head release copy.";
  const changedFixture = ownerApprovalFixture({
    inspected,
    transitions,
    releaseArtifact: changedRemote,
    approvalArtifact: proposalArtifact,
  });
  assert.throws(
    () =>
      createLibraryCoreReleaseActivation({
        ...approvalInput,
        ownerApprovalReference: changedFixture.reference,
        loadOwnerApprovalEvidence: changedFixture.loadOwnerApprovalEvidence,
      }),
    /exact pull request head/,
  );

  const closedFixture = ownerApprovalFixture({
    inspected,
    transitions,
    releaseArtifact: proposalArtifact,
    pullOverrides: { state: "closed", merged_at: null },
  });
  assert.throws(
    () =>
      createLibraryCoreReleaseActivation({
        ...approvalInput,
        ownerApprovalReference: closedFixture.reference,
        loadOwnerApprovalEvidence: closedFixture.loadOwnerApprovalEvidence,
      }),
    /not an authenticated owner comment/,
  );

  const mergedFixture = ownerApprovalFixture({
    inspected,
    transitions,
    releaseArtifact: proposalArtifact,
    pullOverrides: {
      state: "closed",
      merged_at: "2026-07-28T12:00:00Z",
    },
  });
  assert.doesNotThrow(() =>
    createLibraryCoreReleaseActivation({
      ...approvalInput,
      ownerApprovalReference: mergedFixture.reference,
      loadOwnerApprovalEvidence: mergedFixture.loadOwnerApprovalEvidence,
    }),
  );
});

test("owner approval rejects pull request movement during evidence loading", () => {
  const before = {
    number: 1_205,
    state: "open",
    merged_at: null,
    draft: true,
    base: {
      ref: "dev",
      sha: "c".repeat(40),
      repo: { full_name: "freed-project/freed" },
    },
    head: {
      sha: "a".repeat(40),
      repo: { full_name: "freed-project/freed" },
    },
  };
  assert.doesNotThrow(() =>
    assertStableOwnerApprovalPull({
      before,
      after: structuredClone(before),
    }),
  );

  for (const after of [
    { ...before, state: "closed" },
    { ...before, merged_at: "2026-07-28T12:00:00Z" },
    {
      ...before,
      base: { ref: "main", repo: { full_name: "freed-project/freed" } },
    },
    {
      ...before,
      base: {
        ...before.base,
        sha: "d".repeat(40),
      },
    },
    {
      ...before,
      head: {
        ...before.head,
        sha: "b".repeat(40),
      },
    },
  ]) {
    assert.throws(
      () => assertStableOwnerApprovalPull({ before, after }),
      /changed while its evidence was being read/,
    );
  }
});
