import { writeFileSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { calculatePriority, type FeedItem } from "@freed/shared";

const mocks = vi.hoisted(() => ({ backfill: vi.fn(), reload: vi.fn(), query: vi.fn(), subscriber: null as null | ((state: unknown, event: {source:string})=>void), revision:100, generation:"a".repeat(64), preferences:1, census:265 }));
vi.mock("./library-client",()=>({backfillLibraryPriorities:mocks.backfill,reloadSqliteLibraryState:mocks.reload,subscribeDesktopLibraryRuntime:(cb:typeof mocks.subscriber)=>{mocks.subscriber=cb;return vi.fn();}}));
vi.mock("./library-core-normalized-query-client",()=>({queryNormalizedLibrary:mocks.query}));
vi.mock("./background-runtime-coordinator",()=>({isBackgroundRuntimeDeferredError:()=>false,runBackgroundJob:({run}:{run:()=>Promise<unknown>})=>run()}));
vi.mock("./logger",()=>({log:{info:vi.fn(),warn:vi.fn(),error:vi.fn()}}));
vi.mock("@freed/ui/lib/debug-store",()=>({addDebugEvent:vi.fn()}));
vi.mock("@freed/ui/lib/factory-reset",()=>({waitForFactoryResetDrain:vi.fn()}));
import { start, stop } from "./priority-indexer";
const NOW=1790900000000, HORIZON=604800000;
const source=()=>({generationId:mocks.generation,projectionRevision:mocks.revision,transitionSequence:mocks.revision});
let computed:number[], published:number[], scores:number[], assignments:number, authorWeight:number, careLevel:number, saved:boolean, likes:number, topicEnabled:boolean;
function facet(){ return {queryId:"library_facet_summary_v1",schemaVersion:1,source:source(),summary:{
  archivedCount:0,archivableCount:0,contactAccountCount:0,contactLinkedPersonCount:0,enabledRssFeedCount:0,friendPersonCount:0,latestContactImportedAt:null,latestRssFeedFetchedAt:null,
  platformCounts:[{archivableCount:0,latestCapturedAt:NOW,latestPublishedAt:NOW-86400000,platform:"x",totalCount:mocks.census,unreadCount:0}],rssFeedCount:0,sampleAccountCount:0,sampleFeedCount:0,sampleItemCount:0,samplePersonCount:0,savedArchivedCount:0,savedCount:0,savedPlatformCount:0,socialAccountCount:0,tags:[],totalCount:mocks.census,unreadCount:0}}; }
async function initial(){start();await vi.advanceTimersByTimeAsync(33000);expect(assignments).toBe(265);}
async function hour(){await vi.advanceTimersByTimeAsync(3604000);}

describe("mixed Library priority progress and source proof",()=>{
  beforeEach(()=>{
    vi.useFakeTimers();vi.setSystemTime(NOW);computed=Array(265).fill(-1);published=Array.from({length:265},(_,i)=>i<256?NOW-HORIZON*4:i===256?NOW-HORIZON+1:NOW-86400000);
    scores=[];assignments=0;authorWeight=50;careLevel=3;saved=false;likes=0;topicEnabled=false;
    mocks.revision=100;mocks.generation="a".repeat(64);mocks.preferences=1;mocks.census=265;mocks.subscriber=null;
    mocks.reload.mockReset().mockResolvedValue({});mocks.query.mockReset().mockImplementation(async req=>req.queryId==="library_facet_summary_v1"?facet():{queryId:"preferences_revision_v1",schemaVersion:1,revision:mocks.preferences,source:source()});
    mocks.backfill.mockReset().mockImplementation(async(pass:number,limit:number,_publish:boolean,timeSource?:ReturnType<typeof source>)=>{
      const actual=source();if(timeSource && JSON.stringify(timeSource)!==JSON.stringify(actual))throw new Error("CURSOR_STALE");
      const pending=computed.flatMap((at,id)=>at<pass && (!timeSource || at<0 || at-published[id]!<HORIZON)?[id]:[]), selected=pending.slice(0,limit);
      for(const id of selected){
        const item:FeedItem={globalId:`synthetic-${id}`,platform:"x",contentType:"post",publishedAt:published[id]!,capturedAt:published[id]!,author:{id:"synthetic",handle:"fixture",displayName:"Synthetic"},content:{text:"Offline fixture",mediaUrls:[],mediaTypes:[]},topics:topicEnabled?["synthetic"]:[],engagement:{likes},userState:{hidden:false,saved,archived:false,tags:[]}};
        scores[id]=calculatePriority(item,{recency:50,authors:{synthetic:authorWeight},platforms:{},topics:{synthetic:100}},pass,{careLevel});computed[id]=pass;assignments++;
      }
      if(selected.length)mocks.revision++;
      return {passStartedAt:pass,updated:selected.length,remaining:pending.length>selected.length?1:0,source:actual};
    });
  });
  afterEach(()=>{stop();vi.useRealTimers();});
  it("reduces hourly assignments from 265 to 9 then 8 and retains old canonical timestamps",async()=>{
    await initial();const oldTimes=computed.slice(0,256),oldScores=scores.slice(0,256);await hour();if(process.env.RANKING_OPERATION_EVIDENCE)writeFileSync(process.env.RANKING_OPERATION_EVIDENCE,JSON.stringify({scope:"Actual scheduler and shared transform; simulated assignment boundary",initial:265,firstHourly:assignments-265},null,2)+"\n");expect(assignments).toBe(274);expect(computed.slice(0,256)).toEqual(oldTimes);expect(scores.slice(0,256)).toEqual(oldScores);
    const boundaryTime=computed[256];await hour();expect(assignments).toBe(282);expect(computed[256]).toBe(boundaryTime);
    if(process.env.RANKING_OPERATION_EVIDENCE)writeFileSync(process.env.RANKING_OPERATION_EVIDENCE,JSON.stringify({scope:"Actual scheduler and shared score transform; assignment boundary simulated",initial:265,firstHourly:9,secondHourly:8,oldScoresPreserved:true,oldComputedTimesPreserved:true},null,2)+"\n");
  });
  it.each(["preferences_patch","item_patch","state_update"])("uses a full invalidation pass for %s",async(event)=>{
    await initial();const before=scores[0];authorWeight=100;careLevel=5;saved=true;likes=500;mocks.revision++;if(event==="preferences_patch")mocks.preferences++;
    mocks.subscriber?.(null,{source:event});await vi.advanceTimersByTimeAsync(6000);expect(assignments).toBeGreaterThanOrEqual(530);expect(scores[0]).not.toBe(before);
    const total=assignments;await hour();expect(assignments-total).toBe(8);
  });
  it.each(["author weights", "engagement", "relationship care", "saved state", "topics"])("reranks settled items after changed %s",async(input)=>{
    await initial();const before=scores[0];
    if(input==="author weights"){authorWeight=100;mocks.preferences++;}
    else if(input==="engagement")likes=500;
    else if(input==="relationship care")careLevel=5;
    else if(input==="saved state")saved=true;
    else topicEnabled=true;
    mocks.revision++;mocks.subscriber?.(null,{source:input==="author weights"?"preferences_patch":"item_patch"});
    await vi.advanceTimersByTimeAsync(6000);expect(assignments).toBeGreaterThanOrEqual(530);expect(scores[0]).not.toBe(before);
  });
  it("uses full mode when a canonical write event was missed",async()=>{await initial();mocks.revision++;await hour();expect(assignments).toBe(530);});
  it("uses full mode after generation replacement",async()=>{await initial();mocks.generation="b".repeat(64);await hour();expect(assignments).toBeGreaterThanOrEqual(530);});
  it("starts a full pass after stop/restart despite a prior selective completion",async()=>{await initial();await hour();stop();const total=assignments;start();await vi.advanceTimersByTimeAsync(33000);expect(assignments-total).toBe(265);});
  it("rejects changed native query source between preflight and selection and retries full",async()=>{
    await initial();const original=mocks.backfill.getMockImplementation()!;let raced=false;
    mocks.backfill.mockImplementation(async(...args)=>{if(args[3]&&!raced){raced=true;mocks.revision++;}return original(...args);});
    await hour();expect(raced).toBe(true);expect(assignments).toBe(530);
  });
  it("runs full follow-up when another write occurs after selection but before signed commit",async()=>{
    await initial();const original=mocks.backfill.getMockImplementation()!;let raced=false;
    mocks.backfill.mockImplementation(async(...args)=>{const result=await original(...args);if(args[3]&&!raced){raced=true;mocks.revision++;}return result;});
    await hour();expect(assignments).toBe(539);
  });
  it("runs a full follow-up after completion reload source drift",async()=>{
    await initial();mocks.reload.mockImplementationOnce(async()=>{mocks.revision++;return {};});await hour();expect(assignments).toBe(539);
  });
  it("detects external source advance between full-pass batches and coalesces a full follow-up",async()=>{
    const original=mocks.backfill.getMockImplementation()!;let calls=0;mocks.backfill.mockImplementation(async(...args)=>{const result=await original(...args);if(++calls===1)mocks.revision++;return result;});
    start();await vi.advanceTimersByTimeAsync(37000);expect(assignments).toBe(530);await hour();expect(assignments).toBe(538);
  });
  it("falls back to full mode outside the measured census envelope",async()=>{await initial();mocks.census=25001;await hour();expect(assignments).toBe(530);});
  it("falls back to full mode after a selective query error",async()=>{await initial();mocks.backfill.mockRejectedValueOnce(new Error("deadline exceeded"));await hour();expect(assignments).toBe(530);});
  it("continues the same selective timestamp after hidden suspension",async()=>{
    await initial();Object.defineProperty(document,"visibilityState",{configurable:true,value:"hidden"});await hour();expect(assignments).toBe(265);
    Object.defineProperty(document,"visibilityState",{configurable:true,value:"visible"});await vi.advanceTimersByTimeAsync(1000);expect(assignments).toBe(274);
  });
});
