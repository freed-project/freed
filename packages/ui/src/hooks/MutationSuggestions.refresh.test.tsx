/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({platform:{} as any}));
vi.mock('../context/PlatformContext.js',()=>({usePlatform:()=>fixture.platform}));
import { useLibraryPersonPicker } from './useLibraryPersonPicker.js';
import * as links from './useLibraryAccountLinkCandidates.js';
import * as reviews from './useLibraryFriendCandidateReview.js';
import { useActionOwnershipFence } from './useActionOwnershipFence.js';
const empty:any[]=[];
const row:any={id:'synthetic',name:'Synthetic',accountId:'a',personId:'p',accountIdsJson:'[]',sampleItemIdsJson:'[]',signalCountsJson:'{}'};
const cases=[
 {name:'picker',hook:(v:number,context:string)=>useLibraryPersonPicker({enabled:true,query:fixture.platform.queryLibraryCore,search:context,sourceVersion:v})},
 {name:'link candidates',hook:(v:number,context:string)=>(links as any).useLibraryAccountLinkCandidatesState?.({entityId:context,entityKind:'account',sourceVersion:v})??{rows:links.useLibraryAccountLinkCandidates({entityId:context,entityKind:'account',sourceVersion:v}),resultsCurrent:true}},
 {name:'Friend review',hook:(v:number,context:string)=>(reviews as any).useLibraryFriendCandidateReviewState?.({contactSuggestions:empty,dismissedSuggestionIds:context==='a'?empty:['changed'],sourceVersion:v})??{rows:reviews.useLibraryFriendCandidateReview({contactSuggestions:empty,dismissedSuggestionIds:context==='a'?empty:['changed'],sourceVersion:v}),resultsCurrent:true}},
];
function deferred(){let resolve!:(v:any)=>void,reject!:(e:Error)=>void;const promise=new Promise<any>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
for(const c of cases)describe(c.name,()=>{
 let root:Root,current:any,run:()=>void,mutate:any,seen:any[];
 function Probe({version,context}:{version:number;context:string}){current=c.hook(version,context);seen.push(current.rows);const admit=useActionOwnershipFence([version,context,fixture.platform.queryLibraryCore,current.rows],current.resultsCurrent===true);run=()=>{if(admit())mutate();};return null;}
 async function render(version=1,context='a'){await act(async()=>root.render(<Probe version={version} context={context}/>));}
 beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;root=createRoot(document.createElement('div'));seen=[];mutate=vi.fn();fixture.platform={queryLibraryCore:vi.fn(async()=>({rows:[row]}))};});
 afterEach(async()=>{await act(async()=>root.unmount());});
 it('retains same-context rows, rejects old/current pending actions and admits settled current action once',async()=>{
  await render();expect(current.rows).toHaveLength(1);const committed=current.rows,old=run;const pending=deferred();fixture.platform.queryLibraryCore.mockReturnValueOnce(pending.promise);seen=[];await render(2);
  expect(seen[0]).toEqual(committed);expect(current.rows).toEqual(committed);expect(current.resultsCurrent).toBe(false);old();run();expect(mutate).not.toHaveBeenCalled();
  await act(async()=>pending.resolve({rows:[{...row}]}));expect(current.resultsCurrent).toBe(true);run();expect(mutate).toHaveBeenCalledOnce();old();expect(mutate).toHaveBeenCalledOnce();
 });
 it('clears immediately for request or reader replacement and rewind, rejecting captured actions',async()=>{
  await render(5);const old=run;fixture.platform.queryLibraryCore.mockImplementation(()=>new Promise(()=>{}));seen=[];await render(5,'changed');expect(seen[0]).toEqual([]);old();expect(mutate).not.toHaveBeenCalled();
  fixture.platform.queryLibraryCore=vi.fn(async()=>({rows:[row]}));await render(5);expect(current.rows).toHaveLength(1);
  fixture.platform.queryLibraryCore=vi.fn(()=>new Promise(()=>{}));seen=[];await render(5);expect(seen[0]).toEqual([]);await render(1);expect(current.rows).toEqual([]);
 });
 it('ignores obsolete completion, applies real zero, clears error and does not resurrect during retry',async()=>{
  await render();const old=deferred(),latest=deferred();fixture.platform.queryLibraryCore.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);await render(2);await render(3);
  await act(async()=>latest.resolve({rows:[]}));expect(current.rows).toEqual([]);expect(current.resultsCurrent).toBe(true);await act(async()=>old.resolve({rows:[row]}));expect(current.rows).toEqual([]);
  const fail=deferred();fixture.platform.queryLibraryCore.mockReturnValueOnce(fail.promise);await render(4);await act(async()=>fail.reject(new Error('synthetic')));expect(current.rows).toEqual([]);expect(current.resultsCurrent).toBe(false);
  const retry=deferred();fixture.platform.queryLibraryCore.mockReturnValueOnce(retry.promise);await render(5);expect(current.rows).toEqual([]);await act(async()=>retry.resolve({rows:[row]}));expect(current.resultsCurrent).toBe(true);
 });
});
