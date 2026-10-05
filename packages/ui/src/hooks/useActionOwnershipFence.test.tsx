/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useActionOwnershipFence } from './useActionOwnershipFence.js';
let root:Root,owners:unknown[],enabled:boolean,current:()=>boolean;
let mutate:any,followup:any,run:()=>Promise<void>,pending:any;
function Probe(){const admit=useActionOwnershipFence(owners,enabled);current=admit;run=async()=>{if(!admit())return;await mutate();if(admit())followup();};return null;}
async function render(){await act(async()=>root.render(<Probe/>));}
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;root=createRoot(document.createElement('div'));owners=['account-a','person-a',1,()=>{},[]];enabled=true;mutate=vi.fn(async()=>{});followup=vi.fn();});
afterEach(async()=>{await act(async()=>root.unmount());});
it('admits current action and preserves admission/callback on equivalent renders',async()=>{await render();const guard=current;owners=[...owners];await render();expect(current).toBe(guard);await run();expect(mutate).toHaveBeenCalledOnce();expect(followup).toHaveBeenCalledOnce();});
for(const [label,index] of [['Account',0],['Person',1],['revision',2],['reader',3],['rows',4]] as const)it(`rejects captured consumer action after ${label} replacement`,async()=>{await render();const captured=run;owners=owners.map((value,i)=>i===index?{}:value);await render();await captured();expect(mutate).not.toHaveBeenCalled();expect(followup).not.toHaveBeenCalled();});
it('rejects locked/disabled actions and suppresses obsolete async focus or picker close',async()=>{await render();const captured=run;enabled=false;await render();await captured();expect(mutate).not.toHaveBeenCalled();enabled=true;await render();pending={};pending.promise=new Promise(resolve=>pending.resolve=resolve);mutate.mockReturnValueOnce(pending.promise);const operation=run();expect(mutate).toHaveBeenCalledOnce();owners=['account-b',...owners.slice(1)];await render();await act(async()=>pending.resolve());await operation;expect(followup).not.toHaveBeenCalled();});
it('rejects callbacks after owner unmount',async()=>{await render();const captured=run;await act(async()=>root.render(null));await captured();expect(mutate).not.toHaveBeenCalled();});

it('rejects captured callbacks after A to B to A ownership changes',async()=>{await render();const captured=run;const original=[...owners];owners=['account-b',...owners.slice(1)];await render();owners=original;await render();await captured();expect(mutate).not.toHaveBeenCalled();await run();expect(mutate).toHaveBeenCalledOnce();});
it('rejects captured callbacks after disable and reenable',async()=>{await render();const captured=run;enabled=false;await render();enabled=true;await render();await captured();expect(mutate).not.toHaveBeenCalled();await run();expect(mutate).toHaveBeenCalledOnce();});
