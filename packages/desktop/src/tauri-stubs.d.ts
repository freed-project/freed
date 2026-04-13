/**
 * Ambient fallback declarations for @tauri-apps/* and desktop-only packages.
 *
 * TypeScript uses these ONLY when the real packages are not found via
 * node_modules (e.g. plain tsc runs, IDE without bun). In a proper bun/npm
 * install, the real packages take precedence and these are ignored.
 *
 * Signatures are kept minimal -- just the exports actually used in this
 * package, with types compatible with the real declarations.
 */

declare module "@tauri-apps/api/core" {
  export function invoke<T = void>(
    cmd: string,
    args?: Record<string, unknown>,
  ): Promise<T>;
  export function isTauri(): boolean;
}

declare module "@tauri-apps/api/event" {
  export type UnlistenFn = () => void;
  export interface Event<T> {
    event: string;
    id: number;
    payload: T;
    windowLabel: string;
  }
  export type EventCallback<T> = (event: Event<T>) => void;
  export function listen<T>(
    event: string,
    handler: EventCallback<T>,
  ): Promise<UnlistenFn>;
  export function emit(event: string, payload?: unknown): Promise<void>;
}

declare module "@tauri-apps/api/path" {
  export function appDataDir(): Promise<string>;
}

declare module "@tauri-apps/plugin-process" {
  export function relaunch(): Promise<never>;
  export function exit(code?: number): Promise<void>;
}

declare module "@tauri-apps/plugin-shell" {
  export function open(path: string, openWith?: string): Promise<void>;
}

declare module "@tauri-apps/plugin-updater" {
  export type DownloadEvent =
    | { event: "Started"; data: { contentLength?: number } }
    | { event: "Progress"; data: { chunkLength: number } }
    | { event: "Finished" };

  export interface Update {
    available: boolean;
    currentVersion: string;
    version: string;
    date?: string;
    /** Release notes body from the update manifest. */
    body?: string;
    rawJson: Record<string, unknown>;
    download(
      onEvent?: (progress: DownloadEvent) => void,
    ): Promise<void>;
    install(): Promise<void>;
    downloadAndInstall(
      onEvent?: (progress: DownloadEvent) => void,
    ): Promise<void>;
    close(): Promise<void>;
  }

  export interface CheckOptions {
    target?: string;
    timeout?: number;
    headers?: Record<string, string>;
  }

  export function check(options?: CheckOptions): Promise<Update | null>;
}

declare module "@tauri-apps/plugin-fs" {
  export interface DirEntry {
    name: string;
    isFile: boolean;
    isDirectory: boolean;
    isSymlink: boolean;
  }

  export function readFile(path: string): Promise<Uint8Array>;
  export function readTextFile(path: string): Promise<string>;
  export function writeFile(
    path: string,
    contents: Uint8Array | string,
  ): Promise<void>;
  export function writeTextFile(
    path: string,
    contents: string,
  ): Promise<void>;
  export function remove(path: string): Promise<void>;
  export function exists(path: string): Promise<boolean>;
  export function mkdir(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<void>;
  export function readDir(path: string): Promise<DirEntry[]>;
}

declare module "@tauri-apps/plugin-store" {
  export interface StoreOptions {
    defaults?: Record<string, unknown>;
    autoSave?: boolean | number;
  }
  export class Store {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
    save(): Promise<void>;
  }
  /** Create or load a persisted key-value store at the given path. */
  export function load(path: string, options?: StoreOptions): Promise<Store>;
}

declare module "react-qr-code" {
  import * as React from "react";
  export interface QRCodeProps {
    value: string;
    size?: number;
    bgColor?: string;
    fgColor?: string;
    level?: "L" | "M" | "Q" | "H";
    style?: React.CSSProperties;
    className?: string;
    title?: string;
    viewBox?: string;
  }
  const QRCode: React.FC<QRCodeProps>;
  export default QRCode;
}
