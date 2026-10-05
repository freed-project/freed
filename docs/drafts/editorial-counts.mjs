// Read-only checkpoint projection. Run with the repository-pinned Node from repo root.
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); } catch (error) {
    if (specifier.startsWith(".") && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
    throw error;
  }
} });
const { SAMPLE_CHARACTER_ARCS } = await import("../../packages/shared/src/sample-character-arcs.ts");
const { SAMPLE_EDITORIAL_COUNTS } = await import("../../packages/shared/src/sample-editorial-data.ts");
const { SAMPLE_CORPUS_MEDIA } = await import("../../packages/shared/src/sample-corpus.ts");
const episodes = SAMPLE_CHARACTER_ARCS.flatMap(arc => arc.episodes);
const formats = {};
for (const arc of SAMPLE_CHARACTER_ARCS) for (const episode of arc.episodes) {
  if (!episode.mediaSha1) continue;
  const key = `${episode.platform ?? arc.platform}:${episode.contentType === "story" ? "story" : "regular"}`;
  formats[key] = (formats[key] ?? 0) + 1;
}
console.log(JSON.stringify({ ...SAMPLE_EDITORIAL_COUNTS, authored: episodes.length,
  excluded: episodes.filter(episode => !episode.mediaSha1).length,
  editorialIdentities: SAMPLE_CHARACTER_ARCS.length, catalog: SAMPLE_CORPUS_MEDIA.length, formats }, null, 2));
