// Profile command: show account info.
// Displays email address, message/thread counts, and aliases as YAML.
// Multi-account: shows all accounts or filtered by --account.

import type { Goke } from 'goke'
import { getClients } from '../auth.js'
import { GmailClient } from '../gmail-client.js'
import * as cache from '../gmail-cache.js'
import * as out from '../output.js'

export function registerProfileCommands(cli: Goke) {
  cli
    .command('profile', 'Show Gmail account info')
    .option('--no-cache', 'Skip cache')
    .action(async (options) => {
      const clients = await getClients(options.account)

      type Profile = Awaited<ReturnType<GmailClient['getProfile']>>

      // Fetch all accounts concurrently, tolerating individual failures
      const settled = await Promise.allSettled(
        clients.map(async ({ email, appId, client }) => {
          const account = { email, appId }
          let profile: Profile | undefined
          if (!options.noCache) {
            profile = await cache.getCachedProfile<Profile>(account)
          }
          if (!profile) {
            profile = await client.getProfile()
            if (!options.noCache) {
              await cache.cacheProfile(account, profile)
            }
          }

          // Always fetch aliases fresh
          const aliases = await client.getEmailAliases()

          return { email, profile, aliases }
        }),
      )

      const results = settled
        .filter((r): r is PromiseFulfilledResult<{ email: string; profile: Profile; aliases: Awaited<ReturnType<GmailClient['getEmailAliases']>> }> => {
          if (r.status === 'rejected') {
            out.error(`Failed to fetch profile: ${r.reason}`)
            return false
          }
          return true
        })
        .map((r) => r.value)

      for (const { profile, aliases } of results) {
        out.printYaml({
          email: profile.emailAddress,
          messages_total: profile.messagesTotal,
          threads_total: profile.threadsTotal,
          history_id: profile.historyId,
          aliases: aliases.map((a) => ({
            email: a.email,
            name: a.name ?? null,
            primary: a.primary,
          })),
        })
      }
    })
}
