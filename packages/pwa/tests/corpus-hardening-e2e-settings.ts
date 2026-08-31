export const pwaCorpusHardeningPort = Number(
  process.env.PWA_CORPUS_HARDENING_PORT ?? "1424",
);

if (
  !Number.isSafeInteger(pwaCorpusHardeningPort) ||
  pwaCorpusHardeningPort < 1 ||
  pwaCorpusHardeningPort > 65_535
) {
  throw new Error("PWA_CORPUS_HARDENING_PORT must be a valid TCP port");
}

export const pwaCorpusHardeningBaseUrl = `http://127.0.0.1:${pwaCorpusHardeningPort.toLocaleString(
  "en-US",
  {
    useGrouping: false,
  },
)}`;
