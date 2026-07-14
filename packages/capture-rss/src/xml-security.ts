export const SECURE_XML_ENTITY_OPTIONS = {
  enabled: true,
  maxEntitySize: 1_024,
  maxExpansionDepth: 8,
  maxTotalExpansions: 256,
  maxExpandedLength: 64 * 1_024,
  maxEntityCount: 32,
  appliesTo: "all" as const,
};
