# ⚡ Loki

> Simple queue worker for Node.js — no Redis required, just your database.

**Loki** is a lightweight job queue that uses SQLite (or any database) instead of Redis. Perfect for smaller apps, shared hosting, or when you don't want to set up Redis just for a few background jobs.

```
npm install loki
```

## Features

- ✅ **Zero Redis** — works with SQLite out of the box
- ✅ **Simple API** — dispatch jobs, process handlers
- ✅ **Retry with backoff** — automatic retry on failure
- ✅ **Delayed jobs** — schedule jobs for later
- ✅ **Priority** — high priority jobs run first
- ✅ **Batch dispatch** — multiple jobs in a single transaction
- ✅ **CLI** — `npx loki work` to start the worker
- ✅ **TypeScript** — ESM + CJS

## Quick Start

```ts
import { Queue, Worker } from 'loki'

// 1. Create a queue (SQLite file: ./loki.sqlite)
const queue = new Queue()

// 2. Dispatch a job
await queue.dispatch('send-email', {
  to: 'user@example.com',
  subject: 'Welcome!',
})

// 3. Register a handler
const worker = new Worker(queue)

worker.process('send-email', async (job) => {
  console.log(`Sending email to ${job.data.to}...`)
  await sendEmail(job.data.to, job.data.subject)
})

// 4. Start working!
worker.start()
```

## CLI

```bash
# Start the worker (polls for pending jobs)
npx loki work

# Dispatch a test job
npx loki dispatch send-email '{"to":"test@test.com"}'

# View queue statistics
npx loki stats
```

## API

### Queue

```ts
const queue = new Queue(options?)
// options: { dbPath?: string, table?: string }
```

| Method | Description |
|--------|-------------|
| `dispatch(name, data?, opts?)` | Add a job to the queue |
| `dispatchBatch(jobs)` | Add multiple jobs (single transaction) |
| `stats()` | Get counts by status |
| `retry(id)` | Reset a failed job to pending |
| `clean(maxAge?)` | Remove old completed/failed jobs |
| `close()` | Close the database |

### Worker

```ts
const worker = new Worker(queue, options?)
// options: { interval?: number (ms), concurrency?: number }
```

| Method | Description |
|--------|-------------|
| `process(name, handler)` | Register a handler for a job type |
| `start()` | Begin polling for jobs |
| `stop()` | Stop the worker |

### Dispatch Options

```ts
await queue.dispatch('send-email', data, {
  delay: 5000,       // Run 5 seconds later
  maxAttempts: 5,    // Retry up to 5 times (default: 3)
  priority: 1,       // Lower = higher priority (default: 0)
})
```

## Why Loki?

| Feature | Bull | Bee-Queue | Agenda | **Loki** |
|---------|------|-----------|--------|----------|
| Requires Redis | ✅ | ✅ | ❌ (MongoDB) | ✅ **No Redis** |
| Requires MongoDB | ❌ | ❌ | ✅ | ❌ |
| Works with SQLite | ❌ | ❌ | ❌ | ✅ |
| Setup complexity | High | High | Medium | **Minimal** |
| TypeScript | ✅ | ❌ | ❌ | ✅ |
| File size | Large | Medium | Medium | **Tiny** |

## License

MIT © [Abdan Zam Zam Ramadhan](https://github.com/abdanzamzam)
