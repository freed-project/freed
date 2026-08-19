import type {
  LibraryCoreMediaBlobDescriptorV1,
  LibraryCoreMediaBlobReferenceV1,
} from "@freed/shared/library-core";

/**
 * Random-access byte source used by resumable blob adapters.
 *
 * A caller returns exactly the requested bytes. The adapter chooses the bound
 * and may repeat a range after response loss or session restart.
 */
export interface LibraryCoreMediaBlobSourceV1 {
  readonly byteLength: number;
  readRange(input: {
    readonly offset: number;
    readonly byteLength: number;
  }): Promise<Uint8Array>;
}

export interface LibraryCorePreparedMediaBlobV1 {
  readonly descriptor: LibraryCoreMediaBlobDescriptorV1;
  readonly source: LibraryCoreMediaBlobSourceV1;
}

export interface LibraryCoreMediaBlobAdapterV1 {
  putMediaBlob(
    blob: LibraryCorePreparedMediaBlobV1,
  ): Promise<{ readonly transportObjectId: string }>;
  verifyMediaBlob(
    reference: LibraryCoreMediaBlobReferenceV1,
  ): Promise<LibraryCoreMediaBlobDescriptorV1>;
}
