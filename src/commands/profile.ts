// Profile command: show account info.
// Displays email address, message/thread counts, and aliases.

import type { Goke } from 'goke'
import { authenticate } from '../auth.js'
import { GmailClient } from '../gmail-client.js'
import { GmailCache } from '../gmail-cache.js'
import * as out from '../output.js'

export function registerProfileCommands(cli: Goke) {
  cli
    .command('profile', 'Show Gmail account info')
    .option('--json', 'Output as JSON')
    .option('--no-cache', 'Skip cache')
    .action(async (options: { json?: boolean; noCache?: boolean }) => {
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

      if (options.json) {
        out.printJson({ ...profile, aliases })
        return
      }

      out.printTable({
        head: ['Field', 'Value'],
        rows: [
          ['Email', profile.emailAddress],
          ['Messages (total)', profile.messagesTotal],
          ['Threads (total)', profile.threadsTotal],
          ['History ID', profile.historyId],
        ],
      })

      if (aliases.length > 1) {
        process.stdout.write('\n')
        out.printTable({
          head: ['Alias', 'Name', 'Primary'],
          rows: aliases.map((a) => [
            a.email,
            a.name ?? '',
            a.primary ? 'yes' : '',
          ]),
        })
      }
    })
}
