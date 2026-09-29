import { LibraryServiceFailure } from "./contracts.js";

/** Show PKCE consent only on the invoking operator's interactive terminal. */
export function createLinuxDriveConsentPresenter(output: {
  readonly isTTY?: boolean;
  write(text: string): unknown;
}): (authorizationUrl: string) => Promise<void> {
  return async (authorizationUrl) => {
    if (
      output.isTTY !== true ||
      Buffer.byteLength(authorizationUrl, "utf8") > 8_192
    ) {
      throw new LibraryServiceFailure("drive_auth_failed");
    }
    let url: URL;
    let redirect: URL;
    try {
      url = new URL(authorizationUrl);
      redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
    } catch {
      throw new LibraryServiceFailure("drive_auth_failed");
    }
    if (
      url.origin !== "https://accounts.google.com" ||
      url.pathname !== "/o/oauth2/v2/auth" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      redirect.protocol !== "http:" ||
      redirect.hostname !== "127.0.0.1" ||
      redirect.port === "" ||
      redirect.pathname !== "/callback" ||
      redirect.username !== "" ||
      redirect.password !== "" ||
      redirect.search !== "" ||
      redirect.hash !== "" ||
      url.searchParams.get("response_type") !== "code" ||
      url.searchParams.get("code_challenge_method") !== "S256" ||
      !url.searchParams.get("code_challenge") ||
      !url.searchParams.get("state")
    ) {
      throw new LibraryServiceFailure("drive_auth_failed");
    }
    const allowed = new Set([
      "client_id",
      "redirect_uri",
      "response_type",
      "scope",
      "include_granted_scopes",
      "code_challenge",
      "code_challenge_method",
      "access_type",
      "prompt",
      "state",
    ]);
    const keys = [...url.searchParams.keys()];
    if (
      keys.length !== allowed.size ||
      new Set(keys).size !== keys.length ||
      keys.some((key) => !allowed.has(key))
    ) {
      throw new LibraryServiceFailure("drive_auth_failed");
    }
    // stderr preserves the CLI's single final JSON report on stdout. A pipe or
    // redirected log never receives the temporary consent URL.
    output.write(
      `Google Drive consent requires a browser. Open the URL below on this host.\n` +
        `For a remote host, first forward local port ${redirect.port} to 127.0.0.1:${redirect.port} on this host, then open the URL locally.\n` +
        `This consent attempt expires after five minutes.\n${url.href}\n`,
    );
  };
}
