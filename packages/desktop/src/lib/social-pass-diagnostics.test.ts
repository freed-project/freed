import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
const fixture = (p: string, label = "", n = 1) => `<main><div role="main">${Array.from({length:n}, (_, i) => p === "ig"
  ? `<article data-freed-test-height="520"><header><a href="https://www.instagram.com/fixture/">fixture</a>${label}</header><a href="https://www.instagram.com/p/fixture${i}/">Open</a><div dir="auto">PRIVATE_CANARY with enough synthetic caption text for an ordinary feed placement.</div><img src="https://scontent.cdninstagram.com/private.jpg" width="640" height="640" /></article>`
  : `<div role="article"><header><h3><a href="https://www.facebook.com/fixture">fixture</a></h3>${label}</header><a href="https://www.facebook.com/fixture/posts/${123456789+i}">1 h</a><div dir="auto">PRIVATE_CANARY with enough synthetic caption text for an ordinary feed placement.</div></div>`).join("")}</div></main>`;
function extract(p: string, html: string, enabled: boolean) {
  const dom = new JSDOM(html, {url:p === "fb" ? "https://www.facebook.com/" : "https://www.instagram.com/", runScripts:"outside-only"});
  const reads: string[] = [];
  for (const name of ["querySelector", "querySelectorAll", "getAttribute"] as const) {
    const original = dom.window.Element.prototype[name];
    (dom.window.Element.prototype as any)[name] = function (...args: any[]) { reads.push(`${name}:${args[0]}`); return (original as any).apply(this,args); };
  }
  const text = Object.getOwnPropertyDescriptor(dom.window.Node.prototype,"textContent")!;
  Object.defineProperty(dom.window.Node.prototype,"textContent", {...text,get() { reads.push("textContent");return text.get!.call(this); }});
  dom.window.document.cookie = p === "fb" ? "c_user=12345" : "sessionid=12345";
  dom.window.Date.now = () => 1;
  let event: any;
  Object.defineProperty(dom.window,"__TAURI__",{value:{event:{emit(_n:string,data:unknown) {event=data;}}}});
  const source=readFileSync(resolve(process.cwd(),`src-tauri/src/${p}-extract.js`),"utf8");
  dom.window.eval(enabled ? source.replace("var passDiagnosticsEnabled = false;","var passDiagnosticsEnabled = true;") : source);
  dom.window.close();return {event,reads};
}
const payload=(n:number,reason="sponsored")=>({schemaVersion:1,surface:"feed",observed:n,candidateCount:n,inspectionComplete:true,truncated:false,outcome:"completed",records:Array.from({length:n},(_,ordinal)=>({ordinal,reason,disposition:"excluded"}))});
describe("pass-local diagnostics",()=>{
  it.each([
    ["fb","","retained_unknown_origin"],["fb","<span>Suggested for you</span>","recommendation_or_follow"],["fb","<span>Sponsored</span>","advertising"],
    ["ig","","retained_unknown_origin"],["ig","<span>Sponsored</span>","sponsored"],["ig","<span>Spon</span><span>sored</span>","sponsored"],
    ["ig","<span>Suggested for you</span>","recommendation"],["ig","<button>Follow</button>","follow"],["ig","<span>Sponsored by local volunteers</span>","retained_unknown_origin"],
  ])("preserves %s capture and inspected fields for %s",(p,label,reason)=>{
    const off=extract(p,fixture(p,label),false),on=extract(p,fixture(p,label),true);
    expect(off.event).not.toHaveProperty("passDiagnostics");const {passDiagnostics,...output}=on.event;
    expect(output).toEqual(off.event);expect(on.reads).toEqual(off.reads);
    expect(passDiagnostics.records).toEqual([{ordinal:0,reason,disposition:reason==="retained_unknown_origin"?"retained":"excluded"}]);
    expect(JSON.stringify(passDiagnostics)).not.toMatch(/PRIVATE_CANARY|http/);
  });
  it("caps injected observations without changing rejection",()=>{
    const r=extract("ig",fixture("ig","<span>Sponsored</span>",251),true).event;
    expect(r.passDiagnostics).toMatchObject({observed:251,truncated:true});expect(r.passDiagnostics.records).toHaveLength(250);expect(r.rejected.suggestedOrSponsored).toBe(251);
  });
  it("marks an existing 50-retained stop incomplete", () => {
    for (const provider of ["ig"]) {
      const result = extract(provider, fixture(provider, "", 51), true).event;
      expect(result.passDiagnostics).toMatchObject({ observed: 50, candidateCount: 51, inspectionComplete: false, truncated: false, outcome: "completed" });
      expect(result.posts).toHaveLength(50);
    }
  });
  it("keeps FB's existing bounded discovery distinct from upstream completeness", () => {
    const result = extract("fb", fixture("fb", "", 51), true).event;
    expect(result.passDiagnostics).toMatchObject({ observed: 50, candidateCount: 50, inspectionComplete: true });
    expect(result.posts).toHaveLength(50);
    // Completeness is only for the already enumerated candidates, never the page/feed universe.
  });
  it("never treats error or incomplete passes as retention proof", async () => {
    vi.resetModules();const {recordPassDiagnostics:record,readPassDiagnostics:read}=await import("./social-pass-diagnostics");
    record("instagram", {...payload(1), outcome:"error", inspectionComplete:false});
    record("facebook", {...payload(1), candidateCount:2, inspectionComplete:false});
    expect(read().passes.map(p=>p.usableForObservationSummary)).toEqual([false,false]);
  });
  it("rejects private or malformed payloads atomically",async()=>{
    vi.resetModules();const {recordPassDiagnostics:record,readPassDiagnostics:read}=await import("./social-pass-diagnostics");
    for(const p of [undefined,{...payload(1),caption:"SECRET"},payload(251),payload(1,"SECRET"),{...payload(1),records:[{ordinal:0,reason:"sponsored",disposition:"excluded",url:"SECRET"}]},{...payload(1),observed:2},{...payload(1),records:[{ordinal:-1,reason:"sponsored",disposition:"excluded"}]}])record("instagram",p);
    expect(read().recordCount).toBe(0);record("instagram",payload(1));expect(read().recordCount).toBe(1);
    read().passes[0].records[0].reason="SECRET";expect(read().passes[0].records[0].reason).toBe("sponsored");
  });
  it("caps all providers together without evicting evidence",async()=>{
    vi.resetModules();const {recordPassDiagnostics:record,readPassDiagnostics:read}=await import("./social-pass-diagnostics");
    record("facebook",payload(250));record("instagram",payload(250));record("facebook",payload(1));
    expect(read()).toMatchObject({recordCount:500,capped:true});expect(read().passes).toHaveLength(2);expect(JSON.stringify(read()).length).toBeLessThan(1_000_000);
  });
  it("caps empty passes and isolates diagnostic failures",async()=>{
    vi.resetModules();const {recordPassDiagnostics:record,readPassDiagnostics:read}=await import("./social-pass-diagnostics");
    expect(()=>record("instagram",new Proxy({},{ownKeys(){throw Error("SECRET");}}))).not.toThrow();
    for(let i=0;i<101;i++)record("instagram",payload(0));expect(read().passes).toHaveLength(100);expect(read().capped).toBe(true);
  });
});
