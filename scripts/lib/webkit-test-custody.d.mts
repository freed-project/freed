export const WEBKIT_TEST_MASTER_KEY: string;
export function requirePrivateSyntheticProfile(profileRoot: string): void;
export function prepareSyntheticMasterKey(profileRoot: string, reopening?: boolean): string;
export function prepareWebKitTestCustody(profileRoot: string, browserLauncher: string, reopening?: boolean): {
  launchOptions: { executablePath: string; env: Record<string, string> } | { executablePath?: undefined; env?: undefined };
  verifyLoaded(): void;
};
