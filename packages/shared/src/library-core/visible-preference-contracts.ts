import type { LibraryCoreFeedPageParseResult } from "./feed-page-contracts.js";
import { parseLibraryCorePreferenceScopeRequestV1 } from "./preference-scope-contracts.js";
import { parseLibraryCorePreferenceValueResponseV1, type LibraryCorePreferenceValueResponseV1 } from "./preference-value-contracts.js";
import { parseLibraryCoreVisiblePreferenceSourceV1, type LibraryCoreVisiblePreferenceSourceV1 } from "./visible-preference-source.js";

/** Internal dormant adapter contract; activation must register its query route. */
export interface LibraryCoreVisiblePreferenceScopeRequestV1 {
  readonly paths: readonly (readonly string[])[];
  readonly source: LibraryCoreVisiblePreferenceSourceV1;
}
export interface LibraryCoreVisiblePreferenceValueV1 extends Pick<LibraryCorePreferenceValueResponseV1,"path"|"kind"|"rows"> {
  readonly source: LibraryCoreVisiblePreferenceSourceV1;
}
export interface LibraryCoreVisiblePreferenceScopeResponseV1 {
  readonly results: readonly LibraryCoreVisiblePreferenceValueV1[];
  readonly source: LibraryCoreVisiblePreferenceSourceV1;
}
const encoder=new TextEncoder();
const bad=(error:string)=>({ok:false as const,error});
function closed(value:unknown,keys:readonly string[]):value is Record<string,unknown> {
  if (!value || typeof value!=="object" || Object.getPrototypeOf(value)!==Object.prototype) return false;
  const own=Reflect.ownKeys(value);
  return own.length===keys.length && own.every(key=>typeof key==="string" && keys.includes(key)
    && Object.getOwnPropertyDescriptor(value,key)?.enumerable===true
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)!,"value"));
}
function sameSource(left:LibraryCoreVisiblePreferenceSourceV1,right:LibraryCoreVisiblePreferenceSourceV1):boolean {
  return left.generationId===right.generationId && left.sourceRevision===right.sourceRevision
    && left.localSequence===right.localSequence && left.actorId===right.actorId && left.actorCounter===right.actorCounter;
}
export function parseLibraryCoreVisiblePreferenceScopeRequestV1(input:unknown):LibraryCoreFeedPageParseResult<LibraryCoreVisiblePreferenceScopeRequestV1> {
  if (!closed(input,["paths","source"])) return bad("Visible preference scope request is invalid");
  const source=parseLibraryCoreVisiblePreferenceSourceV1(input.source);
  if (!source.ok) return source;
  const scope=parseLibraryCorePreferenceScopeRequestV1({queryId:"preference_scope_v1",schemaVersion:1,
    paths:input.paths,generationId:source.value.generationId,sourceRevision:source.value.sourceRevision});
  if (!scope.ok) return scope;
  const value=Object.freeze({paths:scope.value.paths,source:source.value});
  if (encoder.encode(JSON.stringify(value)).length>128*1024) return bad("Visible preference scope request exceeds its byte bound");
  return {ok:true,value};
}
export function parseLibraryCoreVisiblePreferenceValueV1(input:unknown,path:readonly string[],expected:LibraryCoreVisiblePreferenceSourceV1):LibraryCoreFeedPageParseResult<LibraryCoreVisiblePreferenceValueV1> {
  const expectedSource=parseLibraryCoreVisiblePreferenceSourceV1(expected);
  if (!expectedSource.ok) return expectedSource;
  if (!closed(input,["path","kind","rows","source"])) return bad("Visible preference value is invalid");
  const source=parseLibraryCoreVisiblePreferenceSourceV1(input.source);
  if (!source.ok) return source;
  if (!sameSource(source.value,expectedSource.value)) return bad("CURSOR_STALE");
  // Reuse the complete canonical row/shape validator. The local source remains
  // mandatory and is compared separately before this synthetic canonical source.
  const canonicalSource={generationId:source.value.generationId,projectionRevision:source.value.sourceRevision,transitionSequence:source.value.sourceRevision};
  const parsed=parseLibraryCorePreferenceValueResponseV1({queryId:"preference_value_v1",schemaVersion:1,
    path:input.path,kind:input.kind,rows:input.rows,source:canonicalSource},
    {queryId:"preference_value_v1",schemaVersion:1,path,generationId:source.value.generationId,sourceRevision:source.value.sourceRevision});
  if (!parsed.ok) return parsed;
  const value=Object.freeze({path:parsed.value.path,kind:parsed.value.kind,rows:parsed.value.rows,source:source.value});
  if (encoder.encode(JSON.stringify(value)).length>2*1048576) return bad("Visible preference response exceeds its byte bound");
  return {ok:true,value};
}
export function parseLibraryCoreVisiblePreferenceScopeResponseV1(input:unknown,request:LibraryCoreVisiblePreferenceScopeRequestV1):LibraryCoreFeedPageParseResult<LibraryCoreVisiblePreferenceScopeResponseV1> {
  const checked=parseLibraryCoreVisiblePreferenceScopeRequestV1(request);
  if (!checked.ok) return checked;
  if (!closed(input,["results","source"]) || !Array.isArray(input.results) || input.results.length!==checked.value.paths.length) {
    return bad("Visible preference scope response is invalid");
  }
  const source=parseLibraryCoreVisiblePreferenceSourceV1(input.source);
  if (!source.ok) return source;
  if (!sameSource(source.value,checked.value.source)) return bad("CURSOR_STALE");
  const results:LibraryCoreVisiblePreferenceValueV1[]=[];
  let bytes=0;
  for (let index=0;index<input.results.length;index+=1) {
    const result=parseLibraryCoreVisiblePreferenceValueV1(input.results[index],checked.value.paths[index]!,source.value);
    if (!result.ok) return result;
    bytes+=encoder.encode(JSON.stringify(result.value)).length;
    if (bytes>2*1048576) return bad("Visible preference scope exceeds its byte bound");
    results.push(result.value);
  }
  const value=Object.freeze({results:Object.freeze(results),source:source.value});
  if (encoder.encode(JSON.stringify(value)).length>2*1048576) return bad("Visible preference scope exceeds its byte bound");
  return {ok:true,value};
}
