import * as fs from "fs";
import * as path from "path";
import type { StorageAdapter } from "../types.js";

/**
 * Filesystem storage adapter for Node/Bun/Desktop
 */
export class FilesystemStorage implements StorageAdapter {
  private filePath: string;

  constructor(filePath?: string) {
    const configDir = path.join(process.env.HOME || "~", ".freed");
    this.filePath = filePath || path.join(configDir, "feed.automerge");

    // Ensure directory exists
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async load(): Promise<Uint8Array | null> {
    if (!fs.existsSync(this.filePath)) {
      return null;
    }
    const buffer = fs.readFileSync(this.filePath);
    return new Uint8Array(buffer);
  }

  async save(data: Uint8Array): Promise<void> {
    fs.writeFileSync(this.filePath, data);
  }

  getPath(): string {
    return this.filePath;
  }
}
