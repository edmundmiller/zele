// Auth commands: login, logout, status.
// Manages OAuth2 authentication for zele.
// Supports multiple accounts: login adds accounts, logout removes one.

import type { Goke } from 'goke'
import { login, logout, listAccounts, getAuthStatuses } from '../auth.js'
import * as out from '../output.js'

export function registerAuthCommands(cli: Goke) {
  cli
    .command('auth login', 'Authenticate with Google (opens browser)')
    .action(async () => {
      const { email } = await login()
      out.success(`Authenticated as ${email}`)
    })

  cli
    .command('auth logout [email]', 'Remove stored credentials for an account')
    .option('--force', 'Skip confirmation')
    .action(async (email, options) => {
      const accounts = await listAccounts()

      if (accounts.length === 0) {
        out.hint('No accounts currently authenticated')
        return
      }

      // If no email specified and multiple accounts: error with list
      if (!email && accounts.length > 1) {
        out.error('Multiple accounts logged in. Specify which to remove:')
        for (const a of accounts) {
          process.stderr.write(`  ${a}\n`)
        }
        process.exit(1)
      }

      // If no email and only one account, use that one
      const targetEmail = email ?? accounts[0]!

      if (!accounts.includes(targetEmail)) {
        out.error(`Account not found: ${targetEmail}`)
        out.hint(`Logged in accounts: ${accounts.join(', ')}`)
        process.exit(1)
      }

      if (!options.force) {
        if (!process.stdin.isTTY) {
          out.error('Use --force to logout non-interactively')
          process.exit(1)
        }

        const readline = await import('node:readline')
        const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
        const answer = await new Promise<string>((resolve) => {
          rl.question(`Remove credentials for ${targetEmail}? [y/N] `, resolve)
        })
        rl.close()

        if (answer.toLowerCase() !== 'y') {
          out.hint('Cancelled')
          return
        }
      }

      await logout(targetEmail)
      out.success(`Credentials removed for ${targetEmail}`)
    })

  cli
    .command('auth status', 'Show authentication status')
    .action(async () => {
      const statuses = await getAuthStatuses()

      if (statuses.length === 0) {
        out.hint('Not authenticated. Run: zele auth login')
        return
      }

      out.printList(
        statuses.map((s) => ({
          email: s.email,
          status: 'Authenticated',
          expires: s.expiresAt?.toISOString() ?? 'unknown',
        })),
      )

      out.hint(`${statuses.length} account(s)`)
    })
}
