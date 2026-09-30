import { expect, it } from "vitest";
import vector from "./preference-value-query-vector-v1.json";
import { parseLibraryCorePreferenceScopeRequestV1, parseLibraryCorePreferenceScopeResponseV1 } from "./preference-scope-contracts.js";
import { createLibraryCoreSqliteQueryWorkerRequest, parseLibraryCoreSqliteQueryResponse, parseLibraryCoreSqliteWorkerRequest } from "./sqlite-worker-protocol.js";

// Tier 1: a selected scope cannot reorder results or mix source revisions on the wire.
it("binds every selected preference value to its ordered request and source", () => {
  const request = { queryId: "preference_scope_v1", schemaVersion: 1, paths: vector.cases.map(entry => entry.path),
    generationId: vector.generationId, sourceRevision: 7 } as const;
  const response = { queryId: "preference_scope_v1", schemaVersion: 1, source: { generationId: vector.generationId, projectionRevision: 7, transitionSequence: 7 }, results: vector.cases.map(entry => ({
    queryId: "preference_value_v1", schemaVersion: 1, path: entry.path, kind: entry.kind, rows: entry.expectedRows,
    source: { generationId: vector.generationId, projectionRevision: 7, transitionSequence: 7 } })) };
  const envelope = createLibraryCoreSqliteQueryWorkerRequest("preference-scope", request);
  expect(parseLibraryCoreSqliteWorkerRequest(envelope)).toEqual(envelope);
  expect(parseLibraryCoreSqliteQueryResponse(response, request)).toEqual(response);
  expect(parseLibraryCorePreferenceScopeRequestV1({ ...request, sql: "SELECT 1" }).ok).toBe(false);
  expect(parseLibraryCorePreferenceScopeRequestV1({ ...request, paths: [request.paths[0], request.paths[0]] }).ok).toBe(false);
  expect(parseLibraryCorePreferenceScopeRequestV1({ ...request, paths: Array.from({ length: 65 }, (_, i) => [String(i)]) }).ok).toBe(false);
  expect(parseLibraryCorePreferenceScopeResponseV1({ ...response, results: [...response.results].reverse() }, request).ok).toBe(false);
  expect(parseLibraryCorePreferenceScopeResponseV1(response, { ...request, sourceRevision: 8 }).ok).toBe(false);
  expect(parseLibraryCorePreferenceScopeResponseV1(response, { ...request, generationId: "b".repeat(64) }).ok).toBe(false);
  const mixed = structuredClone(response);
  mixed.results[0]!.source.projectionRevision = 6;
  mixed.results[0]!.source.transitionSequence = 6;
  expect(parseLibraryCorePreferenceScopeResponseV1(mixed, request).ok).toBe(false);

});

// Tier 1: canonical revision alone cannot authenticate a pending-aware response.
it("rejects mixed local preference sources and incomplete visible scopes", async () => {
  const {parseLibraryCoreVisiblePreferenceScopeRequestV1:requestParser,
    parseLibraryCoreVisiblePreferenceScopeResponseV1:responseParser}=await import("./visible-preference-contracts.js");
  const source={generationId:vector.generationId,sourceRevision:7,localSequence:9,actorId:"a".repeat(64),actorCounter:3};
  const request={paths:vector.cases.map(entry=>entry.path),source};
  const response={results:vector.cases.map(entry=>({path:entry.path,kind:entry.kind,rows:entry.expectedRows,source})),source};
  expect(requestParser(request)).toEqual({ok:true,value:request});
  expect(responseParser(response,request)).toEqual({ok:true,value:response});
  expect(requestParser({...request,sql:"SELECT 1"}).ok).toBe(false);
  expect(responseParser({...response,sql:"SELECT 1"},request).ok).toBe(false);
  expect(responseParser({...response,results:response.results.slice(1)},request).ok).toBe(false);
  expect(responseParser({...response,results:[...response.results].reverse()},request).ok).toBe(false);
  for (const changed of [
    {...source,localSequence:10},{...source,actorCounter:4},{...source,actorId:"b".repeat(64)},
    {...source,generationId:"c".repeat(64)},{...source,sourceRevision:8},
  ]) {
    expect(responseParser({...response,source:changed},request)).toEqual({ok:false,error:"CURSOR_STALE"});
    expect(responseParser({...response,results:[{...response.results[0]!,source:changed},...response.results.slice(1)]},request))
      .toEqual({ok:false,error:"CURSOR_STALE"});
  }
  let invoked=false;
  const accessor={...source};
  Object.defineProperty(accessor,"localSequence",{enumerable:true,get(){invoked=true;return 9;}});
  expect(requestParser({...request,source:accessor}).ok).toBe(false);
  expect(invoked).toBe(false);
  for (const malformed of [{...source,actorCounter:-1},{...source,localSequence:Infinity},{...source,extra:true},{...source,actorId:"A".repeat(64)}]) {
    expect(requestParser({...request,source:malformed}).ok).toBe(false);
  }
  const paths=Array.from({length:32},(_,index)=>[`large${index}`]);
  const leaf={booleanValue:null,integerValue:null,realValue:null,textValue:null,updatedAt:1};
  const results=paths.map(path=>({path,kind:"value",source,rows:[
    {...leaf,path:"a:$._",valueType:"integer",integerValue:10},
    ...Array.from({length:10},(_,index)=>({...leaf,path:`v:$._[${index}]`,valueType:"text",textValue:"x".repeat(8192)})),
  ]}));
  expect(responseParser({results,source},{paths,source})).toEqual({ok:false,error:"Visible preference scope exceeds its byte bound"});
  expect(requestParser({paths:Array.from({length:64},(_,index)=>[`${index}${"x".repeat(3000)}`]),source}).ok).toBe(false);
});
