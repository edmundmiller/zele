// Label commands: list, get, create, delete, counts.
// Manages Gmail labels with YAML output and cache integration.

import type { Goke } from 'goke'
import { z } from 'zod'
import { authenticate } from '../auth.js'
import { GmailClient } from '../gmail-client.js'
import { GmailCache } from '../gmail-cache.js'
import * as out from '../output.js'

export function registerLabelCommands(cli: Goke) {
  // =========================================================================
  // label list
  // =========================================================================

  cli
    .command('label list', 'List all labels')
    .option('--no-cache', 'Skip cache')
    .action(async (options: { noCache?: boolean }) => {
      const auth = await authenticate()
      const client = new GmailClient({ auth })
      const cache = options.noCache ? null : new GmailCache()

      type LabelList = Awaited<ReturnType<GmailClient['listLabels']>>
      let labels = cache?.getCachedLabels<LabelList>()
      if (!labels) {
        labels = await client.listLabels()
        cache?.cacheLabels(labels)
      }

      cache?.close()

      if (labels.length === 0) {
        out.hint('No labels found')
        return
      }

      // Sort: user labels first, then system
      const sorted = [...labels].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'user' ? -1 : 1
        return a.name.localeCompare(b.name)
      })

      out.printList(
        sorted.map((l) => ({ id: l.id, name: l.name, type: l.type })),
      )

      out.hint(`${labels.length} label(s)`)
    })

  // =========================================================================
  // label get
  // =========================================================================

  cli
    .command('label get <labelId>', 'Get label details with counts')
    .action(async (labelId: string) => {
      const auth = await authenticate()
      const client = new GmailClient({ auth })

      const label = await client.getLabel({ labelId })

      out.printYaml({
        id: label.id,
        name: label.name,
        type: label.type,
        messages_total: label.messagesTotal,
        messages_unread: label.messagesUnread,
        threads_total: label.threadsTotal,
        threads_unread: label.threadsUnread,
      })
    })

  // =========================================================================
  // label create
  // =========================================================================

  cli
    .command('label create <name>', 'Create a new label')
    .option('--bg-color <bgColor>', z.string().describe('Background color (hex, e.g. #4986e7)'))
    .option('--text-color <textColor>', z.string().describe('Text color (hex, e.g. #ffffff)'))
    .action(async (name: string, options: {
      bgColor?: string
      textColor?: string
    }) => {
      const auth = await authenticate()
      const client = new GmailClient({ auth })

      const result = await client.createLabel({
        name,
        color: options.bgColor && options.textColor
          ? { backgroundColor: options.bgColor, textColor: options.textColor }
          : undefined,
      })

      // Invalidate cache
      const cache = new GmailCache()
      cache.invalidateLabels()
      cache.close()

      out.printYaml(result)
      out.success(`Label created: "${result.name}"`)
    })

  // =========================================================================
  // label delete
  // =========================================================================

  cli
    .command('label delete <labelId>', 'Delete a label')
    .option('--force', 'Skip confirmation')
    .action(async (labelId: string, options: { force?: boolean }) => {
      if (!options.force && process.stdin.isTTY) {
        const readline = await import('node:readline')
        const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
        const answer = await new Promise<string>((resolve) => {
          rl.question(`Delete label ${labelId}? [y/N] `, resolve)
        })
        rl.close()

        if (answer.toLowerCase() !== 'y') {
          out.hint('Cancelled')
          return
        }
      }

      const auth = await authenticate()
      const client = new GmailClient({ auth })

      await client.deleteLabel({ labelId })

      // Invalidate cache
      const cache = new GmailCache()
      cache.invalidateLabels()
      cache.invalidateLabelCounts()
      cache.close()

      out.printYaml({ label_id: labelId, deleted: true })
    })

  // =========================================================================
  // label counts
  // =========================================================================

  cli
    .command('label counts', 'Show unread counts per label')
    .option('--no-cache', 'Skip cache')
    .action(async (options: { noCache?: boolean }) => {
      const auth = await authenticate()
      const client = new GmailClient({ auth })
      const cache = options.noCache ? null : new GmailCache()

      type CountList = Awaited<ReturnType<GmailClient['getLabelCounts']>>
      let counts = cache?.getCachedLabelCounts<CountList>()
      if (!counts) {
        counts = await client.getLabelCounts()
        cache?.cacheLabelCounts(counts)
      }

      cache?.close()

      // Filter to labels with counts > 0 and sort descending
      const withCounts = counts.filter((c) => c.count > 0).sort((a, b) => b.count - a.count)

      if (withCounts.length === 0) {
        out.hint('All clear — no unread messages')
        return
      }

      out.printList(
        withCounts.map((c) => ({ label: c.label, count: c.count })),
      )
    })
}
