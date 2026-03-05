/**
 * Mock for @tauri-apps/api/path used when VITE_TEST_TAURI=1.
 */

export async function appDataDir(): Promise<string> {
  return "/mock/app-data";
}

export async function appLocalDataDir(): Promise<string> {
  return "/mock/app-local-data";
}

export async function documentDir(): Promise<string> {
  return "/mock/documents";
}

export async function homeDir(): Promise<string> {
  return "/mock/home";
}

export async function join(...paths: string[]): Promise<string> {
  return paths.join("/").replace(/\/+/g, "/");
}

export async function resolve(...paths: string[]): Promise<string> {
  return paths.join("/").replace(/\/+/g, "/");
}
