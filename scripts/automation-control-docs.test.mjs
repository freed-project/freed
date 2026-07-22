import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const controlPlaneDocs = readFileSync(
  new URL("../docs/AUTOMATION-CONTROL-PLANE.md", import.meta.url),
  "utf8",
);
const controlLibrary = readFileSync(
  new URL("lib/automation-control.mjs", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("documented lease mutations retain caller-owned operation identity and token", () => {
  const documentedMutations = [
    ...controlPlaneDocs.matchAll(
      /node scripts\/automation-control\.mjs lease (acquire|heartbeat|release)/g,
    ),
  ];
  const bashBlocks = [
    ...controlPlaneDocs.matchAll(/```bash\n([\s\S]*?)```/g),
  ].map((match) => match[1]);
  const mutationBlocks = bashBlocks.filter((block) =>
    /node scripts\/automation-control\.mjs lease (acquire|heartbeat|release)/.test(
      block,
    ),
  );

  assert.ok(documentedMutations.length > 0);
  assert.equal(
    mutationBlocks.reduce(
      (count, block) =>
        count +
        [
          ...block.matchAll(
            /node scripts\/automation-control\.mjs lease (acquire|heartbeat|release)/g,
          ),
        ].length,
      0,
    ),
    documentedMutations.length,
  );
  for (const block of mutationBlocks) {
    const mutationCount = [
      ...block.matchAll(
        /node scripts\/automation-control\.mjs lease (acquire|heartbeat|release)/g,
      ),
    ].length;
    const acquireCount = [
      ...block.matchAll(
        /node scripts\/automation-control\.mjs lease acquire/g,
      ),
    ].length;
    assert.equal(
      [...block.matchAll(/FREED_AUTOMATION_LEASE_OPERATION_ID=/g)].length,
      mutationCount,
    );
    assert.equal(
      [...block.matchAll(/FREED_AUTOMATION_LEASE_TOKEN=/g)].length,
      mutationCount,
    );
    assert.equal([...block.matchAll(/randomUUID\(\)/g)].length, mutationCount);
    assert.equal([...block.matchAll(/randomBytes\(32\)/g)].length, acquireCount);
  }

  assert.doesNotMatch(
    controlPlaneDocs,
    /command generates and returns only a short lease token/i,
  );
});

test("documented recovery commands remain bound to their production entry points", () => {
  assert.equal(
    packageJson.scripts["automation:cutover-kernel-guards"],
    "node scripts/automation-kernel-guard-cutover.mjs",
  );
  assert.equal(
    packageJson.scripts["automation:repair-outcome-ledger"],
    "node scripts/outcome-ledger-repair.mjs",
  );

  const documentedCommands = [
    {
      command: "automation:cutover-kernel-guards -- plan",
      requiredArguments: ['--task-id "$TASK_ID"', '--plan-file "$PLAN_FILE"'],
    },
    {
      command: "automation:cutover-kernel-guards -- apply",
      requiredArguments: [
        '--plan-file "$PLAN_FILE"',
        '--owner-confirmation-file "$CONFIRMATION_FILE"',
      ],
    },
    {
      command: "automation:cutover-kernel-guards -- plan-supersede",
      requiredArguments: [
        '--plan-file "$PLAN_FILE"',
        '--supersede-plan-file "$SUPERSEDE_PLAN_FILE"',
      ],
    },
    {
      command: "automation:cutover-kernel-guards -- supersede",
      requiredArguments: [
        '--plan-file "$PLAN_FILE"',
        '--supersede-plan-file "$SUPERSEDE_PLAN_FILE"',
        '--owner-confirmation-file "$SUPERSEDE_CONFIRMATION_FILE"',
      ],
    },
    {
      command: "automation:repair-outcome-ledger -- plan",
      requiredArguments: [
        '--task-id "$TASK_ID"',
        '--source-digest "$SOURCE_DIGEST"',
      ],
    },
    {
      command: "automation:repair-outcome-ledger -- repair",
      requiredArguments: [
        '--task-id "$TASK_ID"',
        '--source-digest "$SOURCE_DIGEST"',
      ],
    },
  ];
  const bashBlocks = [
    ...controlPlaneDocs.matchAll(/```bash\n([\s\S]*?)```/g),
  ].map((match) => match[1]);

  for (const { command, requiredArguments } of documentedCommands) {
    const matchingBlocks = bashBlocks.filter((block) =>
      block
        .split("\n")
        .includes(`npm run --silent ${command} \\`),
    );
    assert.equal(matchingBlocks.length, 1, command);
    for (const argument of requiredArguments) {
      assert.match(
        matchingBlocks[0],
        new RegExp(argument.replaceAll("$", "\\$")),
      );
    }
  }
});

test("documented actor runtime inventory retains the complete control closure", () => {
  for (const requiredRuntimeMember of [
    "repo Node binary",
    "control entry",
    "control library",
    "kernel guard contract",
    "outcome ledger repair contract",
    "lease\\s+archive helper",
  ]) {
    assert.match(controlPlaneDocs, new RegExp(requiredRuntimeMember));
  }
});

test("documented task and outcome authority matches live and replay admission", () => {
  assert.match(
    controlPlaneDocs,
    /Every task lifecycle event and every outcome audit event is authorized by the\s+lease that writes it\./,
  );
  assert.match(
    controlPlaneDocs,
    /at or after the authorizing\s+lease's `acquiredAt` timestamp and strictly before that lease's `expiresAt`\s+timestamp/,
  );
  assert.match(controlPlaneDocs, /`lease_event_time_invalid`/);
  assert.match(
    controlPlaneDocs,
    /Current mutation admission also rejects a not-yet-active lease when the current\s+time is before `acquiredAt`, and an expired lease when the current time is at or\s+after `expiresAt`\./,
  );
  assert.match(
    controlPlaneDocs,
    /Continuous history then replays exact, unique, canonical heartbeat\s+events in physical order\./,
  );
  assert.match(
    controlPlaneDocs,
    /Each heartbeat must occur before the current effective\s+expiry and may extend authority only up to the actor's absolute lease lifetime\s+and any owner-confirmation expiry\./,
  );
  assert.match(controlPlaneDocs, /Publisher acquisition is exactly 30 minutes\./);
  assert.match(
    controlPlaneDocs,
    /The complete history fixture\s+is the compatibility proof\./,
  );
  assert.match(
    controlPlaneDocs,
    /One byte-frozen pre-hardening transition\s+is the sole pre-acquisition actor-credential compatibility\./,
  );
  assert.match(
    controlPlaneDocs,
    /its unique deterministic\s+outcome event, and exactly one matching authenticated ledger row/,
  );
  assert.match(
    controlPlaneDocs,
    /A missing,\s+duplicate, UUID-substituted, or byte-drifted bundle part fails closed\./,
  );
  assert.doesNotMatch(
    controlPlaneDocs,
    /compatibility is limited to the historical outcome-transition shape/,
  );
  assert.match(
    controlPlaneDocs,
    /Continuous outcome health independently scans every completed receipt still\s+retained under `leases\/\.transaction-receipts\/`\./,
  );
  assert.match(
    controlPlaneDocs,
    /requires exactly one byte-equivalent control\s+event for the receipt's deterministic event ID\./,
  );
  assert.match(
    controlPlaneDocs,
    /Current `task_created` events carry one explicit boolean `behavioral` field/,
  );
  assert.match(
    controlPlaneDocs,
    /requires the exact task ID set in history\s+to equal the exact task ID set in the manifest/,
  );
  assert.match(
    controlPlaneDocs,
    /changing only the manifest classification fails closed/,
  );
  assert.match(controlPlaneDocs, /`lease_repair_required`/);
  assert.match(
    controlPlaneDocs,
    /before reading an external credential/,
  );
  assert.doesNotMatch(controlPlaneDocs, /orphan grace period/);
  assert.match(
    controlPlaneDocs,
    /complete canonical redacted request object and\s+its SHA-256 digest/,
  );
  assert.match(
    controlPlaneDocs,
    /Every retained phase for one operation must carry the identical canonical\s+request object/,
  );
  assert.match(
    controlPlaneDocs,
    /completed receipt must have the exact canonical bytes/,
  );
});

test("documented cutover retirement is retained and uses pinned durable moves", () => {
  assert.equal(
    controlPlaneDocs.includes(
      "`<stateRoot>/control/.kernel-guard-cutover-retired/<cutoverId>/...`",
    ),
    true,
  );
  assert.match(
    controlPlaneDocs,
    /They remain\s+retained and are never deleted by successful execution or recovery\./,
  );
  for (const operation of [
    "rename-durable",
    "exchange-durable",
    "retire-directory-durable",
    "list-bounded",
  ]) {
    assert.equal(controlPlaneDocs.includes("`" + operation + "`"), true);
  }
  assert.doesNotMatch(
    controlPlaneDocs,
    /private quarantine,[\s\S]{0,160}remove it/,
  );
});

test("documented generic authority publication preserves exact generations", () => {
  assert.match(controlPlaneDocs, /`freed-authority-file-operation-v1`/);
  for (const operation of [
    "authority-entry-inventory",
    "authority-retirement-inventory",
    "authority-stage-create",
    "authority-stage-rewrite",
    "authority-exchange",
    "authority-retire",
  ]) {
    assert.equal(controlPlaneDocs.includes("`" + operation + "`"), true);
  }
  assert.match(
    controlPlaneDocs,
    /Targeted reads use `authority-entry-inventory` through the held\s+parent descriptor before and after the exact byte read/,
  );
  assert.match(
    controlPlaneDocs,
    /Bulk retirement admission uses\s+`authority-retirement-inventory` through the held retirement-directory\s+descriptor and requires two stable sorted scans/,
  );
  assert.match(
    controlPlaneDocs,
    /`\.<basename>\.authority\.<namespaceDigest>\.staging`/,
  );
  assert.match(
    controlPlaneDocs,
    /`\.<basename>\.authority\.<namespaceDigest>\.<successorStableDigest>\.tmp`/,
  );
  assert.match(
    controlPlaneDocs,
    /an atomic swap that leaves the\s+exact predecessor at that ready name while the proposed generation becomes\s+canonical/,
  );
  assert.match(
    controlPlaneDocs,
    /version 3 staging namespace binds the canonical path, caller-owned\s+operation ID, proposed content digest, full predecessor generation, and\s+admitted parent generation/,
  );
  assert.match(
    controlPlaneDocs,
    /full predecessor identity contains device,\s+inode, mode, link\s+count, user ID, group ID, size, modification time, change\s+time, and SHA-256 content digest/,
  );
  assert.match(
    controlPlaneDocs,
    /parent identity contains device, inode,\s+mode, and user ID/,
  );
  assert.match(
    controlPlaneDocs,
    /ready name adds a stable successor digest containing\s+device, inode, mode, link count, user ID, group ID, size, modification time,\s+and content digest\. It intentionally excludes change time/,
  );
  assert.match(
    controlPlaneDocs,
    /Content\s+equality alone never authorizes recovery\./,
  );
  assert.match(
    controlPlaneDocs,
    /same-content file on a\s+different\s+inode is a foreign generation and fails closed/,
  );
  assert.match(
    controlPlaneDocs,
    /create-only rename consumes its only ready-name inode witness\. A new process\s+therefore never infers create-only success from canonical bytes alone/,
  );
  assert.match(
    controlPlaneDocs,
    /higher-level write-ahead transaction or deterministic event recovery must\s+reconcile that completed create/,
  );
  assert.match(
    controlPlaneDocs,
    /moves only the exact held source generation with an\s+exclusive native rename, never an unlink or an overwrite/,
  );
  assert.match(controlPlaneDocs, /`.authority-retirements\/` directory/);
  for (const bound of [
    "100,000 entries",
    "4,294,967,296 total bytes",
    "1,073,741,824 free bytes",
  ]) {
    assert.equal(controlPlaneDocs.includes(bound), true);
  }
  assert.match(
    controlPlaneDocs,
    /retry first proves an\s+already completed exact retirement and returns it without requiring new\s+capacity or filesystem headroom/,
  );
  assert.match(
    controlPlaneDocs,
    /source is missing and no retirement\s+directory already exists, recovery fails closed without creating that\s+directory/,
  );
  assert.match(
    controlPlaneDocs,
    /retained history is deliberately bounded, not infinitely\s+live/,
  );
  assert.match(
    controlPlaneDocs,
    /one crash-stranded pre-WAL stage per\s+canonical transaction name/,
  );
  assert.match(
    controlPlaneDocs,
    /complete, digest-matching, schema-valid stage is\s+promoted to the canonical write-ahead record/,
  );
  assert.match(
    controlPlaneDocs,
    /partial, malformed, or otherwise unprovable stage is preserved by\s+exact-generation retirement/,
  );
  assert.match(
    controlPlaneDocs,
    /must not call the helper's legacy `replace-durable` or\s+`remove-durable` operations/,
  );
  assert.match(
    controlPlaneDocs,
    /`writeJsonAtomic` receives an admitted expected snapshot, it performs no\s+directory creation or permission repair before proving that exact snapshot/,
  );
  assert.match(
    controlPlaneDocs,
    /does not claim to defend against a separate, continuously hostile\s+process running as the same user/,
  );

  for (const sourceBound of [
    "const AUTHORITY_STAGE_DIRECTORY_MAX_ENTRIES = 100_000;",
    "const AUTHORITY_RETIREMENT_MAX_ENTRIES = 100_000;",
    "const LEASE_ARCHIVE_MAX_BYTES = 4 * 1024 * 1024 * 1024;",
    "const LEASE_ARCHIVE_MIN_FREE_BYTES = 1024 * 1024 * 1024;",
  ]) {
    assert.equal(controlLibrary.includes(sourceBound), true);
  }
  const closureStart = controlLibrary.indexOf(
    "function parseAutomationAuthorityReceipt(",
  );
  const closureEnd = controlLibrary.indexOf(
    "function readPinnedLeaseArchivePath(",
    closureStart,
  );
  assert.notEqual(closureStart, -1);
  assert.ok(closureEnd > closureStart);
  const writerClosure = controlLibrary.slice(closureStart, closureEnd);
  assert.doesNotMatch(writerClosure, /["']replace-durable["']/);
  assert.doesNotMatch(writerClosure, /["']remove-durable["']/);
});
