export const PWA_OPTIONAL_SURFACE_CACHE_NAME =
  "freed-optional-surfaces-v1";

export const PWA_OPTIONAL_SURFACE_ASSET_GLOB_IGNORES = Object.freeze([
  "**/MapView-*.js",
  "**/FriendsView-*.js",
  "**/friends-galaxy-*.js",
  "**/identity-galaxy-provider-field-*.js",
  "**/three.core-*.js",
  "**/maplibre-gl-*.js",
  "**/maplibre-gl-*.css",
]);

export const PWA_OPTIONAL_SURFACE_URL_PATTERN =
  /\/assets\/(?:MapView|FriendsView|friends-galaxy-|identity-galaxy-provider-field-|three\.core-|maplibre-gl-)[^/]*\.(?:js|css)$/;

export const PWA_OPTIONAL_SURFACE_FILENAME_PATTERN =
  /^(?:MapView|FriendsView|friends-galaxy-|identity-galaxy-provider-field-|three\.core-|maplibre-gl-)[^/]*\.(?:js|css)$/;
