import { resumePwaAnnotationUpgrade } from "./library-core-annotation-storage";
import { archivePwaFollowerRowsWithStorageAdmission } from "./library-core-recovery-archive";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import sqlite3InitModule, { type Database, type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
vi.mock("./library-transfer-capability", () => ({LIBRARY_TRANSFER_ENABLED:false,requireLibraryTransferCapability:()=>{throw new Error("transfer unavailable");}}));
import { PwaLibraryCoreSqliteEngine } from "./library-core-sqlite-engine";
import { preparePwaConsumerRecovery, commitPwaConsumerRecovery } from "./library-core-consumer-recovery";
import { migratePwaLibraryRecoverySchema } from "./library-core-recovery-schema";
let sqlite:Sqlite3Static, db:Database, engine:PwaLibraryCoreSqliteEngine;
beforeEach(async()=>{
 sqlite=await sqlite3InitModule();db=new sqlite.oo1.DB(":memory:","c");
 engine=new PwaLibraryCoreSqliteEngine(db,sqlite.version.libVersion,{capi:sqlite.capi});
 engine.initialize();
 expect(resumePwaAnnotationUpgrade(db,sqlite.capi,()=>new sqlite.oo1.DB(":memory:","c"))).toBe(true);
 engine.initialize();
 db.exec("INSERT INTO library_checkpoint_stages(stage_id,library_id,authority_epoch,source_revision,expected_record_count,created_at) VALUES('stage','library','epoch',0,1,0);");
});
afterEach(()=>db.close());
it("allows empty bootstrap and refresh of the currently accepted epoch",()=>{
 expect(()=>engine.requireCheckpointTransferCapability("stage")).not.toThrow();
 db.exec("INSERT INTO library_meta VALUES(1,'library',1,'epoch',0,0);INSERT INTO library_materialization_generation VALUES(1,lower(hex(zeroblob(32))));");
 expect(()=>engine.requireCheckpointTransferCapability("stage")).not.toThrow();
});
it("refuses direct activation and projection bypass before schema/archive changes",()=>{
 db.exec("INSERT INTO library_meta VALUES(1,'library',1,'old',0,0);");const before=db.selectValue("PRAGMA schema_version");const projection={beforeReplace:vi.fn(),afterReplace:vi.fn()};
 const request={stageId:"stage",replaceExisting:true,followerReceipt:null};
 expect(()=>engine.activateNormalizedCheckpointWithLocalProjection(request,projection)).toThrow("transfer unavailable");
 expect(projection.beforeReplace).not.toHaveBeenCalled();expect(db.selectValue("PRAGMA schema_version")).toBe(before);expect(db.selectValue("SELECT authority_epoch FROM library_meta")).toBe("old");expect(sqlite.capi.sqlite3_get_autocommit(db.pointer!)).toBe(1);
});
it("refuses async proof and recovery entry points before SQLite/key work",async()=>{
 db.exec("INSERT INTO library_meta VALUES(1,'library',1,'old',0,0);");
 await expect(engine.verifyNormalizedCheckpointSuccessor({stageId:"stage",replaceExisting:true,followerReceipt:null})).rejects.toThrow("transfer unavailable");
 await expect(engine.preparePredecessorCheckpointRead("stage")).rejects.toThrow("transfer unavailable");
 await expect(engine.prepareConsumerRecovery("",{} as never)).rejects.toThrow("transfer unavailable");
 await expect(engine.commitConsumerRecovery("",0)).rejects.toThrow("transfer unavailable");
 await expect(engine.reapplyConsumerIntent({} as never)).rejects.toThrow("transfer unavailable");
 await expect(preparePwaConsumerRecovery(db,sqlite.capi,crypto.subtle,{} as never,"",{} as never)).rejects.toThrow("transfer unavailable");
 await expect(commitPwaConsumerRecovery(db,sqlite.capi,crypto.subtle,{} as never,"",0)).rejects.toThrow("transfer unavailable");
 const admitStorage=vi.fn();expect(()=>archivePwaFollowerRowsWithStorageAdmission(db,sqlite.capi,"",admitStorage)).toThrow("transfer unavailable");expect(admitStorage).not.toHaveBeenCalled();
 expect(()=>migratePwaLibraryRecoverySchema(db,sqlite.capi)).toThrow("transfer unavailable");
 expect(db.selectValue("PRAGMA user_version")).toBe(4);
});
