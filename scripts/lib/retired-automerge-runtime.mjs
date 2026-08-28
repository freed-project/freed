import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const RETIRED_LIBRARY_CORE_PUBLIC_MODULES = Object.freeze([
  "census",
  "field-registry",
  "feed-item-merge-idempotency",
  "local-authority-registry",
  "operation-field-algebra-contracts",
  "operation-materializer-contracts",
  "operation-registry",
  "operation-touched-fields",
  "protocol-registry",
  "query-registry",
  "store-surface-registry",
]);

const RETIRED_ASSET_NAME_PATTERNS = Object.freeze([
  {
    id: "automerge-asset",
    pattern: /automerge/i,
  },
  {
    id: "cloud-merge-asset",
    pattern: /cloud[-_.]?merge/i,
  },
]);

const RETIRED_MODULE_PATH_PATTERNS = Object.freeze([
  {
    id: "automerge-package-module",
    pattern: /\/node_modules\/@automerge\//i,
  },
  {
    id: "automerge-renderer-module",
    pattern: /\/src\/lib\/(?:legacy-)?automerge(?:[.-]|$)/i,
  },
  {
    id: "automerge-persistence-module",
    pattern: /\/src\/storage\/repeatable-automerge-persistence(?:[.-]|$)/i,
  },
  {
    id: "cloud-merge-module",
    pattern: /\/src\/lib\/(?:retired-legacy-)?cloud-merge(?:[.-]|$)/i,
  },
  {
    id: "legacy-cloud-sync-module",
    pattern: /\/src\/lib\/(?:retired-)?legacy-cloud-sync-entry(?:[.-]|$)/i,
  },
  {
    id: "legacy-relay-module",
    pattern: /\/src\/network\/local-relay(?:[.-]|$)/i,
  },
  {
    id: "pwa-indexeddb-library-module",
    pattern:
      /\/src\/lib\/library-core-(?:indexeddb(?:-readers)?|intent-overlay|portable-checkpoint-store|search-index)(?:[.-]|$)/i,
  },
]);

const RETIRED_ARTIFACT_TOKENS = Object.freeze([
  {
    id: "pwa-legacy-sync-cache",
    needle: "freed-sync-v1",
  },
  {
    id: "pwa-automerge-worker-debug",
    needle: "freed:pwa:automerge-worker-debug:v1",
  },
  {
    id: "automerge-worker-module",
    needle: "automerge.worker",
  },
  {
    id: "cloud-merge-worker-module",
    needle: "cloud-merge.worker",
  },
  {
    id: "legacy-cloud-sync-entry",
    needle: "legacy-cloud-sync-entry",
  },
  {
    id: "repeatable-automerge-persistence",
    needle: "repeatable-automerge-persistence",
  },
  {
    id: "automerge-wasm-runtime",
    needle: "automerge_wasm_bg",
  },
  {
    id: "retired-library-core-census",
    needle: "actor_and_global_authority_contracts_unimplemented",
  },
  {
    id: "retired-library-core-field-registry",
    needle: "legacy-automerge-document",
  },
  {
    id: "retired-library-core-local-authority-registry",
    needle: "automerge-cloud-google-drive",
  },
  {
    id: "retired-library-core-query-registry",
    needle: "desktop_and_pwa_automerge_workers",
  },
  {
    id: "retired-library-core-store-registry",
    needle:
      "current method writes legacy Automerge and its successor payload is unresolved",
  },
  {
    id: "retired-library-core-operation-registry",
    needle: "runtime_authority_inactive",
  },
  {
    id: "retired-library-shell-record",
    needle: "00_library_shell",
  },
  {
    id: "retired-library-shell-json",
    needle: "shellJson",
  },
  {
    id: "retired-library-shell-type",
    needle: "DesktopLibraryShell",
  },
  {
    id: "retired-library-document-state",
    needle: "DocState",
  },
  {
    id: "pwa-indexeddb-checkpoint-database",
    needle: "freed-library-core-portable-v1",
  },
  {
    id: "pwa-indexeddb-search-database",
    needle: "freed-library-core-search-v1",
  },
  {
    id: "pwa-indexeddb-read-model-database",
    needle: "freed-library-core-read-model-v1",
  },
]);

const RETIRED_ARTIFACT_PATTERNS = Object.freeze([
  {
    id: "pwa-legacy-sync-route",
    pattern:
      /(?:["']\/sync["']\s*===\s*[A-Za-z_$][\w$]*\.pathname|[A-Za-z_$][\w$]*\.pathname\s*===\s*["']\/sync["'])/,
  },
]);

function normalizePath(filePath) {
  return filePath.replace(/\\/g, "/");
}

function artifactText(value) {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return "";
}

function assetNameFindings(fileName, surface) {
  const normalized = normalizePath(fileName);
  const findings = [];
  for (const rule of RETIRED_ASSET_NAME_PATTERNS) {
    if (rule.pattern.test(normalized)) {
      findings.push({
        id: rule.id,
        location: normalized,
      });
    }
  }
  if (surface === "desktop" && normalized.toLowerCase().endsWith(".wasm")) {
    findings.push({
      id: "desktop-wasm-asset",
      location: normalized,
    });
  }
  return findings;
}

function contentFindings(content, location, surface) {
  const findings = [];
  for (const rule of RETIRED_ARTIFACT_TOKENS) {
    if (content.includes(rule.needle)) {
      findings.push({
        id: rule.id,
        location,
      });
    }
  }
  for (const rule of RETIRED_ARTIFACT_PATTERNS) {
    if (rule.pattern.test(content)) {
      findings.push({
        id: rule.id,
        location,
      });
    }
  }
  if (
    surface === "pwa" &&
    path.posix.basename(normalizePath(location)) === "sw.js" &&
    /["']\/sync["']/.test(content)
  ) {
    findings.push({
      id: "pwa-legacy-sync-service-worker-path",
      location,
    });
  }
  return findings;
}

function moduleFindings(moduleIds, location) {
  const findings = [];
  for (const moduleId of moduleIds) {
    const normalized = normalizePath(moduleId);
    for (const rule of RETIRED_MODULE_PATH_PATTERNS) {
      if (rule.pattern.test(normalized)) {
        findings.push({
          id: rule.id,
          location: `${location} <- ${normalized}`,
        });
      }
    }
  }
  return findings;
}

function formatFindings(surface, findings) {
  const lines = findings
    .map((finding) => `${finding.id}: ${finding.location}`)
    .sort();
  return [
    `The ${surface} release bundle contains retired Library runtime residue:`,
    ...lines.map((line) => `  ${line}`),
  ].join("\n");
}

export function assertNoRetiredAutomergeRollupBundle(bundle, surface) {
  const findings = [];
  for (const [fileName, output] of Object.entries(bundle ?? {})) {
    findings.push(...assetNameFindings(fileName, surface));
    if (output && typeof output === "object") {
      const content =
        "code" in output
          ? artifactText(output.code)
          : "source" in output
            ? artifactText(output.source)
            : "";
      findings.push(
        ...contentFindings(content, normalizePath(fileName), surface),
      );
      const modules =
        "modules" in output &&
        output.modules &&
        typeof output.modules === "object"
          ? Object.keys(output.modules)
          : [];
      findings.push(...moduleFindings(modules, normalizePath(fileName)));
    }
  }
  if (findings.length > 0) {
    throw new Error(formatFindings(surface, findings));
  }
}

function walkArtifactFiles(rootDirectory) {
  const files = [];
  const visit = (absoluteDirectory, relativeDirectory) => {
    for (const entry of readdirSync(absoluteDirectory, {
      withFileTypes: true,
    }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(absoluteDirectory, entry.name);
      const relativePath = normalizePath(
        path.join(relativeDirectory, entry.name),
      );
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new Error(
          `Release artifact inspection rejects symbolic link ${relativePath}.`,
        );
      }
      if (stat.isDirectory()) {
        visit(absolutePath, relativePath);
      } else if (stat.isFile()) {
        files.push({
          absolutePath,
          relativePath,
          size: stat.size,
        });
      }
    }
  };
  visit(rootDirectory, "");
  return files;
}

export function assertNoRetiredAutomergeArtifactDirectory(
  rootDirectory,
  surface,
) {
  const findings = [];
  const files = walkArtifactFiles(rootDirectory);
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.size;
    findings.push(...assetNameFindings(file.relativePath, surface));
    const content = readFileSync(file.absolutePath).toString("utf8");
    findings.push(...contentFindings(content, file.relativePath, surface));
  }
  if (findings.length > 0) {
    throw new Error(formatFindings(surface, findings));
  }
  return Object.freeze({
    files: files.length,
    bytes: totalBytes,
  });
}

export function assertNoRetiredLibraryCorePublicExports(repoRoot) {
  const entrypointPath = path.join(
    repoRoot,
    "packages",
    "shared",
    "src",
    "library-core",
    "index.ts",
  );
  const source = readFileSync(entrypointPath, "utf8");
  const retired = RETIRED_LIBRARY_CORE_PUBLIC_MODULES.filter((moduleName) => {
    const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const publicExport = new RegExp(
      `export\\s+(?:type\\s+)?(?:\\*|\\{[\\s\\S]*?\\})\\s+from\\s+["']\\./${escaped}(?:\\.js)?["']`,
    );
    return publicExport.test(source);
  });
  if (retired.length > 0) {
    throw new Error(
      `The Library Core public entrypoint reexports retired registry modules: ${retired.join(", ")}.`,
    );
  }
}
