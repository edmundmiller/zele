// OAuth2 authentication module for gtui.
// Multi-account support: tokens are stored in the Prisma-managed SQLite DB
// (accounts table) keyed by email. Supports login (browser OAuth), per-account
// token refresh, and helpers to get authenticated GmailClient instances for
// one or all accounts.
// Migration: on first use, if legacy ~/.gtui/tokens.json exists, it is
// imported into the DB and renamed to tokens.json.bak.

import http from 'node:http'
import readline from 'node:readline'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { OAuth2Client, type Credentials } from 'google-auth-library'
import fkill from 'fkill'
import { getPrisma } from './db.js'
import { GmailClient } from './gmail-client.js'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GTUI_DIR = path.join(os.homedir(), '.gtui')
const LEGACY_TOKENS_FILE = path.join(GTUI_DIR, 'tokens.json')

const CLIENT_ID =
  process.env.GTUI_CLIENT_ID ??
  '406964657835-aq8lmia8j95dhl1a2bvharmfk3t1hgqj.apps.googleusercontent.com'

const CLIENT_SECRET =
  process.env.GTUI_CLIENT_SECRET ?? 'kSmqreRr0qwBWJgbf5Y-PjSU'

const REDIRECT_PORT = 8089
const SCOPES = [
  'https://mail.google.com/',                       // Gmail (full)
  'https://www.googleapis.com/auth/calendar',       // Calendar (full)
  'https://www.googleapis.com/auth/userinfo.email', // Email identity
]

// ---------------------------------------------------------------------------
// OAuth2 client factory
// ---------------------------------------------------------------------------

export function createOAuth2Client(): OAuth2Client {
  return new OAuth2Client({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: `http://localhost:${REDIRECT_PORT}`,
  })
}

// ---------------------------------------------------------------------------
// Legacy migration: tokens.json → DB
// ---------------------------------------------------------------------------

async function migrateLegacyTokens(): Promise<void> {
  if (!fs.existsSync(LEGACY_TOKENS_FILE)) return

  const prisma = await getPrisma()
  const count = await prisma.accounts.count()
  if (count > 0) {
    // DB already has accounts — skip migration
    return
  }

  try {
    const data = fs.readFileSync(LEGACY_TOKENS_FILE, 'utf-8')
    const tokens: Credentials = JSON.parse(data)

    // We need to discover the email for this token
    const oauth2Client = createOAuth2Client()
    oauth2Client.setCredentials(tokens)

    // Refresh if expired
    if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
      const { credentials } = await oauth2Client.refreshAccessToken()
      oauth2Client.setCredentials(credentials)
      Object.assign(tokens, credentials)
    }

    const client = new GmailClient({ auth: oauth2Client })
    const profile = await client.getProfile()
    const email = profile.emailAddress

    await prisma.accounts.create({
      data: {
        email,
        tokens: JSON.stringify(tokens),
        updated_at: new Date(),
      },
    })

    // Rename old file so we don't migrate again
    fs.renameSync(LEGACY_TOKENS_FILE, LEGACY_TOKENS_FILE + '.bak')
    process.stderr.write(`Migrated legacy tokens for ${email}\n`)
  } catch (err) {
    process.stderr.write(`Warning: legacy token migration failed: ${err}\n`)
  }
}

// ---------------------------------------------------------------------------
// Browser OAuth flow
// ---------------------------------------------------------------------------

function extractCodeFromInput(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    const code = url.searchParams.get('code')
    if (code) return code
  } catch {
    // Not a URL
  }

  if (trimmed.length > 10 && !trimmed.includes(' ')) {
    return trimmed
  }

  return null
}

async function getAuthCodeFromBrowser(oauth2Client: OAuth2Client): Promise<string> {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  })

  await fkill(`:${REDIRECT_PORT}`, { force: true, silent: true }).catch(() => {})

  process.stderr.write('\n1. Open this URL to authorize:\n\n')
  process.stderr.write('   ' + authUrl + '\n\n')
  process.stderr.write('2. If running locally, the browser will redirect automatically.\n')
  process.stderr.write('   If running remotely, the redirect page won\'t load — that\'s fine.\n')
  process.stderr.write('   Just copy the URL from your browser\'s address bar and paste it below.\n\n')

  return new Promise((resolve, reject) => {
    let resolved = false
    let server: http.Server | null = null
    let rl: readline.Interface | null = null

    function finish(code: string) {
      if (resolved) return
      resolved = true
      server?.close()
      if (rl) {
        rl.close()
        process.stdin.unref()
      }
      resolve(code)
    }

    function fail(err: Error) {
      if (resolved) return
      resolved = true
      server?.close()
      rl?.close()
      reject(err)
    }

    server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${REDIRECT_PORT}`)
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(`<h1>Error: ${error}</h1>`)
        fail(new Error(error))
        return
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<h1>Success! You can close this window.</h1>')
        finish(code)
        return
      }

      res.writeHead(400, { 'Content-Type': 'text/html' })
      res.end('<h1>No authorization code received</h1>')
    })

    server.listen(REDIRECT_PORT)

    if (process.stdin.isTTY) {
      rl = readline.createInterface({ input: process.stdin, output: process.stderr })
      rl.question('Paste redirect URL here (or wait for auto-redirect): ', (answer) => {
        const code = extractCodeFromInput(answer)
        if (code) {
          finish(code)
        } else {
          process.stderr.write('Could not extract authorization code from input.\n')
          process.stderr.write('Waiting for browser redirect...\n')
        }
      })
    }
  })
}

// ---------------------------------------------------------------------------
// Login: browser OAuth → save tokens to DB
// ---------------------------------------------------------------------------

/**
 * Run the full browser OAuth flow and save the account to the DB.
 * Returns the email and an authenticated GmailClient.
 */
export async function login(): Promise<{ email: string; client: GmailClient }> {
  const oauth2Client = createOAuth2Client()

  const code = await getAuthCodeFromBrowser(oauth2Client)
  process.stderr.write('Got authorization code, exchanging for tokens...\n')

  const { tokens } = await oauth2Client.getToken(code)
  oauth2Client.setCredentials(tokens)

  // Discover email
  const client = new GmailClient({ auth: oauth2Client })
  const profile = await client.getProfile()
  const email = profile.emailAddress

  // Upsert account in DB
  const prisma = await getPrisma()
  await prisma.accounts.upsert({
    where: { email },
    create: { email, tokens: JSON.stringify(tokens), updated_at: new Date() },
    update: { tokens: JSON.stringify(tokens), updated_at: new Date() },
  })

  return { email, client }
}

// ---------------------------------------------------------------------------
// Logout: remove account from DB
// ---------------------------------------------------------------------------

export async function logout(email: string): Promise<void> {
  const prisma = await getPrisma()
  await prisma.accounts.delete({ where: { email } })
}

// ---------------------------------------------------------------------------
// Account listing
// ---------------------------------------------------------------------------

export async function listAccounts(): Promise<string[]> {
  await migrateLegacyTokens()
  const prisma = await getPrisma()
  const rows = await prisma.accounts.findMany({ select: { email: true } })
  return rows.map((r) => r.email)
}

// ---------------------------------------------------------------------------
// Get authenticated clients
// ---------------------------------------------------------------------------

/**
 * Create an authenticated OAuth2Client for a known account.
 * Loads tokens from DB, refreshes if expired, saves refreshed tokens back.
 */
async function authenticateAccount(email: string): Promise<OAuth2Client> {
  const prisma = await getPrisma()
  const row = await prisma.accounts.findUnique({ where: { email } })
  if (!row) {
    throw new Error(`No account found for ${email}. Run: gtui auth login`)
  }

  const tokens: Credentials = JSON.parse(row.tokens)
  const oauth2Client = createOAuth2Client()
  oauth2Client.setCredentials(tokens)

  // Refresh if expired — merge to preserve refresh_token which Google
  // often omits from refresh responses
  if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
    process.stderr.write(`Token expired for ${email}, refreshing...\n`)
    const { credentials } = await oauth2Client.refreshAccessToken()
    const merged = { ...tokens, ...credentials }
    oauth2Client.setCredentials(merged)
    await prisma.accounts.update({
      where: { email },
      data: { tokens: JSON.stringify(merged), updated_at: new Date() },
    })
  }

  return oauth2Client
}

/**
 * Get authenticated GmailClient instances for all accounts (or filtered by email list).
 * If no accounts are registered, throws with a helpful message.
 */
export async function getClients(
  accounts?: string[],
): Promise<Array<{ email: string; client: GmailClient }>> {
  await migrateLegacyTokens()

  const allEmails = await listAccounts()
  if (allEmails.length === 0) {
    throw new Error('No accounts registered. Run: gtui auth login')
  }

  const emails = accounts && accounts.length > 0
    ? allEmails.filter((e) => accounts.includes(e))
    : allEmails

  if (emails.length === 0) {
    const available = allEmails.join(', ')
    throw new Error(`No matching accounts. Available: ${available}`)
  }

  const results = await Promise.all(
    emails.map(async (email) => {
      const auth = await authenticateAccount(email)
      return { email, client: new GmailClient({ auth }) }
    }),
  )

  return results
}

/**
 * Get a single authenticated GmailClient. Errors if multiple accounts exist
 * and no --account filter was provided.
 */
export async function getClient(
  accounts?: string[],
): Promise<{ email: string; client: GmailClient }> {
  const clients = await getClients(accounts)
  if (clients.length === 1) {
    return clients[0]!
  }

  const emails = clients.map((c) => c.email).join('\n  ')
  throw new Error(
    `Multiple accounts matched. Specify --account:\n  ${emails}`,
  )
}

// ---------------------------------------------------------------------------
// Auth status (for auth status command)
// ---------------------------------------------------------------------------

export interface AuthStatus {
  email: string
  expiresAt?: Date
}

export async function getAuthStatuses(): Promise<AuthStatus[]> {
  await migrateLegacyTokens()
  const prisma = await getPrisma()
  const rows = await prisma.accounts.findMany()

  return rows.map((row) => {
    const tokens: Credentials = JSON.parse(row.tokens)
    return {
      email: row.email,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
    }
  })
}
