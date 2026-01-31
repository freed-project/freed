/**
 * capture-x OpenClaw skill
 * 
 * Background X/Twitter feed capture for FREED
 */

import { homedir } from 'os'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import * as A from '@automerge/automerge'
import {
  XClient,
  extractCookies,
  extractCookiesAuto,
  parseCookieString,
  tweetsToFeedItems,
  deduplicateFeedItems,
  type SupportedBrowser
} from '@freed/capture-x'
import {
  type FreedDoc,
  type FeedItem,
  createEmptyDoc,
  addFeedItem,
  hasFeedItem,
  getFeedItemsSorted
} from '@freed/shared'

// =============================================================================
// Configuration
// =============================================================================

interface Config {
  'capture-x': {
    pollInterval: number
    browser: SupportedBrowser
    maxItemsPerPoll: number
  }
}

interface State {
  running: boolean
  lastCapture: number | null
  itemsCaptured: number
  errors: string[]
}

const FREED_DIR = join(homedir(), '.freed')
const CONFIG_PATH = join(FREED_DIR, 'config.json')
const DATA_DIR = join(FREED_DIR, 'data')
const DOC_PATH = join(DATA_DIR, 'feed.automerge')
const STATE_PATH = join(DATA_DIR, 'capture-x-state.json')

// =============================================================================
// Helpers
// =============================================================================

function ensureDirs(): void {
  if (!existsSync(FREED_DIR)) mkdirSync(FREED_DIR, { recursive: true })
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

function loadConfig(): Config {
  ensureDirs()
  
  if (existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
    } catch {
      // Fall through to default
    }
  }
  
  return {
    'capture-x': {
      pollInterval: 5,
      browser: 'chrome',
      maxItemsPerPoll: 50
    }
  }
}

function saveConfig(config: Config): void {
  ensureDirs()
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

function loadState(): State {
  ensureDirs()
  
  if (existsSync(STATE_PATH)) {
    try {
      return JSON.parse(readFileSync(STATE_PATH, 'utf-8'))
    } catch {
      // Fall through to default
    }
  }
  
  return {
    running: false,
    lastCapture: null,
    itemsCaptured: 0,
    errors: []
  }
}

function saveState(state: State): void {
  ensureDirs()
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
}

function loadDoc(): FreedDoc {
  ensureDirs()
  
  if (existsSync(DOC_PATH)) {
    try {
      const binary = readFileSync(DOC_PATH)
      return A.load<FreedDoc>(binary)
    } catch {
      console.log('Creating new document...')
    }
  }
  
  return createEmptyDoc()
}

function saveDoc(doc: FreedDoc): void {
  ensureDirs()
  const binary = A.save(doc)
  writeFileSync(DOC_PATH, binary)
}

// =============================================================================
// Capture Logic
// =============================================================================

async function captureTimeline(): Promise<{ added: number; total: number }> {
  const config = loadConfig()
  const state = loadState()
  let doc = loadDoc()
  
  // Get cookies
  const result = await extractCookiesAuto()
  if (!result) {
    throw new Error('Could not extract cookies. Make sure you are logged into X in your browser.')
  }
  
  console.log(`Using cookies from ${result.browser}`)
  
  // Create client and fetch timeline
  const client = new XClient(result.cookies)
  const timeline = await client.getHomeLatestTimeline(undefined, config['capture-x'].maxItemsPerPoll)
  
  // Convert to feed items
  const feedItems = tweetsToFeedItems(timeline.tweets)
  const uniqueItems = deduplicateFeedItems(feedItems)
  
  // Add new items to document
  let added = 0
  for (const item of uniqueItems) {
    if (!hasFeedItem(doc, item.globalId)) {
      doc = A.change(doc, d => addFeedItem(d, item))
      added++
    }
  }
  
  // Save document
  saveDoc(doc)
  
  // Update state
  state.lastCapture = Date.now()
  state.itemsCaptured += added
  saveState(state)
  
  return { added, total: Object.keys(doc.feedItems).length }
}

// =============================================================================
// Commands
// =============================================================================

async function start(): Promise<void> {
  const state = loadState()
  
  if (state.running) {
    console.log('Capture is already running.')
    return
  }
  
  state.running = true
  saveState(state)
  
  console.log('Starting X capture...')
  
  // Do initial capture
  try {
    const result = await captureTimeline()
    console.log(`Initial capture complete. Added ${result.added} new items (${result.total} total).`)
  } catch (error) {
    console.error('Initial capture failed:', error)
    state.errors.push(`${new Date().toISOString()}: ${error}`)
    saveState(state)
  }
  
  // Note: In a real implementation, this would set up a recurring job
  // For now, we just do a single capture
  // OpenClaw would handle the scheduling
  
  console.log('Capture started. Run `capture-x sync` to capture manually.')
}

async function stop(): Promise<void> {
  const state = loadState()
  state.running = false
  saveState(state)
  console.log('Capture stopped.')
}

async function status(): Promise<void> {
  const state = loadState()
  const doc = loadDoc()
  const config = loadConfig()
  
  console.log('\n=== capture-x Status ===\n')
  console.log(`Running: ${state.running ? 'Yes' : 'No'}`)
  console.log(`Last capture: ${state.lastCapture ? new Date(state.lastCapture).toLocaleString() : 'Never'}`)
  console.log(`Items captured: ${state.itemsCaptured}`)
  console.log(`Total items in feed: ${Object.keys(doc.feedItems).length}`)
  console.log(`Poll interval: ${config['capture-x'].pollInterval} minutes`)
  console.log(`Browser: ${config['capture-x'].browser}`)
  
  if (state.errors.length > 0) {
    console.log('\nRecent errors:')
    for (const error of state.errors.slice(-5)) {
      console.log(`  - ${error}`)
    }
  }
}

async function sync(): Promise<void> {
  console.log('Syncing X timeline...')
  
  try {
    const result = await captureTimeline()
    console.log(`Sync complete. Added ${result.added} new items (${result.total} total).`)
  } catch (error) {
    console.error('Sync failed:', error)
    const state = loadState()
    state.errors.push(`${new Date().toISOString()}: ${error}`)
    saveState(state)
  }
}

async function recent(count: number = 10): Promise<void> {
  const doc = loadDoc()
  const items = getFeedItemsSorted(doc).slice(0, count)
  
  console.log(`\n=== ${items.length} Most Recent Items ===\n`)
  
  for (const item of items) {
    const date = new Date(item.publishedAt).toLocaleString()
    const text = item.content.text?.slice(0, 100) || '(no text)'
    console.log(`[@${item.author.handle}] ${date}`)
    console.log(`  ${text}${text.length >= 100 ? '...' : ''}`)
    console.log()
  }
}

async function setCookies(cookieString: string): Promise<void> {
  const cookies = parseCookieString(cookieString)
  
  if (!cookies) {
    console.error('Invalid cookie string. Expected format: "ct0=xxx; auth_token=yyy"')
    process.exit(1)
  }
  
  // Store cookies for later use
  const config = loadConfig()
  writeFileSync(join(FREED_DIR, 'x-cookies.json'), JSON.stringify(cookies, null, 2))
  
  console.log('Cookies saved successfully.')
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]
  
  switch (command) {
    case 'start':
      await start()
      break
    case 'stop':
      await stop()
      break
    case 'status':
      await status()
      break
    case 'sync':
      await sync()
      break
    case 'recent':
      await recent(parseInt(args[1]) || 10)
      break
    case 'set-cookies':
      if (!args[1]) {
        console.error('Usage: capture-x set-cookies "ct0=xxx; auth_token=yyy"')
        process.exit(1)
      }
      await setCookies(args[1])
      break
    default:
      console.log(`
capture-x - X/Twitter feed capture for FREED

Commands:
  start         Start background capture
  stop          Stop background capture
  status        Show capture status
  sync          Manual sync (fetch new posts now)
  recent [n]    Show n most recent items (default: 10)
  set-cookies   Manually set auth cookies

Examples:
  capture-x start
  capture-x sync
  capture-x recent 20
  capture-x set-cookies "ct0=xxx; auth_token=yyy"
`)
  }
}

main().catch(console.error)
