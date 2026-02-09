// Profile command: show account info.
// Displays email address, message/thread counts, and aliases as YAML.

import type { Goke } from 'goke'
import { authenticate } from '../auth.js'
import { GmailClient } from '../gmail-client.js'
import { GmailCache } from '../gmail-cache.js'
import * as out from '../output.js'

export function registerProfileCommands(cli: Goke) {
  cli
    .command('profile', 'Show Gmail account info')
    .option('--no-cache', 'Skip cache')
    .action(async (options: { noCache?: boolean }) => {
      const auth = await authenticate()
      const client = new GmailClient({ auth })
      const cache = options.noCache ? null : new GmailCache()

      type Profile = Awaited<ReturnType<GmailClient['getProfile']>>
      let profile = cache?.getCachedProfile<Profile>()
      if (!profile) {
        profile = await client.getProfile()
        cache?.cacheProfile(profile)
      }

      // Always fetch aliases fresh (not cached)
      const aliases = await client.getEmailAliases()

      cache?.close()

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
    })
}
