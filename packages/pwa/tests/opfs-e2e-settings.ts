export const pwaOpfsE2ePort = Number(
  process.env.PWA_OPFS_E2E_PORT ?? "1423",
);
if (
  !Number.isSafeInteger(pwaOpfsE2ePort) ||
  pwaOpfsE2ePort < 1 ||
  pwaOpfsE2ePort > 65_535
) {
  throw new Error("PWA_OPFS_E2E_PORT must be a valid TCP port");
}

export const pwaOpfsE2eBaseUrl =
  `http://127.0.0.1:${pwaOpfsE2ePort.toLocaleString("en-US", {
    useGrouping: false,
  })}`;
