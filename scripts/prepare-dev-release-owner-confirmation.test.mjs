import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareStandingDevConfirmation, readPrivateAuthority } from './prepare-dev-release-owner-confirmation.mjs';
import { createLibraryCoreReleaseActivation, inspectLibraryCoreActivationManifest, libraryCoreOwnerApprovalIntent } from './lib/library-core-release-activation.mjs';
import { releaseInspectionRange } from './release-receipt.mjs';
import { validateCurrentTaskOwnerConfirmation } from './lib/automation-control.mjs';

const nowMs = Date.parse('2026-10-02T22:00:00Z');
function fixture(sha = 'a'.repeat(40)) {
  const activation = createLibraryCoreReleaseActivation({range:releaseInspectionRange({channel:'dev',productCommitSha:sha}),manifestInspection:inspectLibraryCoreActivationManifest({currentContents:JSON.stringify({schemaVersion:1,transitions:[{activationId:'disabled-transfer-v1',gate:'F',kind:'authority_key_rotation',rollbackTrigger:'Refuse unsafe transition.',receiptExpectations:['authority_rotation_receipt','roll_forward_recovery_receipt']}]})})});
  const artifact = {tag:'v26.10.200-dev',version:'26.10.200-dev',dayKey:'26.10.2',approved:true,channel:'dev',source:{channel:'dev',productCommitSha:sha,libraryCoreActivation:activation},release:{deck:'Test',features:[],fixes:[],followUps:[]}};
  const intent = libraryCoreOwnerApprovalIntent({artifact}).intent;
  const authority = {schemaVersion:1,kind:'standing-dev-release-authority',grantId:'dev-iteration',approvedBy:'AubreyF',status:'active',revokedAt:null,grantedAt:'2026-10-02T21:46:21Z',expiresAt:null,transcriptReference:'Synthetic owner message 1',ownerApprovalReference:'Iterate and ship dev builds within this scope.',scope:{channel:'dev',production:false,primaryMigration:false,expandedAccess:false,providerBehavior:'existing-approved-only',activationPolicy:'disabled-only',reviewedManifestDigest:intent.parameters.manifestCurrentDigest,reviewedTransitionSetDigest:intent.parameters.transitionSetDigest}};
  const sources = {'packages/desktop/src-tauri/Cargo.toml':'[features]\ndefault = ["custom-protocol"]','packages/desktop/vite.config.ts':'__LIBRARY_TRANSFER_ACCEPTANCE__: mode === "library-transfer-acceptance" || mode === "test"','packages/pwa/vite.config.ts':'__LIBRARY_TRANSFER_ACCEPTANCE__: mode === "library-transfer-acceptance" || mode === "test"','.github/workflows/release.yml':'ordinary release'};
  return {artifact,authority,taskReference:'synthetic-task',nowMs,readSource:(_,file)=>sources[file],sources};
}

test('standing grant issues fresh exact receipts across source SHAs, retaining human provenance', () => {
  const first = prepareStandingDevConfirmation(fixture());
  const second = prepareStandingDevConfirmation(fixture('b'.repeat(40)));
  assert.notEqual(first.intentDigest,second.intentDigest);
  assert.equal(second.intent.parameters.productCommitSha,'b'.repeat(40));
  assert.match(second.ownerApprovalReference,/Synthetic owner message 1/);
  assert.match(second.ownerApprovalReference,/no runtime Library activation or primary migration/);
  assert.equal(second.expiresAt,'2026-10-03T22:00:00.000Z');
});
test('production, expanded access, migration and new provider authority remain outside grant', () => {
  for (const [key,value] of [['channel','production'],['production',true],['primaryMigration',true],['expandedAccess',true],['providerBehavior','new-behavior'],['activationPolicy','enabled']]) {
    const f=fixture(); f.authority.scope[key]=value;
    assert.throws(()=>prepareStandingDevConfirmation(f),/dev publication only/);
  }
});
test('changed activation digests, revocation, expiration and missing transcript fail closed', () => {
  for (const mutate of [f=>f.authority.scope.reviewedManifestDigest='sha256:'+'f'.repeat(64),f=>f.authority.scope.reviewedTransitionSetDigest='sha256:'+'f'.repeat(64),f=>f.authority.revokedAt='2026-10-02T21:50:00Z',f=>f.authority.expiresAt='2026-10-02T21:50:00Z',f=>f.authority.transcriptReference='']) {
    const f=fixture();mutate(f);assert.throws(()=>prepareStandingDevConfirmation(f));
  }
});
test('ordinary release acceptance enabling or unknown frontend configuration is refused', () => {
  for (const [file,content] of [['packages/desktop/src-tauri/Cargo.toml','default = ["library-transfer-acceptance"]'],['.github/workflows/release.yml','args: --features library-transfer-acceptance'],['packages/pwa/vite.config.ts','__LIBRARY_TRANSFER_ACCEPTANCE__: true'],['packages/desktop/vite.config.ts','unknown']]) {
    const f=fixture();f.sources[file]=content;assert.throws(()=>prepareStandingDevConfirmation(f),/acceptance disabled/);
  }
});
test('issued evidence passes existing canonical confirmation validation and stays private', t => {
  const directory=realpathSync(mkdtempSync(path.join(tmpdir(),'freed-standing-dev-')));chmodSync(directory,0o700);t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const f=fixture();const file=path.join(directory,'confirmation.json');writeFileSync(file,JSON.stringify(prepareStandingDevConfirmation(f)),{mode:0o600});
  const approval=libraryCoreOwnerApprovalIntent({artifact:f.artifact});
  assert.equal(validateCurrentTaskOwnerConfirmation({confirmationFile:file,taskId:approval.taskId,intentDigest:approval.intentDigest,nowMs}).confirmation.intentDigest,approval.intentDigest);
  const grantFile=path.join(directory,'grant.json');writeFileSync(grantFile,JSON.stringify(f.authority),{mode:0o600});assert.equal(readPrivateAuthority(grantFile,process.cwd()).grantId,'dev-iteration');chmodSync(grantFile,0o644);assert.throws(()=>readPrivateAuthority(grantFile,process.cwd()),/0600/);
});
