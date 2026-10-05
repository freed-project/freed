/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({platform:{} as any}));
vi.mock('../../context/PlatformContext.js',()=>({usePlatform:()=>fixture.platform}));
vi.mock('../ChannelAvatar.js',()=>({ChannelAvatar:()=>null}));
vi.mock('../map/MiniFriendMapCard.js',()=>({MiniFriendMapCard:()=>null}));
import { AccountDetailPanel } from './AccountDetailPanel.js';
let root:Root,host:HTMLDivElement,link:ReturnType<typeof vi.fn<(personId: string) => void>>;
const person={id:'synthetic-person',name:'Synthetic Target',relationshipStatus:'friend',careLevel:2};
const account:any={id:'synthetic-account',provider:'youtube',externalId:'synthetic',kind:'social',firstSeenAt:1,lastSeenAt:1};
let reader:any;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');root=createRoot(host);link=vi.fn<(personId: string) => void>();reader=vi.fn(async()=>({rows:[person]}));fixture.platform={queryLibraryCore:reader};});
afterEach(async()=>{await act(async()=>root.unmount());});
async function render(version=1,selected=account){await act(async()=>root.render(<AccountDetailPanel account={selected} suggestions={[]} sourceVersion={version} feedItems={[]} timelineLoading={false} timelineTotalCount={0} locationItems={[]} onBack={()=>{}} onPromoteToFriend={()=>{}} onPromoteToFam={()=>{}} onLinkToPerson={link} onOpenPerson={()=>{}} onOpenMap={()=>{}}/>));}
function capture(){const button=[...host.querySelectorAll('button')].find(x=>x.textContent?.includes('Synthetic Target'))!;expect(button).toBeDefined();const key=Object.keys(button).find(x=>x.startsWith('__reactProps$'))!;return (button as any)[key].onClick as ()=>void;}
it('admits the currently displayed picker row',async()=>{await render();await act(async()=>capture()());expect(link).toHaveBeenCalledWith(person.id);});
it('rejects a captured picker action after reader replacement',async()=>{await render();const run=capture();fixture.platform.queryLibraryCore=vi.fn(()=>new Promise(()=>{}));await render();await act(async()=>run());expect(link).not.toHaveBeenCalled();});
it('rejects a captured picker action while revision refresh is pending',async()=>{await render();const run=capture();reader.mockImplementation(()=>new Promise(()=>{}));await render(2);await act(async()=>run());expect(link).not.toHaveBeenCalled();});
it('rejects a captured picker action after selected Account changes',async()=>{await render();const run=capture();await render(1,{...account,id:'synthetic-other'});await act(async()=>run());expect(link).not.toHaveBeenCalled();});
