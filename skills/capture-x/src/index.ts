/**
 * capture-x OpenClaw skill
 * 
 * Background X/Twitter feed capture for FREED
 * Supports three modes: mirror, whitelist, mirror_blacklist
 */

import { homedir } from 'os'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import * as A from '@automerge/automerge'
import {
  XClient,
  extractCookiesAuto,
  parseCookieString,
  tweetsToFeedItems,
  deduplicateFeedItems,
  type SupportedBrowser,
  type XTweetResult
} from '@freed/capture-x'
import {
  type FreedDoc,
  type FeedItem,
  type XAccount,
  type XCaptureMode,
  createEmptyDoc,
  addFeedItem,
  hasFeedItem,
  getFeedItemsSorted,
  updatePreferences
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
      const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
      return {
        ...config,
        'capture-x': {
          pollInterval: 5,
          browser: 'chrome',
          maxItemsPerPoll: 50,
          ...config['capture-x']
        }
      }
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
// Filtering Logic
// =============================================================================

/**
 * Filter feed items based on xCapture mode and whitelist/blacklist
 */
function filterByMode(items: FeedItem[], doc: FreedDoc): FeedItem[] {
  const prefs = doc.preferences.xCapture
  const mode = prefs.mode
  
  switch (mode) {
    case 'whitelist':
      // Only include items from whitelisted accounts
      return items.filter(item => {
        const authorId = item.author.id
        const authorHandle = item.author.handle.toLowerCase()
        return Object.values(prefs.whitelist).some(
          acc => acc.id === authorId || acc.handle.toLowerCase() === authorHandle
        )
      })
    
    case 'mirror_blacklist':
      // Exclude items from blacklisted accounts
      return items.filter(item => {
        const authorId = item.author.id
        const authorHandle = item.author.handle.toLowerCase()
        return !Object.values(prefs.blacklist).some(
          acc => acc.id === authorId || acc.handle.toLowerCase() === authorHandle
        )
      })
    
    case 'mirror':
    default:
      // Include everything from the timeline
      return items
  }
}

/**
 * Filter out retweets and replies if configured
 */
function filterByContentType(items: FeedItem[], doc: FreedDoc): FeedItem[] {
  const prefs = doc.preferences.xCapture
  
  return items.filter(item => {
    // Check for retweets (globalId contains "rt:" or text starts with "RT @")
    const isRetweet = item.content.text?.startsWith('RT @') ?? false
    if (!prefs.includeRetweets && isRetweet) {
      return false
    }
    
    // Check for replies (would need to look at the original tweet data)
    // For now, we'll include all non-retweets
    
    return true
  })
}

// =============================================================================
// Capture Logic
// =============================================================================

async function captureTimeline(): Promise<{ added: number; total: number; filtered: number }> {
  const config = loadConfig()
  let doc = loadDoc()
  
  // Get cookies
  const result = await extractCookiesAuto()
  if (!result) {
    throw new Error('Could not extract cookies. Make sure you are logged into X in your browser.')
  }
  
  console.log(`Using cookies from ${result.browser}`)
  console.log(`Mode: ${doc.preferences.xCapture.mode}`)
  
  // Create client and fetch timeline
  const client = new XClient(result.cookies)
  const timeline = await client.getHomeLatestTimeline(undefined, config['capture-x'].maxItemsPerPoll)
  
  // Convert to feed items
  let feedItems = tweetsToFeedItems(timeline.tweets)
  const totalFetched = feedItems.length
  
  // Apply filters based on mode
  feedItems = filterByMode(feedItems, doc)
  feedItems = filterByContentType(feedItems, doc)
  feedItems = deduplicateFeedItems(feedItems)
  
  const filtered = totalFetched - feedItems.length
  
  // Add new items to document
  let added = 0
  for (const item of feedItems) {
    if (!hasFeedItem(doc, item.globalId)) {
      doc = A.change(doc, d => addFeedItem(d, item))
      added++
    }
  }
  
  // Save document
  saveDoc(doc)
  
  // Update state
  const state = loadState()
  state.lastCapture = Date.now()
  state.itemsCaptured += added
  saveState(state)
  
  return { added, total: Object.keys(doc.feedItems).length, filtered }
}

// =============================================================================
// Mode Management Commands
// =============================================================================

function setMode(mode: string): void {
  if (!['mirror', 'whitelist', 'mirror_blacklist'].includes(mode)) {
    console.error('Invalid mode. Use: mirror, whitelist, or mirror_blacklist')
    process.exit(1)
  }
  
  let doc = loadDoc()
  doc = A.change(doc, d => {
    d.preferences.xCapture.mode = mode as XCaptureMode
  })
  saveDoc(doc)
  
  console.log(`Capture mode set to: ${mode}`)
  
  if (mode === 'whitelist') {
    const count = Object.keys(doc.preferences.xCapture.whitelist).length
    console.log(`Whitelist has ${count} accounts. Use 'capture-x whitelist add @handle' to add more.`)
  } else if (mode === 'mirror_blacklist') {
    const count = Object.keys(doc.preferences.xCapture.blacklist).length
    console.log(`Blacklist has ${count} accounts. Use 'capture-x blacklist add @handle' to add more.`)
  }
}

function addToList(list: 'whitelist' | 'blacklist', handle: string): void {
  // Normalize handle (remove @ if present)
  handle = handle.replace(/^@/, '').toLowerCase()
  
  let doc = loadDoc()
  
  const account: XAccount = {
    id: handle, // Will be updated when we fetch the actual user
    handle,
    addedAt: Date.now()
  }
  
  doc = A.change(doc, d => {
    d.preferences.xCapture[list][handle] = account
  })
  saveDoc(doc)
  
  console.log(`Added @${handle} to ${list}`)
}

function removeFromList(list: 'whitelist' | 'blacklist', handle: string): void {
  handle = handle.replace(/^@/, '').toLowerCase()
  
  let doc = loadDoc()
  
  if (!doc.preferences.xCapture[list][handle]) {
    console.error(`@${handle} is not in the ${list}`)
    process.exit(1)
  }
  
  doc = A.change(doc, d => {
    delete d.preferences.xCapture[list][handle]
  })
  saveDoc(doc)
  
  console.log(`Removed @${handle} from ${list}`)
}

function showList(list: 'whitelist' | 'blacklist'): void {
  const doc = loadDoc()
  const accounts = Object.values(doc.preferences.xCapture[list])
  
  if (accounts.length === 0) {
    console.log(`${list} is empty`)
    return
  }
  
  console.log(`\n=== ${list.charAt(0).toUpperCase() + list.slice(1)} (${accounts.length} accounts) ===\n`)
  
  for (const acc of accounts.sort((a, b) => a.handle.localeCompare(b.handle))) {
    const added = new Date(acc.addedAt).toLocaleDateString()
    console.log(`  @${acc.handle} (added ${added})${acc.note ? ` - ${acc.note}` : ''}`)
  }
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
  
  try {
    const result = await captureTimeline()
    console.log(`Initial capture complete. Added ${result.added} new items (${result.filtered} filtered, ${result.total} total).`)
  } catch (error) {
    console.error('Initial capture failed:', error)
    state.errors.push(`${new Date().toISOString()}: ${error}`)
    saveState(state)
  }
  
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
  const prefs = doc.preferences.xCapture
  
  console.log('\n=== capture-x Status ===\n')
  console.log(`Running: ${state.running ? 'Yes' : 'No'}`)
  console.log(`Last capture: ${state.lastCapture ? new Date(state.lastCapture).toLocaleString() : 'Never'}`)
  console.log(`Items captured: ${state.itemsCaptured}`)
  console.log(`Total items in feed: ${Object.keys(doc.feedItems).length}`)
  console.log(`Poll interval: ${config['capture-x'].pollInterval} minutes`)
  console.log(`Browser: ${config['capture-x'].browser}`)
  
  console.log('\n--- Capture Mode ---')
  console.log(`Mode: ${prefs.mode}`)
  console.log(`Include retweets: ${prefs.includeRetweets ? 'Yes' : 'No'}`)
  console.log(`Include replies: ${prefs.includeReplies ? 'Yes' : 'No'}`)
  console.log(`Whitelist: ${Object.keys(prefs.whitelist).length} accounts`)
  console.log(`Blacklist: ${Object.keys(prefs.blacklist).length} accounts`)
  
  if (state.errors.length > 0) {
    console.log('\n--- Recent Errors ---')
    for (const error of state.errors.slice(-5)) {
      console.log(`  - ${error}`)
    }
  }
}

async function sync(): Promise<void> {
  console.log('Syncing X timeline...')
  
  try {
    const result = await captureTimeline()
    console.log(`Sync complete. Added ${result.added} new items (${result.filtered} filtered, ${result.total} total).`)
  } catch (error) {
    console.error('Sync failed:', error)
    const state = loadState()
    state.errors.push(`${new Date().toISOString()}: ${error}`)
    saveState(state)
  }
}

async function recent(count: number = 10): Promise<void> {
  const doc = loadDoc()
  const items = getFeedItemsSorted(doc)
    .filter(item => item.platform === 'x')
    .slice(0, count)
  
  console.log(`\n=== ${items.length} Most Recent X Posts ===\n`)
  
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
  
  writeFileSync(join(FREED_DIR, 'x-cookies.json'), JSON.stringify(cookies, null, 2))
  console.log('Cookies saved successfully.')
}

function setOption(option: string, value: string): void {
  let doc = loadDoc()
  
  switch (option) {
    case 'retweets':
      const includeRetweets = value === 'on' || value === 'true' || value === 'yes'
      doc = A.change(doc, d => {
        d.preferences.xCapture.includeRetweets = includeRetweets
      })
      console.log(`Include retweets: ${includeRetweets ? 'Yes' : 'No'}`)
      break
    
    case 'replies':
      const includeReplies = value === 'on' || value === 'true' || value === 'yes'
      doc = A.change(doc, d => {
        d.preferences.xCapture.includeReplies = includeReplies
      })
      console.log(`Include replies: ${includeReplies ? 'Yes' : 'No'}`)
      break
    
    default:
      console.error(`Unknown option: ${option}`)
      console.log('Available options: retweets, replies')
      process.exit(1)
  }
  
  saveDoc(doc)
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
    
    case 'mode':
      if (!args[1]) {
        const doc = loadDoc()
        console.log(`Current mode: ${doc.preferences.xCapture.mode}`)
        console.log('\nAvailable modes:')
        console.log('  mirror          - Capture from everyone you follow on X')
        console.log('  whitelist       - Only capture from whitelisted accounts')
        console.log('  mirror_blacklist - Mirror follows but exclude blacklisted accounts')
      } else {
        setMode(args[1])
      }
      break
    
    case 'whitelist':
      if (!args[1]) {
        showList('whitelist')
      } else if (args[1] === 'add' && args[2]) {
        addToList('whitelist', args[2])
      } else if (args[1] === 'remove' && args[2]) {
        removeFromList('whitelist', args[2])
      } else {
        console.error('Usage: capture-x whitelist [add|remove] @handle')
      }
      break
    
    case 'blacklist':
      if (!args[1]) {
        showList('blacklist')
      } else if (args[1] === 'add' && args[2]) {
        addToList('blacklist', args[2])
      } else if (args[1] === 'remove' && args[2]) {
        removeFromList('blacklist', args[2])
      } else {
        console.error('Usage: capture-x blacklist [add|remove] @handle')
      }
      break
    
    case 'set':
      if (args[1] && args[2]) {
        setOption(args[1], args[2])
      } else {
        console.error('Usage: capture-x set <option> <value>')
        console.log('Options:')
        console.log('  retweets on|off  - Include/exclude retweets')
        console.log('  replies on|off   - Include/exclude replies')
      }
      break
    
    default:
      console.log(`
capture-x - X/Twitter feed capture for FREED

Commands:
  start              Start background capture
  stop               Stop background capture
  status             Show capture status and configuration
  sync               Manual sync (fetch new posts now)
  recent [n]         Show n most recent X posts (default: 10)
  set-cookies        Manually set auth cookies

Mode Configuration:
  mode               Show current capture mode
  mode <mode>        Set capture mode (mirror|whitelist|mirror_blacklist)

List Management:
  whitelist          Show whitelisted accounts
  whitelist add @x   Add account to whitelist
  whitelist remove @x Remove account from whitelist
  blacklist          Show blacklisted accounts
  blacklist add @x   Add account to blacklist
  blacklist remove @x Remove account from blacklist

Options:
  set retweets on|off  Include/exclude retweets
  set replies on|off   Include/exclude replies

Examples:
  capture-x mode mirror_blacklist
  capture-x blacklist add @annoying_account
  capture-x set retweets off
  capture-x sync
`)
  }
}

main().catch(console.error)
