import { array, boolean, defineApp, json, mutation, number, object, query, router, string, type Infer } from 'apps';
import { never } from 'apps/operations/approval';
import { FEED_URL, feedHash, readLive, stage, validateFeed, type Project, type Snapshot } from './feed.js';
import { requirements } from './requirements.js';
import { history, pendingOperation, publication, publicationSummary, publish, resolvePending, type ReadContext, type WriteContext } from './publish.js';

const empty = object({});
const expectedHash = string({ minLength: 1 });
const publishOutput = object({ changed: boolean(), publicationId: string(), feedHash: string(), feedUrl: string(), message: string() });
const resultJSON = (value: unknown): Infer<ReturnType<typeof json>> => JSON.parse(JSON.stringify(value));
function integer(value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Expected an integer from ${min} to ${max}.`);
  return value;
}

export default defineApp(requirements, {
  tools: router({
    status: query({
      description: 'Read live Cloudflare feed counts, dates, guidelines and its feedHash. Use that hash as expectedHash for a write. No credentials are returned.',
      input: empty,
      output: object({ feedUrl: string(), feedHash: string(), buildCount: number(), designCount: number(),
        buildCheckedAt: string(), designCheckedAt: string(), guidelines: string(), pendingOperation: json() })
    }, async (ctx: ReadContext) => {
      const feed = await readLive(ctx);
      return { feedUrl: FEED_URL, feedHash: await feedHash(feed), buildCount: feed.build.projects.length,
        designCount: feed.design.projects.length, buildCheckedAt: feed.build.checkedAt,
        designCheckedAt: feed.design.checkedAt, guidelines: feed.guidelines,
        pendingOperation: resultJSON(pendingOperation(ctx)) };
    }),
    exportFeed: query({
      description: 'Export the complete validated live feed and feedHash for backup, bulk editing or reconciling GitHub/offline JSON. This is a large response; filter it inside execute when possible.',
      input: empty, output: object({ feedHash: string(), feed: json() })
    }, async (ctx: ReadContext) => {
      const feed = await readLive(ctx);
      return { feedHash: await feedHash(feed), feed: resultJSON(feed) };
    }),
    listProjects: query({
      description: 'Search and page through live projects in one stage; returns titles, verdicts and reason counts plus feedHash.',
      input: object({ stage: string(), search: string().default(''), offset: number().default(0), limit: number().default(25) }),
      output: object({ feedHash: string(), total: number(), nextOffset: json(), projects: array(json()) })
    }, async (ctx: ReadContext, input) => {
      const key = stage(input.stage);
      const offset = integer(input.offset, 0, 10000);
      const limit = integer(input.limit, 1, 100);
      const feed = await readLive(ctx);
      const needle = input.search.toLowerCase();
      const all = feed[key].projects.filter(p => (p.project_id + ' ' + p.title).toLowerCase().includes(needle));
      return { feedHash: await feedHash(feed), total: all.length,
        nextOffset: offset + limit < all.length ? offset + limit : null,
        projects: all.slice(offset, offset + limit).map(p => ({ projectId: p.project_id, title: p.title,
          verdict: p.verdict, failedChecks: p.fail.length, warnings: p.warn.length })) };
    }),
    getProject: query({
      description: 'Read one complete live project with failed checks/warnings and feedHash, or null if not in that stage.',
      input: object({ stage: string(), projectId: string({ minLength: 1 }) }),
      output: object({ feedHash: string(), checkedAt: string(), project: json() })
    }, async (ctx: ReadContext, input) => {
      const key = stage(input.stage);
      const feed = await readLive(ctx);
      return { feedHash: await feedHash(feed), checkedAt: feed[key].checkedAt,
        project: resultJSON(feed[key].projects.find(p => p.project_id === input.projectId) ?? null) };
    }),
    updateReasons: mutation({
      description: 'Replace fail/warn lists and/or verdict for one project. Omitted fields are preserved; [] clears a list. Requires a fresh expectedHash. Dates stay unchanged.',
      approval: never(),
      input: object({ expectedHash, stage: string(), projectId: string({ minLength: 1 }),
        fail: array(string()).optional(), warn: array(string()).optional(), verdict: string().optional() }),
      output: publishOutput
    }, async (ctx: WriteContext, input) => {
      const key = stage(input.stage);
      if (input.fail === undefined && input.warn === undefined && input.verdict === undefined)
        throw new Error('Supply fail, warn or verdict.');
      return publish(ctx, input.expectedHash, `Update ${key} reasons for #${input.projectId}`, feed => {
        const p = feed[key].projects.find(p => p.project_id === input.projectId);
        if (!p) throw new Error('Project is not in this stage. Use upsertProject to add a complete record.');
        if (input.fail !== undefined) p.fail = [...input.fail];
        if (input.warn !== undefined) p.warn = [...input.warn];
        if (input.verdict !== undefined) {
          if (input.verdict !== 'ready' && input.verdict !== 'not_shipped') throw new Error('Verdict must be ready or not_shipped.');
          p.verdict = input.verdict;
        }
        return feed;
      });
    }),
    upsertProject: mutation({
      description: 'Add or replace a complete project JSON record in build or design. Preserve fields from getProject when editing. Build needs devlogs/build_devlogs; design needs tier/requested. Requires expectedHash.',
      approval: never(),
      input: object({ expectedHash, stage: string(), project: json() }), output: publishOutput
    }, async (ctx: WriteContext, input) => {
      const key = stage(input.stage);
      const record = input.project as unknown as Project;
      if (!record || typeof record.project_id !== 'string') throw new Error('Supply a complete project object with project_id.');
      return publish(ctx, input.expectedHash, `Upsert ${key} project #${record.project_id}`, feed => {
        const index = feed[key].projects.findIndex(p => p.project_id === record.project_id);
        if (index === -1) feed[key].projects.push(record);
        else feed[key].projects[index] = record;
        return feed;
      });
    }),
    removeProject: mutation({
      description: 'Remove one project from one stage only. It becomes unknown in the extension. The other stage is untouched. Requires expectedHash.',
      approval: never(), input: object({ expectedHash, stage: string(), projectId: string({ minLength: 1 }) }), output: publishOutput
    }, async (ctx: WriteContext, input) => {
      const key = stage(input.stage);
      return publish(ctx, input.expectedHash, `Remove ${key} project #${input.projectId}`, feed => {
        if (!feed[key].projects.some(p => p.project_id === input.projectId)) throw new Error('Project not found in that stage.');
        feed[key].projects = feed[key].projects.filter(p => p.project_id !== input.projectId);
        return feed;
      });
    }),
    replaceSnapshot: mutation({
      description: 'Replace one entire stage snapshot with JSON {checkedAt: YYYY-MM-DD, projects: [...]}. Use the actual report check date. Other stage and guidelines are preserved. Requires expectedHash.',
      approval: never(), input: object({ expectedHash, stage: string(), snapshot: json() }), output: publishOutput
    }, async (ctx: WriteContext, input) => {
      const key = stage(input.stage);
      return publish(ctx, input.expectedHash, `Replace ${key} snapshot`, feed => {
        feed[key] = input.snapshot as unknown as Snapshot;
        return feed;
      });
    }),
    updateGuidelines: mutation({
      description: 'Change the shipping-guidelines sentence inserted by the rejection helper and appended to feedback drafts. Plain text only, at most 20000 characters. Requires expectedHash.',
      approval: never(), input: object({ expectedHash, guidelines: string({ minLength: 1 }) }), output: publishOutput
    }, async (ctx: WriteContext, input) => publish(ctx, input.expectedHash, 'Update shipping-guidelines wording', feed => {
      feed.guidelines = input.guidelines;
      return feed;
    })),
    history: query({
      description: 'List publication results and backup IDs, newest first. An uploaded state means Cloudflare accepted it, not that every extension cache refreshed.',
      input: object({ limit: number().default(20) }), output: object({ publications: array(json()) })
    }, async (ctx: ReadContext, input) => ({ publications: history(ctx, integer(input.limit, 1, 100)) })),
    getPublication: query({
      description: 'Read one publication outcome and before/after hashes without downloading its full backup. Do not retry unknown outcomes; use resolvePending.',
      input: object({ publicationId: string({ minLength: 1 }) }), output: json()
    }, async (ctx: ReadContext, input) => resultJSON(publicationSummary(publication(ctx, input.publicationId)))),
    restore: mutation({
      description: 'Restore the complete feed saved BEFORE a selected publication. Creates a new backed-up publication. Requires the current live expectedHash; never blindly overwrites newer changes.',
      approval: never(), input: object({ expectedHash, publicationId: string({ minLength: 1 }) }), output: publishOutput
    }, async (ctx: WriteContext, input) => {
      const row = publication(ctx, input.publicationId);
      const backup = validateFeed(JSON.parse(row.before_json));
      return publish(ctx, input.expectedHash, `Restore backup before ${input.publicationId}`, () => backup);
    }),
    resolvePending: mutation({
      description: 'Resolve an uncertain/interrupted publication by comparing live data with its saved hashes, then release the lock. Never replays an upload. An interrupted active upload must be at least five minutes old.',
      approval: never(), input: object({ operationId: string({ minLength: 1 }) }),
      output: object({ operationId: string(), state: string(), liveHash: string(), message: string() })
    }, async (ctx: WriteContext, input) => resolvePending(ctx, input.operationId))
  }, {
    title: 'sdhwex Manager',
    description: 'Data-only administration of the fixed sdhwex Cloudflare feed, with immediate publishing, conflict detection, publication backups and restore.',
    instructions: 'Read status or getProject before writing; pass its feedHash as expectedHash. Use build/design explicitly. Remote writes execute immediately without additional approval prompts. Follow the requested scope. Never repeat a failed/unknown publication: inspect getPublication and resolvePending. Data appears in installed extensions within about six minutes. No tool accepts arbitrary code, URLs or Worker/account names. External Cloudflare writers can race a publish; serialize edits through this app. Remote changes do not update the GitHub JSON or bundled offline fallback; export/reconcile them before using the old local deploy:data command.'
  })
});
