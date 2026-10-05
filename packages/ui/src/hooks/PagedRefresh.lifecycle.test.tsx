/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ platform: {} as any }));
vi.mock('../context/PlatformContext.js', () => ({ usePlatform: () => fixture.platform }));
import { useLibraryFriendsDirectory } from './useLibraryFriendsDirectory.js';
import { useLibraryRssFeedPage } from './useLibraryRssFeedPage.js';
const filters: any[]=[];
const row:any={ id:'synthetic', url:'https://synthetic.invalid/feed', title:'Synthetic', enabled:true };
let root: Root,current:any,seen:any[];
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true; vi.useFakeTimers();root=createRoot(document.createElement('div'));seen=[];fixture.platform={queryLibraryCore:vi.fn(async()=>({rows:[row],nextCursor:null,totalCount:1,layoutRevision:1,source:{generationId:"a".repeat(64),projectionRevision:1,transitionSequence:1}}))}; });
afterEach(async()=>{await act(async()=>root.unmount());vi.useRealTimers();});
for(const family of ['directory','RSS']) {
 function Probe({version}:{version:number}) {current=family==='directory'?useLibraryFriendsDirectory({filters,search:'',sort:'name' as any,sourceVersion:version,limit:1}):useLibraryRssFeedPage({pageSize:1,sourceVersion:version});seen.push(current.rows);return null;}
 async function render(version:number){await act(async()=>{root.render(<Probe version={version}/>);});await act(async()=>{vi.advanceTimersByTime(150);});}
 it(`${family} retains committed rows during refresh without admitting paging`,async()=>{
  await render(1);expect(current.rows).toHaveLength(1);const committed=current.rows;
  fixture.platform.queryLibraryCore.mockImplementation(()=>new Promise(()=>{}));seen=[];await render(2);
  expect(seen[0]).toEqual(committed);expect(current.rows).toEqual(committed);expect(current.hasNext).toBe(false);expect(current.hasPrevious).toBe(false);
 });
 it(`${family} fences equal-version reader replacement before effects`,async()=>{
  await render(1);expect(current.rows).toHaveLength(1);
  fixture.platform.queryLibraryCore=vi.fn(()=>new Promise(()=>{}));seen=[];await render(1);expect(seen[0]).toEqual([]);expect(current.rows).toEqual([]);
 });
 it(`${family} reopens the visible page with fresh cursors and rejects captured paging during refresh`, async () => {
  const second={...row,id:'synthetic-second',url:'https://synthetic.invalid/second'};
  let generation='a', oldCursor:string|null=null;
  fixture.platform.queryLibraryCore.mockImplementation(async (request:any) => {
   const source={generationId:generation.repeat(64),projectionRevision:generation==='a'?1:2,transitionSequence:1};
   if(family==='directory') return {rows:[request.cursor===null?row:second],nextCursor:request.cursor===null?generation+'-next':null,totalCount:2,source};
   return {rows:request.cursor===null?[row,second]:[second],nextCursor:null,layoutRevision:1,source};
  });
  await render(1); await act(async()=>current.nextPage()); expect(current.pageNumber).toBe(2); expect(current.rows[0].id).toBe(second.id);
  oldCursor=fixture.platform.queryLibraryCore.mock.calls.at(-1)[0].cursor;
  const captured=current.previousPage; const committed=current.rows; const pending:any={};pending.promise=new Promise(resolve=>pending.resolve=resolve);
  const original=fixture.platform.queryLibraryCore.getMockImplementation(); generation='b'; fixture.platform.queryLibraryCore.mockImplementationOnce(()=>pending.promise);
  seen=[]; await render(2); expect(current.rows).toEqual(committed);
  const before=fixture.platform.queryLibraryCore.mock.calls.length; await act(async()=>captured()); expect(fixture.platform.queryLibraryCore.mock.calls.length).toBe(before);
  await act(async()=>pending.resolve(await original({cursor:null})));
  expect(current.pageNumber).toBe(2); expect(current.rows[0].id).toBe(second.id);
  const refreshCalls=fixture.platform.queryLibraryCore.mock.calls.slice(before-1);
  expect(refreshCalls[0][0].cursor).toBeNull(); expect(refreshCalls.some((call:any)=>call[0].cursor===oldCursor)).toBe(false);
 });

 it(`${family} ignores obsolete refresh completion and clears failure before retry`,async()=>{
  await render(1);
  const old:any={},fresh:any={}; old.promise=new Promise(resolve=>old.resolve=resolve);fresh.promise=new Promise((resolve,reject)=>{fresh.resolve=resolve;fresh.reject=reject;});
  fixture.platform.queryLibraryCore.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  await render(2);await render(3);
  await act(async()=>fresh.reject(new Error('synthetic failure')));expect(current.rows).toEqual([]);
  await act(async()=>old.resolve({rows:[row],nextCursor:null,totalCount:1,layoutRevision:1,source:{generationId:'a'.repeat(64),projectionRevision:1,transitionSequence:1}}));expect(current.rows).toEqual([]);
  await render(4);expect(current.rows).toHaveLength(1);
 });

}
