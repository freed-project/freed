#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { constants, closeSync, fstatSync, openSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { libraryCoreOwnerApprovalIntent } from './lib/library-core-release-activation.mjs';

// This is cooperative transcript evidence, never owner authentication or runtime authority.
export function prepareStandingDevConfirmation({ artifact, authority, taskReference, readSource, nowMs = Date.now() }) {
  const approval = libraryCoreOwnerApprovalIntent({ artifact });
  const scope = authority?.scope;
  if (authority?.schemaVersion !== 1 || authority.kind !== 'standing-dev-release-authority' ||
      authority.approvedBy !== 'AubreyF' || authority.status !== 'active' || authority.revokedAt != null ||
      !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(authority.grantId ?? '') ||
      typeof authority.ownerApprovalReference !== 'string' || !authority.ownerApprovalReference.trim() ||
      typeof authority.transcriptReference !== 'string' || !authority.transcriptReference.trim() ||
      !Number.isFinite(Date.parse(authority.grantedAt)) || Date.parse(authority.grantedAt) > nowMs ||
      (authority.expiresAt != null && (!Number.isFinite(Date.parse(authority.expiresAt)) || Date.parse(authority.expiresAt) <= nowMs)) ||
      typeof taskReference !== 'string' || !taskReference.trim()) {
    throw new Error('Standing dev authority is missing provenance, revoked, expired or invalid.');
  }
  if (artifact.channel !== 'dev' || artifact.source?.channel !== 'dev' ||
      scope?.channel !== 'dev' || scope.production !== false || scope.primaryMigration !== false ||
      scope.expandedAccess !== false || scope.providerBehavior !== 'existing-approved-only' ||
      scope.activationPolicy !== 'disabled-only') {
    throw new Error('Standing authority covers dev publication only, with no activation, migration, expanded access or new provider behavior.');
  }
  const parameters = approval.intent.parameters;
  if (scope.reviewedManifestDigest !== parameters.manifestCurrentDigest ||
      scope.reviewedTransitionSetDigest !== parameters.transitionSetDigest) {
    throw new Error('Library activation scope changed; standing dev publication authority cannot approve it.');
  }
  // Inspect immutable product sources, never the caller's working-tree configuration.
  const sourceSha = parameters.productCommitSha;
  const cargo = readSource(sourceSha, 'packages/desktop/src-tauri/Cargo.toml');
  const defaults = /^default\s*=\s*\[([^\]]*)\]/m.exec(cargo)?.[1];
  const releaseWorkflow = readSource(sourceSha, '.github/workflows/release.yml');
  if (defaults == null || defaults.includes('library-transfer-acceptance') || releaseWorkflow.includes('library-transfer-acceptance')) {
    throw new Error('Ordinary native release must keep Library transfer acceptance disabled.');
  }
  for (const file of ['packages/desktop/vite.config.ts', 'packages/pwa/vite.config.ts']) {
    const vite = readSource(sourceSha, file);
    if (!/__LIBRARY_TRANSFER_ACCEPTANCE__:\s*mode === "library-transfer-acceptance" \|\| mode === "test"/.test(vite)) {
      throw new Error('Ordinary frontend release must keep Library transfer acceptance disabled.');
    }
  }
  const grantDigest = createHash('sha256').update(JSON.stringify(authority)).digest('hex');
  const expiresAt = Math.min(nowMs + 24 * 60 * 60 * 1000, authority.expiresAt == null ? Infinity : Date.parse(authority.expiresAt));
  return {
    schemaVersion: 1,
    kind: 'owner-confirmation',
    confirmationId: `${approval.taskId}-${sourceSha.slice(0, 8)}`,
    approvedBy: 'AubreyF',
    ownerApprovalReference: `Standing dev authority ${authority.grantId}, sha256:${grantDigest}. ${authority.transcriptReference}: ${authority.ownerApprovalReference} Applied to this exact dev publication after scope review; no runtime Library activation or primary migration.`,
    approvalSource: { kind: 'current-task', reference: `${taskReference}; standing grant ${authority.transcriptReference}` },
    taskId: approval.taskId,
    intent: approval.intent,
    intentDigest: approval.intentDigest,
    // Receipt issuance time; original human grant time stays in retained provenance.
    approvedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function readPrivateAuthority(file, cwd) {
  if (!path.isAbsolute(file) || realpathSync(file) !== file || file.startsWith(`${realpathSync(cwd)}${path.sep}`)) {
    throw new Error('Standing authority must be one physical private file outside the repository.');
  }
  const directory = statSync(path.dirname(file));
  if ((directory.mode & 0o777) !== 0o700 || directory.uid !== process.getuid()) throw new Error('Standing authority directory must be owner-only mode 0700.');
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600 || stat.size > 65536) throw new Error('Standing authority must be a bounded owner-only mode 0600 regular file.');
    return JSON.parse(readFileSync(fd, 'utf8'));
  } finally { closeSync(fd); }
}

export function main(argv = process.argv.slice(2)) {
  const options = {};
  for (const arg of argv) {
    const match = /^--(artifact|authority-file|output|task-reference|cwd)=(.+)$/.exec(arg);
    if (!match || options[match[1]]) throw new Error('Use --artifact, --authority-file, --output and --task-reference, with optional --cwd.');
    options[match[1]] = match[2];
  }
  const cwd = path.resolve(options.cwd ?? process.cwd());
  if (!options.artifact || !options['authority-file'] || !options.output || !options['task-reference']) throw new Error('Artifact, private authority, private output and active task reference are required.');
  if (!/^release-notes\/releases\/v\d+\.\d+\.\d+-dev\.json$/.test(options.artifact)) throw new Error('Only canonical dev release artifacts are supported.');
  const output = options.output;
  if (!path.isAbsolute(output) || realpathSync(path.dirname(output)) !== path.dirname(output) || output.startsWith(`${realpathSync(cwd)}${path.sep}`) || (statSync(path.dirname(output)).mode & 0o777) !== 0o700) throw new Error('Output must be outside the repository in a physical mode 0700 directory.');
  const authority = readPrivateAuthority(options['authority-file'], cwd);
  const artifact = JSON.parse(readFileSync(path.join(cwd, options.artifact), 'utf8'));
  const confirmation = prepareStandingDevConfirmation({ artifact, authority, taskReference: options['task-reference'], readSource: (sha, file) => execFileSync('git', ['show', `${sha}:${file}`], { cwd, encoding: 'utf8' }) });
  writeFileSync(output, `${JSON.stringify(confirmation, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`Prepared exact-source dev confirmation for ${artifact.tag}; record it with library-core-release-activation.mjs record-owner-approval.\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
