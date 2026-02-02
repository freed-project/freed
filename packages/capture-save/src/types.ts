/**
 * URL metadata extracted from Open Graph and meta tags
 */
export interface UrlMetadata {
  url: string;
  title: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  author?: string;
  publishedAt?: number;
  type?: string;
}

/**
 * Extracted article content
 */
export interface ExtractedContent {
  /** Cleaned HTML content */
  html: string;

  /** Plain text version */
  text: string;

  /** Word count */
  wordCount: number;

  /** Estimated reading time in minutes */
  readingTime: number;

  /** Extracted title (may differ from og:title) */
  title?: string;

  /** Extracted author */
  author?: string;
}

/**
 * Options for saving a URL
 */
export interface SaveOptions {
  /** User-assigned tags */
  tags?: string[];

  /** Skip full content extraction (metadata only) */
  metadataOnly?: boolean;
}
