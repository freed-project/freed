#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function measurementIdentity({ runId, attempt, sourceSha }) {
  if (
    !/^[1-9][0-9]{0,19}$(?![\s\S])/.test(String(runId)) ||
    !/^[1-9][0-9]{0,8}$(?![\s\S])/.test(String(attempt)) ||
    !/^[0-9a-f]{40}$(?![\s\S])/.test(sourceSha ?? "")
  ) {
    throw new Error(
      "Measurement requires an exact source and original run identity.",
    );
  }
  const identifier = `wtf.freed.desktop.preview.measurement.r${runId}.a${attempt}`;
  return {
    identifier,
    sourceSha,
    runId: String(runId),
    attempt: String(attempt),
    profileIdentifier: identifier,
    jevService: `wtf.freed.ai.isolated-preview.${identifier}`,
    libraryKeyService: `wtf.freed.library-core.sqlite-native-preview.${identifier}`,
    legalAcceptance: "required; never seeded by packaging",
    transferAcceptanceEnabled: false,
  };
}

export function measurementConfig(identity, preview) {
  const expected = measurementIdentity(identity);
  if (identity.identifier !== expected.identifier)
    throw new Error("Inconsistent measurement identity.");
  if (
    preview.identifier !== "wtf.freed.desktop.sqlite-native-preview" ||
    preview.productName !== "Freed Preview" ||
    preview.bundle?.createUpdaterArtifacts !== false
  ) {
    throw new Error("Unexpected existing isolated preview configuration.");
  }
  return {
    ...preview,
    identifier: identity.identifier,
    plugins: { ...preview.plugins, updater: { endpoints: [] } },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  if (!output || /[\r\n]/.test(output) || !path.isAbsolute(output))
    throw new Error("Absolute config output required.");
  if (!process.env.GITHUB_OUTPUT)
    throw new Error("Actions output path required.");
  const identity = measurementIdentity({
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    sourceSha: process.env.GITHUB_SHA,
  });
  const preview = JSON.parse(
    readFileSync(
      new URL(
        "../packages/desktop/src-tauri/tauri.preview.conf.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  writeFileSync(
    output,
    `${JSON.stringify(measurementConfig(identity, preview), null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  writeFileSync(
    process.env.GITHUB_OUTPUT,
    `identifier=${identity.identifier}\nconfig_path=${output}\n`,
    { flag: "a" },
  );
}
