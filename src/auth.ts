// OAuth2 authentication module for gtui.
// Handles browser-based OAuth flow, token persistence in ~/.gtui/tokens.json,
// and automatic token refresh on expiry.
// Refactored from the original index.ts demo into a reusable module.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { OAuth2Client } from 'google-auth-library'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GTUI_DIR = path.join(os.homedir(), '.gtui')
const TOKENS_FILE = path.join(GTUI_DIR, 'tokens.json')

const CLIENT_ID =
  process.env.GTUI_CLIENT_ID ??
  '406964657835-aq8lmia8j95dhl1a2bvharmfk3t1hgqj.apps.googleusercontent.com'

const CLIENT_SECRET =
  process.env.GTUI_CLIENT_SECRET ?? 'kSmqreRr0qwBWJgbf5Y-PjSU'

const REDIRECT_PORT = 8089
const SCOPE = 'https://mail.google.com/'

// ---------------------------------------------------------------------------
// OAuth2 client
// ---------------------------------------------------------------------------

export function createOAuth2Client(): OAuth2Client {
  return new OAuth2Client({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: `http://localhost:${REDIRECT_PORT}`,
  })
}

// ---------------------------------------------------------------------------
// Token persistence
// ---------------------------------------------------------------------------

function ensureDir() {
  if (!fs.existsSync(GTUI_DIR)) {
    fs.mkdirSync(GTUI_DIR, { recursive: true })
  }
}

export function loadTokens(): object | null {
  if (fs.existsSync(TOKENS_FILE)) {
    const data = fs.readFileSync(TOKENS_FILE, 'utf-8')
    return JSON.parse(data)
  }
  return null
}

export function saveTokens(tokens: object): void {
  ensureDir()
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2))
}

export function clearTokens(): void {
  if (fs.existsSync(TOKENS_FILE)) {
    fs.unlinkSync(TOKENS_FILE)
  }
}

// ---------------------------------------------------------------------------
// Browser OAuth flow
// ---------------------------------------------------------------------------

function getAuthCodeFromBrowser(oauth2Client: OAuth2Client): Promise<string> {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [SCOPE],
    prompt: 'consent',
  })

  process.stderr.write('\nOpen this URL to authorize:\n\n')
  process.stderr.write(authUrl + '\n\n')
  process.stderr.write('Waiting for authorization...\n\n')

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${REDIRECT_PORT}`)
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(`<h1>Error: ${error}</h1>`)
        server.close()
        reject(new Error(error))
        return
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<h1>Success! You can close this window.</h1>')
        server.close()
        resolve(code)
        return
      }

      res.writeHead(400, { 'Content-Type': 'text/html' })
      res.end('<h1>No authorization code received</h1>')
    })

    server.listen(REDIRECT_PORT, () => {
      process.stderr.write(`Listening on http://localhost:${REDIRECT_PORT}\n`)
    })

    server.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Main authenticate function
// ---------------------------------------------------------------------------

export async function authenticate(): Promise<OAuth2Client> {
  const oauth2Client = createOAuth2Client()

  const existingTokens = loadTokens()
  if (existingTokens) {
    oauth2Client.setCredentials(existingTokens)

    // Refresh if expired
    const tokenInfo = oauth2Client.credentials
    if (tokenInfo.expiry_date && tokenInfo.expiry_date < Date.now()) {
      process.stderr.write('Token expired, refreshing...\n')
      const { credentials } = await oauth2Client.refreshAccessToken()
      oauth2Client.setCredentials(credentials)
      saveTokens(credentials)
    }

    return oauth2Client
  }

  // No tokens — start OAuth flow
  const code = await getAuthCodeFromBrowser(oauth2Client)
  process.stderr.write('Got authorization code, exchanging for tokens...\n')

  const { tokens } = await oauth2Client.getToken(code)
  oauth2Client.setCredentials(tokens)
  saveTokens(tokens)

  return oauth2Client
}

// ---------------------------------------------------------------------------
// Auth status
// ---------------------------------------------------------------------------

export interface AuthStatus {
  authenticated: boolean
  email?: string
  expiresAt?: Date
  tokensFile: string
}

export function getAuthStatus(): AuthStatus {
  const tokens = loadTokens() as Record<string, unknown> | null
  if (!tokens) {
    return { authenticated: false, tokensFile: TOKENS_FILE }
  }

  const expiryDate = tokens.expiry_date as number | undefined
  return {
    authenticated: true,
    expiresAt: expiryDate ? new Date(expiryDate) : undefined,
    tokensFile: TOKENS_FILE,
  }
}
