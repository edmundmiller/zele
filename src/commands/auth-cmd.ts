// Auth commands: login, logout, status.
// Manages OAuth2 authentication for gtui.

import type { Goke } from 'goke'
import { authenticate, clearTokens, getAuthStatus } from '../auth.js'
import { GmailClient } from '../gmail-client.js'
import * as out from '../output.js'

export function registerAuthCommands(cli: Goke) {
  cli
    .command('auth login', 'Authenticate with Google (opens browser)')
    .action(async () => {
      const auth = await authenticate()
      const client = new GmailClient({ auth })

      try {
        const profile = await client.getProfile()
        out.success(`Authenticated as ${profile.emailAddress}`)
      } catch {
        out.success('Authenticated successfully')
      }
    })

  cli
    .command('auth logout', 'Remove stored credentials')
    .option('--force', 'Skip confirmation')
    .action(async (options: { force?: boolean }) => {
      const status = getAuthStatus()
      if (!status.authenticated) {
        out.hint('Not currently authenticated')
        return
      }

      if (!options.force) {
        // Non-interactive: just warn
        if (!process.stdin.isTTY) {
          out.error('Use --force to logout non-interactively')
          process.exit(1)
        }

        // Simple confirmation via readline
        const readline = await import('node:readline')
        const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
        const answer = await new Promise<string>((resolve) => {
          rl.question('Remove stored credentials? [y/N] ', resolve)
        })
        rl.close()

        if (answer.toLowerCase() !== 'y') {
          out.hint('Cancelled')
          return
        }
      }

      clearTokens()
      out.success('Credentials removed')
    })

  cli
    .command('auth status', 'Show authentication status')
    .action(async () => {
      const status = getAuthStatus()

      // Try to get email if authenticated
      if (status.authenticated) {
        try {
          const auth = await authenticate()
          const client = new GmailClient({ auth })
          const profile = await client.getProfile()
          status.email = profile.emailAddress
        } catch {
          // Token may be invalid
        }
      }

      if (status.authenticated) {
        out.printYaml({
          status: 'Authenticated',
          email: status.email ?? 'unknown',
          expires: status.expiresAt?.toISOString() ?? 'unknown',
          tokens_file: status.tokensFile,
        })
      } else {
        out.hint('Not authenticated. Run: gtui auth login')
      }
    })
}
