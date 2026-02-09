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
  json?: boolean,
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

  if (json) {
    out.printJson({ action: actionName, threadIds, success: true })
    return
  }

  out.success(`${actionName}: ${threadIds.length} thread(s)`)
}

// ---------------------------------------------------------------------------
// Register commands
// ---------------------------------------------------------------------------

export function registerMailActionCommands(cli: Goke) {
  cli
    .command('mail star [...threadIds]', 'Star threads')
    .option('--json', 'Output as JSON')
    .action(async (threadIds: string[], options: { json?: boolean }) => {
      await bulkAction(threadIds, 'Starred', (c, ids) => c.star({ threadIds: ids }), options.json)
    })

  cli
    .command('mail unstar [...threadIds]', 'Remove star from threads')
    .option('--json', 'Output as JSON')
    .action(async (threadIds: string[], options: { json?: boolean }) => {
      await bulkAction(threadIds, 'Unstarred', (c, ids) => c.unstar({ threadIds: ids }), options.json)
    })

  cli
    .command('mail archive [...threadIds]', 'Archive threads (remove from inbox)')
    .option('--json', 'Output as JSON')
    .action(async (threadIds: string[], options: { json?: boolean }) => {
      await bulkAction(threadIds, 'Archived', (c, ids) => c.archive({ threadIds: ids }), options.json)
    })

  cli
    .command('mail trash <threadId>', 'Move thread to trash')
    .option('--json', 'Output as JSON')
    .action(async (threadId: string, options: { json?: boolean }) => {
      await bulkAction([threadId], 'Trashed', (c, ids) => c.trash({ threadId: ids[0]! }), options.json)
    })

  cli
    .command('mail untrash <threadId>', 'Remove thread from trash')
    .option('--json', 'Output as JSON')
    .action(async (threadId: string, options: { json?: boolean }) => {
      await bulkAction([threadId], 'Untrashed', (c, ids) => c.untrash({ threadId: ids[0]! }), options.json)
    })

  cli
    .command('mail read-mark [...threadIds]', 'Mark threads as read')
    .option('--json', 'Output as JSON')
    .action(async (threadIds: string[], options: { json?: boolean }) => {
      await bulkAction(threadIds, 'Marked as read', (c, ids) => c.markAsRead({ threadIds: ids }), options.json)
    })

  cli
    .command('mail unread-mark [...threadIds]', 'Mark threads as unread')
    .option('--json', 'Output as JSON')
    .action(async (threadIds: string[], options: { json?: boolean }) => {
      await bulkAction(threadIds, 'Marked as unread', (c, ids) => c.markAsUnread({ threadIds: ids }), options.json)
    })

  cli
    .command('mail label [...threadIds]', 'Add or remove labels from threads')
    .option('--add <add>', z.string().describe('Labels to add (comma-separated)'))
    .option('--remove <remove>', z.string().describe('Labels to remove (comma-separated)'))
    .option('--json', 'Output as JSON')
    .action(async (threadIds: string[], options: {
      add?: string
      remove?: string
      json?: boolean
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
        options.json,
      )
    })

  cli
    .command('mail trash-spam', 'Trash all spam threads')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const auth = await authenticate()
      const client = new GmailClient({ auth })

      const result = await client.trashAllSpam()

      const cache = new GmailCache()
      cache.invalidateThreadLists()
      cache.invalidateLabelCounts()
      cache.close()

      if (options.json) {
        out.printJson(result)
        return
      }

      out.success(`Trashed ${result.count} spam thread(s)`)
    })
}
