#!/usr/bin/env node
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {resolveGitHubCli} from "./lib/github-tooling.mjs";

export const CONTROLLER_BRANCH = "release-controller";
export const PUBLISHER_ENVIRONMENT = "release-publisher";
const REPO = "freed-project/freed";

// Admission tier: protects channel/ref/source/digest and controller authority.
export function validateRequest(value) {
  if (!value || !["dev", "production"].includes(value.channel)) throw new Error("Choose dev or production explicitly.");
  if (!/^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-dev)?$/.test(value.tag ?? "")) throw new Error("Invalid CalVer release tag.");
  if (value.tag.endsWith("-dev") !== (value.channel === "dev")) throw new Error("Release tag/channel mismatch.");
  if (!/^[0-9a-f]{40}$/.test(value.source_sha ?? "")) throw new Error("Require full immutable source SHA.");
  if (!/^[0-9a-f]{64}$/.test(value.receipt_sha256 ?? "")) throw new Error("Require release receipt SHA256.");
  if (value.request_run_id !== undefined && value.request_run_id !== "" && !/^[1-9][0-9]*$/.test(String(value.request_run_id))) throw new Error("Invalid request workflow run identity.");
  return Object.freeze({...((value.request_run_id !== undefined && value.request_run_id !== "") ? {request_run_id:String(value.request_run_id)} : {}), channel:value.channel, tag:value.tag, source_sha:value.source_sha, receipt_sha256:value.receipt_sha256});
}

export function validateController({repository, ref, sha, approvedSha, environment, policies, rulesets}) {
  if (repository !== REPO || ref !== `refs/heads/${CONTROLLER_BRANCH}` || !/^[0-9a-f]{40}$/.test(approvedSha ?? "") || sha !== approvedSha) throw new Error("Run only the reviewed, pinned release controller.");
  if (environment?.deployment_branch_policy?.custom_branch_policies !== true || environment.deployment_branch_policy.protected_branches !== false || policies?.length !== 1 || policies[0].name !== CONTROLLER_BRANCH || policies[0].type !== "branch") throw new Error("Publisher environment must admit only the controller branch, never tags or product branches.");
  const protectedController = rulesets?.some(rule => rule.target === "branch" && rule.enforcement === "active" && rule.bypass_actors?.length === 0 && rule.conditions?.ref_name?.include?.includes(`refs/heads/${CONTROLLER_BRANCH}`) && rule.conditions.ref_name.exclude?.length === 0 && rule.rules?.some(item => item.type === "pull_request" && item.parameters?.required_approving_review_count >= 1 && item.parameters.require_code_owner_review === true && item.parameters.dismiss_stale_reviews_on_push === true && item.parameters.require_last_push_approval === true) && ["deletion", "non_fast_forward"].every(type => rule.rules.some(item => item.type === type)));
  if (!protectedController) throw new Error("Controller requires active no-bypass owner review and immutable history protection.");
}

export function validateCloudCaller({actor, run, committedRequest, request}) {
  if (actor === "AubreyF") return;
  if (actor !== "github-actions[bot]" || !request.request_run_id || String(run?.id) !== request.request_run_id || run.event !== "push" || run.actor?.login !== "AubreyF" || run.head_repository?.full_name !== REPO || !/^release-requests\/[a-zA-Z0-9_-]+$/.test(run.head_branch ?? "") || !/^[0-9a-f]{40}$/.test(run.head_sha ?? "")) throw new Error("Cloud request must be attributed to an immutable owner-created request push.");
  const bound=validateRequest(committedRequest);
  if (["channel", "tag", "source_sha", "receipt_sha256"].some(key => bound[key] !== request[key]) || bound.request_run_id) throw new Error("Cloud dispatch does not match the owner's committed request.");
}

function git(args,cwd) { return execFileSync("git", args,{cwd,encoding:"utf8"}).trim(); }
export function preflight(request, candidate, {run=execFileSync, gh=resolveGitHubCli()}={}) {
  const input=validateRequest(request);
  const branch=input.channel === "dev" ? "dev" : "main";
  if (git(["status","--porcelain"],candidate) || git(["rev-parse","HEAD"],candidate) !== input.source_sha || git(["symbolic-ref","--short","HEAD"],candidate) !== branch || git(["rev-parse",`origin/${branch}`],candidate) !== input.source_sha) throw new Error("Candidate must be clean and equal the protected branch tip.");
  const receiptPath=`release-notes/releases/${input.tag}.json`;
  const actual=createHash("sha256").update(readFileSync(path.join(candidate,receiptPath))).digest("hex");
  if (actual !== input.receipt_sha256) throw new Error("Candidate release receipt digest mismatch.");
  const controller=path.dirname(fileURLToPath(import.meta.url));
  // The CLI loads authoritative GitHub publication facts; the pure API requires
  // those to be injected and must not guess the previous release boundary.
  run(process.execPath,[path.join(controller,"validate-release-identity.mjs"),`--cwd=${candidate}`,`--tag=${input.tag}`,`--head-ref=${input.source_sha}`,`--branch-ref=origin/${branch}`],{stdio:"inherit"});
  run(process.execPath,[path.join(controller,"validate-release-tag-authority.mjs"),`--repo=${REPO}`],{stdio:"inherit"});
  if (input.channel === "dev") run(process.execPath,[path.join(controller,"validate-dev-integration-receipt.mjs"),`--repo=${REPO}`,`--sha=${input.source_sha}`,"--branch=dev","--workflow=ci.yml"],{stdio:"inherit"});
  const remote=run(gh,["api",`repos/${REPO}/git/ref/heads/${branch}`],{encoding:"utf8"});
  if (JSON.parse(remote).object?.sha !== input.source_sha) throw new Error("Protected branch advanced during admission.");
  return {...input,branch,release_file:receiptPath};
}

function main() {
  const [command,candidate]=process.argv.slice(2);
  const request=validateRequest({channel:process.env.RELEASE_CHANNEL,tag:process.env.RELEASE_TAG,source_sha:process.env.RELEASE_SOURCE_SHA,receipt_sha256:process.env.RELEASE_RECEIPT_SHA256,request_run_id:process.env.RELEASE_REQUEST_RUN_ID});
  const gh=resolveGitHubCli();
  if (command === "dispatch") {
    execFileSync(gh,["workflow","run","cloud-release-request.yml","--repo",REPO,"--ref",CONTROLLER_BRANCH,"--json"],{input:JSON.stringify(request),stdio:["pipe","inherit","inherit"]});
    return;
  }
  if (command === "prepare-candidate" && candidate) {
    const branch=request.channel === "dev" ? "dev" : "main";
    execFileSync("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", "-C", path.resolve(candidate), "switch", "-c", branch, request.source_sha], {stdio:"inherit"});
    return;
  }
  if (command !== "preflight" || !candidate) throw new Error("Usage: cloud-release-request.mjs dispatch|preflight <candidate>; set RELEASE_CHANNEL, RELEASE_TAG, RELEASE_SOURCE_SHA, RELEASE_RECEIPT_SHA256.");
  if (process.env.GITHUB_ACTIONS === "true") {
    const api=(route)=>JSON.parse(execFileSync(gh,["api",`repos/${REPO}/${route}`],{encoding:"utf8"}));
    let run=null, committedRequest=null;
    if (process.env.GITHUB_ACTOR !== "AubreyF" && request.request_run_id) {
      run=api(`actions/runs/${request.request_run_id}`);
      if (!/^[0-9a-f]{40}$/.test(run.head_sha ?? "")) throw new Error("Invalid owner request commit.");
      const blob=api(`contents/release-requests/request.json?ref=${run.head_sha}`);
      if (blob.encoding !== "base64" || blob.size > 8192) throw new Error("Invalid owner request blob.");
      committedRequest=JSON.parse(Buffer.from(blob.content,"base64").toString("utf8"));
    }
    validateCloudCaller({actor:process.env.GITHUB_ACTOR,run,committedRequest,request});
    const summaries=api("rulesets?targets=branch&per_page=100");
    validateController({repository:process.env.GITHUB_REPOSITORY,ref:process.env.GITHUB_REF,sha:process.env.GITHUB_SHA,approvedSha:process.env.APPROVED_CONTROLLER_SHA,environment:api(`environments/${PUBLISHER_ENVIRONMENT}`),policies:api(`environments/${PUBLISHER_ENVIRONMENT}/deployment-branch-policies`).branch_policies,rulesets:summaries.map(item=>api(`rulesets/${item.id}`))});
  }
  process.stdout.write(JSON.stringify(preflight(request,path.resolve(candidate)))+"\n");
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { try {main();} catch(error) { console.error(error.message);process.exitCode=1;} }
