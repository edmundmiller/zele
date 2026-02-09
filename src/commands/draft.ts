// Draft commands: list, create, get, send, delete.
// Manages Gmail drafts with table output for list views.

import type { Goke } from 'goke'
import { z } from 'zod'
import fs from 'node:fs'
import { authenticate } from '../auth.js'
import { GmailClient } from '../gmail-client.js'
import { GmailCache } from '../gmail-cache.js'
import * as out from '../output.js'
import pc from 'picocolors'

export function registerDraftCommands(cli: Goke) {
  // =========================================================================
  // draft list
  // =========================================================================

  cli
    .command('draft list', 'List drafts')
    .option('--max <max>', z.number().default(20).describe('Max results'))
    .option('--page <page>', z.string().describe('Pagination token'))
    .option('--query <query>', z.string().describe('Search query'))
    .option('--json', 'Output as JSON')
    .action(async (options: {
      max: number
      page?: string
      query?: string
      json?: boolean
    }) => {
      const auth = await authenticate()
      const client = new GmailClient({ auth })

      const result = await client.listDrafts({
        query: options.query,
        maxResults: options.max,
        pageToken: options.page,
      })

      if (options.json) {
        out.printJson(result)
        return
      }

      if (result.drafts.length === 0) {
        out.hint('No drafts found')
        return
      }

      out.printTable({
        head: ['Draft ID', 'To', 'Subject', 'Date'],
        rows: result.drafts.map((d) => [
          d.id,
          out.truncate(d.to.join(', ') || '(no recipient)', 30),
          out.truncate(d.subject, 40),
          out.formatDate(d.date),
        ]),
      })

      out.hint(`${result.drafts.length} draft(s)`)
      out.printNextPageHint(result.nextPageToken)
    })

  // =========================================================================
  // draft get
  // =========================================================================

  cli
    .command('draft get <draftId>', 'Show draft details')
    .option('--json', 'Output as JSON')
    .action(async (draftId: string, options: { json?: boolean }) => {
      const auth = await authenticate()
      const client = new GmailClient({ auth })

      const draft = await client.getDraft({ draftId })

      if (options.json) {
        out.printJson(draft)
        return
      }

      process.stdout.write(pc.bold(`Draft: ${draft.message.subject}`) + '\n')
      process.stdout.write(pc.dim(`Draft ID: ${draft.id}`) + '\n')
      process.stdout.write(`To: ${draft.to.join(', ') || '(none)'}` + '\n')
      if (draft.cc.length > 0) {
        process.stdout.write(`Cc: ${draft.cc.join(', ')}` + '\n')
      }
      if (draft.bcc.length > 0) {
        process.stdout.write(`Bcc: ${draft.bcc.join(', ')}` + '\n')
      }
      process.stdout.write('\n')

      const body = out.renderEmailBody(draft.message.body, draft.message.mimeType)
      process.stdout.write(body + '\n')
    })

  // =========================================================================
  // draft create
  // =========================================================================

  cli
    .command('draft create', 'Create a new draft')
    .option('--to <to>', z.string().describe('Recipient email(s), comma-separated'))
    .option('--subject <subject>', z.string().describe('Email subject'))
    .option('--body <body>', z.string().describe('Draft body text'))
    .option('--body-file <bodyFile>', z.string().describe('Read body from file (use - for stdin)'))
    .option('--cc <cc>', z.string().describe('CC recipients (comma-separated)'))
    .option('--bcc <bcc>', z.string().describe('BCC recipients (comma-separated)'))
    .option('--thread <thread>', z.string().describe('Thread ID to associate with'))
    .option('--from <from>', z.string().describe('Send-as alias email'))
    .option('--json', 'Output as JSON')
    .action(async (options: {
      to?: string
      subject?: string
      body?: string
      bodyFile?: string
      cc?: string
      bcc?: string
      thread?: string
      from?: string
      json?: boolean
    }) => {
      if (!options.to) {
        out.error('--to is required')
        process.exit(1)
      }
      if (!options.subject) {
        out.error('--subject is required')
        process.exit(1)
      }

      // Resolve body
      let body = options.body ?? ''
      if (options.bodyFile) {
        if (options.bodyFile === '-') {
          const chunks: Buffer[] = []
          for await (const chunk of process.stdin) {
            chunks.push(chunk)
          }
          body = Buffer.concat(chunks).toString('utf-8')
        } else {
          body = fs.readFileSync(options.bodyFile, 'utf-8')
        }
      }

      const parseEmails = (str: string) =>
        str.split(',').map((e) => e.trim()).filter(Boolean).map((email) => ({ email }))

      const auth = await authenticate()
      const client = new GmailClient({ auth })

      const result = await client.createDraft({
        to: parseEmails(options.to),
        subject: options.subject,
        body,
        cc: options.cc ? parseEmails(options.cc) : undefined,
        bcc: options.bcc ? parseEmails(options.bcc) : undefined,
        threadId: options.thread,
        fromEmail: options.from,
      })

      if (options.json) {
        out.printJson(result)
        return
      }

      out.success(`Draft created (ID: ${result.id})`)
    })

  // =========================================================================
  // draft send
  // =========================================================================

  cli
    .command('draft send <draftId>', 'Send a draft')
    .option('--json', 'Output as JSON')
    .action(async (draftId: string, options: { json?: boolean }) => {
      const auth = await authenticate()
      const client = new GmailClient({ auth })

      const result = await client.sendDraft({ draftId })

      // Invalidate cache
      const cache = new GmailCache()
      cache.invalidateThreadLists()
      cache.close()

      if (options.json) {
        out.printJson(result)
        return
      }

      out.success(`Draft sent (message ID: ${result.id})`)
    })

  // =========================================================================
  // draft delete
  // =========================================================================

  cli
    .command('draft delete <draftId>', 'Delete a draft')
    .option('--force', 'Skip confirmation')
    .option('--json', 'Output as JSON')
    .action(async (draftId: string, options: { force?: boolean; json?: boolean }) => {
      if (!options.force && process.stdin.isTTY) {
        const readline = await import('node:readline')
        const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
        const answer = await new Promise<string>((resolve) => {
          rl.question(`Delete draft ${draftId}? [y/N] `, resolve)
        })
        rl.close()

        if (answer.toLowerCase() !== 'y') {
          out.hint('Cancelled')
          return
        }
      }

      const auth = await authenticate()
      const client = new GmailClient({ auth })

      await client.deleteDraft({ draftId })

      if (options.json) {
        out.printJson({ draftId, deleted: true })
        return
      }

      out.success(`Draft ${draftId} deleted`)
    })
}
