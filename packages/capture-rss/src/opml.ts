/**
 * OPML import/export for feed subscriptions
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser'
import type { OPMLDocument, OPMLOutline, OPMLFeed } from './types.js'
import type { RssFeed } from '@freed/shared'

// =============================================================================
// OPML Parsing
// =============================================================================

/**
 * Parse an OPML document and extract feed subscriptions
 * 
 * @param xml - OPML XML content
 * @returns Array of feeds extracted from the OPML
 */
export function parseOPML(xml: string): OPMLFeed[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_'
  })
  
  let doc: OPMLDocument
  try {
    doc = parser.parse(xml)
  } catch (error) {
    throw new Error(`Failed to parse OPML: ${error}`)
  }
  
  if (!doc.opml?.body?.outline) {
    throw new Error('Invalid OPML: missing body/outline')
  }
  
  const feeds: OPMLFeed[] = []
  const outlines = doc.opml.body.outline
  
  // Process outlines recursively
  function processOutline(outline: OPMLOutline, parentCategory?: string): void {
    // Determine category
    const category = outline['@_category'] || 
                     outline['@_text'] || 
                     outline['@_title'] || 
                     parentCategory
    
    // If this outline has an xmlUrl, it's a feed
    if (outline['@_xmlUrl']) {
      feeds.push({
        url: outline['@_xmlUrl'],
        title: outline['@_title'] || outline['@_text'] || 'Untitled Feed',
        siteUrl: outline['@_htmlUrl'],
        description: outline['@_description'],
        category: outline['@_type'] === 'rss' ? parentCategory : category
      })
    }
    
    // Process nested outlines (folders)
    if (outline.outline) {
      const children = Array.isArray(outline.outline) 
        ? outline.outline 
        : [outline.outline]
      
      for (const child of children) {
        // If parent has no xmlUrl, it's a folder - pass its name as category
        const folderCategory = !outline['@_xmlUrl'] 
          ? (outline['@_text'] || outline['@_title'] || category)
          : category
        processOutline(child, folderCategory)
      }
    }
  }
  
  // Process top-level outlines
  const topLevel = Array.isArray(outlines) ? outlines : [outlines]
  for (const outline of topLevel) {
    processOutline(outline)
  }
  
  return feeds
}

/**
 * Convert parsed OPML feeds to RssFeed objects
 */
export function opmlFeedsToRssFeeds(feeds: OPMLFeed[]): RssFeed[] {
  return feeds.map(feed => ({
    url: feed.url,
    title: feed.title,
    siteUrl: feed.siteUrl,
    enabled: true
  }))
}

// =============================================================================
// OPML Generation
// =============================================================================

/**
 * Generate an OPML document from feed subscriptions
 * 
 * @param feeds - Array of RssFeed objects
 * @param title - Title for the OPML document
 * @returns OPML XML string
 */
export function generateOPML(
  feeds: RssFeed[],
  title: string = 'FREED Feed Subscriptions'
): string {
  const outlines: OPMLOutline[] = feeds.map(feed => ({
    '@_type': 'rss',
    '@_text': feed.title,
    '@_title': feed.title,
    '@_xmlUrl': feed.url,
    '@_htmlUrl': feed.siteUrl
  }))
  
  const doc: OPMLDocument = {
    opml: {
      head: {
        title,
        dateCreated: new Date().toISOString()
      },
      body: {
        outline: outlines
      }
    }
  }
  
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: true,
    indentBy: '  '
  })
  
  // Add XML declaration
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + builder.build(doc)
}

// =============================================================================
// OPML Utilities
// =============================================================================

/**
 * Validate an OPML document
 */
export function validateOPML(xml: string): { valid: boolean; error?: string } {
  try {
    const feeds = parseOPML(xml)
    if (feeds.length === 0) {
      return { valid: false, error: 'No feeds found in OPML' }
    }
    return { valid: true }
  } catch (error) {
    return { 
      valid: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

/**
 * Get statistics about an OPML document
 */
export function getOPMLStats(xml: string): {
  feedCount: number
  categories: string[]
} {
  const feeds = parseOPML(xml)
  const categories = [...new Set(feeds.map(f => f.category).filter(Boolean))] as string[]
  
  return {
    feedCount: feeds.length,
    categories
  }
}

/**
 * Merge two OPML documents, deduplicating by URL
 */
export function mergeOPML(opml1: string, opml2: string): OPMLFeed[] {
  const feeds1 = parseOPML(opml1)
  const feeds2 = parseOPML(opml2)
  
  const urlSet = new Set<string>()
  const merged: OPMLFeed[] = []
  
  for (const feed of [...feeds1, ...feeds2]) {
    if (!urlSet.has(feed.url)) {
      urlSet.add(feed.url)
      merged.push(feed)
    }
  }
  
  return merged
}
