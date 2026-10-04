import { archivePwaFollowerRowsWithStorageAdmission } from "./library-core-recovery-archive";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import sqlite3InitModule, { type Database, type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
vi.mock("./library-transfer-capability", () => ({LIBRARY_TRANSFER_ENABLED:false,requireLibraryTransferCapability:()=>{throw new Error("transfer unavailable");}}));
import { PwaLibraryCoreSqliteEngine } from "./library-core-sqlite-engine";
import { preparePwaConsumerRecovery, commitPwaConsumerRecovery } from "./library-core-consumer-recovery";
import { migratePwaLibraryRecoverySchema } from "./library-core-recovery-schema";
let sqlite:Sqlite3Static, db:Database, engine:PwaLibraryCoreSqliteEngine;
beforeEach(async()=>{sqlite=await sqlite3InitModule();db=new sqlite.oo1.DB(":memory:","c");engine=new PwaLibraryCoreSqliteEngine(db,sqlite.version.libVersion,{capi:sqlite.capi});db.exec("CREATE TABLE library_meta(singleton_id INTEGER,library_id TEXT,authority_epoch TEXT);CREATE TABLE library_checkpoint_stages(stage_id TEXT,library_id TEXT,authority_epoch TEXT);INSERT INTO library_checkpoint_stages VALUES('stage','library','epoch');");});
afterEach(()=>db.close());
it("allows empty bootstrap and refresh of the currently accepted epoch despite old enrollment",()=>{
 expect(()=>engine.requireCheckpointTransferCapability("stage")).not.toThrow();
 db.exec("INSERT INTO library_meta VALUES(1,'library','epoch');CREATE TABLE old_enrollment(epoch TEXT);INSERT INTO old_enrollment VALUES('predecessor');");
 expect(()=>engine.requireCheckpointTransferCapability("stage")).not.toThrow();
});
it("refuses direct activation and projection bypass before schema/archive changes",()=>{
 db.exec("INSERT INTO library_meta VALUES(1,'library','old');");const before=db.selectValue("PRAGMA schema_version");const projection={beforeReplace:vi.fn(),afterReplace:vi.fn()};
 const request={stageId:"stage",replaceExisting:true,followerReceipt:null};
 expect(()=>engine.activateNormalizedCheckpointWithLocalProjection(request,projection)).toThrow("transfer unavailable");
 expect(projection.beforeReplace).not.toHaveBeenCalled();expect(db.selectValue("PRAGMA schema_version")).toBe(before);expect(db.selectValue("SELECT authority_epoch FROM library_meta")).toBe("old");expect(sqlite.capi.sqlite3_get_autocommit(db.pointer!)).toBe(1);
});
it("refuses async proof and recovery entry points before SQLite/key work",async()=>{
 db.exec("INSERT INTO library_meta VALUES(1,'library','old');");
 await expect(engine.verifyNormalizedCheckpointSuccessor({stageId:"stage",replaceExisting:true,followerReceipt:null})).rejects.toThrow("transfer unavailable");
 await expect(engine.preparePredecessorCheckpointRead("stage")).rejects.toThrow("transfer unavailable");
 await expect(engine.prepareConsumerRecovery("",{} as never)).rejects.toThrow("transfer unavailable");
 await expect(engine.commitConsumerRecovery("",0)).rejects.toThrow("transfer unavailable");
 await expect(engine.reapplyConsumerIntent({} as never)).rejects.toThrow("transfer unavailable");
 await expect(preparePwaConsumerRecovery(db,sqlite.capi,crypto.subtle,{} as never,"",{} as never)).rejects.toThrow("transfer unavailable");
 await expect(commitPwaConsumerRecovery(db,sqlite.capi,crypto.subtle,{} as never,"",0)).rejects.toThrow("transfer unavailable");
 const admitStorage=vi.fn();expect(()=>archivePwaFollowerRowsWithStorageAdmission(db,sqlite.capi,"",admitStorage)).toThrow("transfer unavailable");expect(admitStorage).not.toHaveBeenCalled();
 expect(()=>migratePwaLibraryRecoverySchema(db,sqlite.capi)).toThrow("transfer unavailable");
 expect(db.selectValue("PRAGMA user_version")).toBe(0);
});
