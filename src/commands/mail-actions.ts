// Mail action commands: star, unstar, archive, trash, untrash, mark read/unread, label modify.
// Bulk operations on threads — all invalidate relevant caches after mutation.

import type { Goke } from 'goke'
import { z } from 'zod'
import { authenticate } from '../auth.js'
import { GmailClient } from '../gmail-client.js'
import { GmailCache } from '../gmail-cache.js'
import * as out from '../output.js'

// ---------------------------------------------------------------------------
// Helper: run a bulk action with cache invalidation
// ---------------------------------------------------------------------------

async function bulkAction(
  threadIds: string[],
  actionName: string,
  fn: (client: GmailClient, ids: string[]) => Promise<void>,
) {
  if (threadIds.length === 0) {
    out.error('No thread IDs provided')
    process.exit(1)
  }

  const auth = await authenticate()
  const client = new GmailClient({ auth })

  await fn(client, threadIds)

  // Invalidate caches
  const cache = new GmailCache()
  cache.invalidateThreads(threadIds)
  cache.invalidateThreadLists()
  cache.invalidateLabelCounts()
  cache.close()

  out.printYaml({ action: actionName, thread_ids: threadIds, success: true })
}

// ---------------------------------------------------------------------------
// Register commands
// ---------------------------------------------------------------------------

export function registerMailActionCommands(cli: Goke) {
  cli
    .command('mail star [...threadIds]', 'Star threads')
    .action(async (threadIds: string[]) => {
      await bulkAction(threadIds, 'Starred', (c, ids) => c.star({ threadIds: ids }))
    })

  cli
    .command('mail unstar [...threadIds]', 'Remove star from threads')
    .action(async (threadIds: string[]) => {
      await bulkAction(threadIds, 'Unstarred', (c, ids) => c.unstar({ threadIds: ids }))
    })

  cli
    .command('mail archive [...threadIds]', 'Archive threads (remove from inbox)')
    .action(async (threadIds: string[]) => {
      await bulkAction(threadIds, 'Archived', (c, ids) => c.archive({ threadIds: ids }))
    })

  cli
    .command('mail trash <threadId>', 'Move thread to trash')
    .action(async (threadId: string) => {
      await bulkAction([threadId], 'Trashed', (c, ids) => c.trash({ threadId: ids[0]! }))
    })

  cli
    .command('mail untrash <threadId>', 'Remove thread from trash')
    .action(async (threadId: string) => {
      await bulkAction([threadId], 'Untrashed', (c, ids) => c.untrash({ threadId: ids[0]! }))
    })

  cli
    .command('mail read-mark [...threadIds]', 'Mark threads as read')
    .action(async (threadIds: string[]) => {
      await bulkAction(threadIds, 'Marked as read', (c, ids) => c.markAsRead({ threadIds: ids }))
    })

  cli
    .command('mail unread-mark [...threadIds]', 'Mark threads as unread')
    .action(async (threadIds: string[]) => {
      await bulkAction(threadIds, 'Marked as unread', (c, ids) => c.markAsUnread({ threadIds: ids }))
    })

  cli
    .command('mail label [...threadIds]', 'Add or remove labels from threads')
    .option('--add <add>', z.string().describe('Labels to add (comma-separated)'))
    .option('--remove <remove>', z.string().describe('Labels to remove (comma-separated)'))
    .action(async (threadIds: string[], options: {
      add?: string
      remove?: string
    }) => {
      if (!options.add && !options.remove) {
        out.error('At least one of --add or --remove is required')
        process.exit(1)
      }

      const addLabels = options.add?.split(',').map((l) => l.trim()).filter(Boolean) ?? []
      const removeLabels = options.remove?.split(',').map((l) => l.trim()).filter(Boolean) ?? []

      await bulkAction(
        threadIds,
        'Labels modified',
        (c, ids) => c.modifyLabels({ threadIds: ids, addLabelIds: addLabels, removeLabelIds: removeLabels }),
      )
    })

  cli
    .command('mail trash-spam', 'Trash all spam threads')
    .action(async () => {
      const auth = await authenticate()
      const client = new GmailClient({ auth })

      const result = await client.trashAllSpam()

      const cache = new GmailCache()
      cache.invalidateThreadLists()
      cache.invalidateLabelCounts()
      cache.close()

      out.printYaml(result)
      out.success(`Trashed ${result.count} spam thread(s)`)
    })
}
