/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RecoveryAccountLinkFields } from './RecoveryAccountLinkFields.js';
let root:Root,host:HTMLDivElement,query:any,submit:any;
let drafts:any,saving:boolean,locked:boolean,version:number;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');root=createRoot(host);query=vi.fn(async()=>({rows:[{id:'synthetic-person',name:'Synthetic Person'}]}));submit=vi.fn();saving=false;locked=false;version=1;drafts=[{accountId:'synthetic-account',label:'Synthetic',current:{id:null,label:'Unlinked',present:true},archived:{id:null,label:'Unlinked',present:true}}];});
afterEach(async()=>{await act(async()=>root.unmount());});
async function render(){await act(async()=>root.render(<RecoveryAccountLinkFields drafts={drafts} query={query} sourceVersion={version} saving={saving} locked={locked} onSubmit={submit}/>));}
function capture(text:string){const button=[...host.querySelectorAll('button')].find(x=>x.textContent?.includes(text))!;expect(button).toBeDefined();const key=Object.keys(button).find(x=>x.startsWith('__reactProps$'))!;return (button as any)[key].onClick as ()=>void;}
async function confirm(){await act(async()=>(host.querySelector('input[type=checkbox]') as HTMLInputElement).click());}
it('submits the current confirmed reviewed batch once',async()=>{await render();await confirm();await act(async()=>capture('Store account links')());expect(submit).toHaveBeenCalledOnce();});
for(const change of ['locked','reader','batch','version'])it(`rejects captured submit after ${change} ownership changes`,async()=>{await render();await confirm();const run=capture('Store account links');if(change==='locked')locked=true;if(change==='reader')query=vi.fn(()=>new Promise(()=>{}));if(change==='batch')drafts=[{...drafts[0],accountId:'other-account'}];if(change==='version')version=2;await render();await act(async()=>run());expect(submit).not.toHaveBeenCalled();});
it('rejects captured picker choice after reader replacement',async()=>{await render();const run=capture('Select Synthetic Person');query=vi.fn(()=>new Promise(()=>{}));await render();await act(async()=>run());expect(host.textContent).toContain('Selected link: Unlinked');expect(host.textContent).not.toContain('Selected link: Synthetic Person');});

it('keeps the current locked exact-retry action available while rejecting the pre-lock callback',async()=>{await render();await confirm();const beforeLock=capture('Store account links');locked=true;await render();await act(async()=>beforeLock());expect(submit).not.toHaveBeenCalled();await act(async()=>capture('Store account links')());expect(submit).toHaveBeenCalledOnce();expect((host.querySelector('input[type=checkbox]') as HTMLInputElement).disabled).toBe(true);});

it('retains pending picker choices but rejects current and captured selection until ready',async()=>{
 await render();const old=capture('Select Synthetic Person');let resolve!:(value:any)=>void;const pending=new Promise<any>(a=>resolve=a);query.mockReturnValueOnce(pending);version=2;await render();
 const during=capture('Select Synthetic Person');const button=[...host.querySelectorAll('button')].find(x=>x.textContent?.includes('Select Synthetic Person'))!;expect(button.disabled).toBe(true);
 await act(async()=>{old();during();});expect(host.textContent).toContain('Selected link: Unlinked');
 await act(async()=>resolve({rows:[{id:'synthetic-person',name:'Synthetic Person'}]}));await act(async()=>capture('Select Synthetic Person')());expect(host.textContent).toContain('Selected link: Synthetic Person');
});
