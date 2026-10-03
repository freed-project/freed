import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {validateRequest,validateController} from "./cloud-release-request.mjs";
const request={channel:"dev",tag:"v26.10.200-dev",source_sha:"a".repeat(40),receipt_sha256:"b".repeat(64)};
const policy=()=>({repository:"freed-project/freed",ref:"refs/heads/release-controller",sha:"a".repeat(40),approvedSha:"a".repeat(40),environment:{deployment_branch_policy:{custom_branch_policies:true,protected_branches:false}},policies:[{name:"release-controller",type:"branch"}],rulesets:[{target:"branch",enforcement:"active",bypass_actors:[],conditions:{ref_name:{include:["refs/heads/release-controller"],exclude:[]}},rules:[{type:"pull_request",parameters:{required_approving_review_count:1,require_code_owner_review:true,dismiss_stale_reviews_on_push:true,require_last_push_approval:true}},{type:"deletion"},{type:"non_fast_forward"}]}]});
test("explicit channel is bound to immutable source and receipt",()=>{
  assert.deepEqual(validateRequest(request),request);
  assert.equal(validateRequest({...request,channel:"production",tag:"v26.10.200"}).channel,"production");
  for(const changed of [{channel:undefined},{tag:"v26.10.200"},{source_sha:"dev"},{receipt_sha256:"b".repeat(63)},{tag:"v26.10.0200-dev"},{tag:"v26.10.200-dev;echo"}]) assert.throws(()=>validateRequest({...request,...changed}));
});
test("only pinned protected owner-reviewed controller can reach App job",()=>{
  assert.doesNotThrow(()=>validateController(policy()));
  for(const change of [{repository:"fork/freed"},{ref:"refs/heads/dev"},{sha:"c".repeat(40)},{approvedSha:""},{policies:[{name:"*",type:"branch"}]},{policies:[{name:"release-controller",type:"tag"}]},{rulesets:[]}]) assert.throws(()=>validateController({...policy(),...change}));
  for(const field of ["require_code_owner_review","dismiss_stale_reviews_on_push","require_last_push_approval"]) { const value=policy();value.rulesets[0].rules[0].parameters[field]=false;assert.throws(()=>validateController(value)); }
  const bypass=policy();bypass.rulesets[0].bypass_actors=[{actor_id:1}];assert.throws(()=>validateController(bypass));
});
test("credential scope follows preflight and never runs candidate scripts",()=>{
 const workflow=readFileSync(new URL("../.github/workflows/cloud-release-request.yml",import.meta.url),"utf8");
 assert.ok(workflow.indexOf("preflight candidate") < workflow.indexOf("secrets.RELEASE_APP_PRIVATE_KEY"));
 assert.match(workflow,/environment: release-publisher/);
 assert.match(workflow,/persist-credentials: false/);
 assert.match(workflow,/cancel-in-progress: false/);
 assert.doesNotMatch(workflow,/candidate\/(?:scripts|node_modules)|working-directory: candidate|npm (?:ci|install)/);
 assert.match(workflow,/prepare-candidate candidate/);
 assert.match(workflow,/cd "\$GITHUB_WORKSPACE\/candidate"/);
 assert.match(workflow,/node "\$GITHUB_WORKSPACE\/controller\/scripts\/release-tag-publisher.mjs" publish/);
 assert.match(workflow,/trap 'rm -f --/);
});
