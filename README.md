# ⚡ Loki

> Simple queue worker for Node.js — no Redis required, just your database.

**Loki** is a lightweight job queue that uses SQLite (or any database) instead of Redis. Perfect for smaller apps, shared hosting, or when you don't want to set up Redis just for a few background jobs.

```bash
npm install loki
```

---

## ✨ Features

| Feature | Status |
|---------|--------|
| ✅ No Redis required — works with SQLite | ✅ |
| ✅ Simple API — dispatch jobs, process handlers | ✅ |
| ✅ Automatic retry with exponential backoff | ✅ |
| ✅ Delayed jobs — schedule for later | ✅ |
| ✅ Priority queue — high priority jobs run first | ✅ |
| ✅ Batch dispatch — multiple jobs in one transaction | ✅ |
| ✅ Queue statistics — monitor pending/completed/failed | ✅ |
| ✅ Job cleanup — auto-remove old jobs | ✅ |
| ✅ CLI — `npx loki work` | ✅ |
| ✅ TypeScript (ESM + CJS) | ✅ |
| ✅ **Zero dependencies** (except better-sqlite3) | ✅ |

---

## 🚀 Quick Start

```ts
import { Queue, Worker } from 'loki'

// 1. Create a queue (creates ./loki.sqlite)
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

---

## 📖 Full API

### Queue

```ts
const queue = new Queue(options?)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dbPath` | `string` | `./loki.sqlite` | SQLite database path. Use `':memory:'` for in-memory |
| `table` | `string` | `loki_jobs` | Custom table name |

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `dispatch(name, data?, opts?)` | `Promise<JobPayload>` | Add a single job to the queue |
| `dispatchBatch(jobs)` | `Promise<JobPayload[]>` | Add multiple jobs atomically |
| `pick()` | `JobPayload \| null` | Get next pending job (FIFO + priority) |
| `markProcessing(id)` | `void` | Mark job as being processed |
| `markCompleted(id)` | `void` | Mark job as completed |
| `markFailed(id, error)` | `void` | Mark job as failed |
| `retry(id)` | `void` | Reset a failed job back to pending |
| `scheduleRetry(id, attempt)` | `void` | Schedule retry with exponential backoff |
| `stats()` | `Stats` | Get counts by status |
| `clean(maxAge?)` | `number` | Remove old completed/failed jobs |
| `close()` | `void` | Close database connection |

#### JobPayload

```ts
interface JobPayload {
  id: string
  name: string
  data: Record<string, unknown>
  status: 'pending' | 'processing' | 'completed' | 'failed'
  attempts: number
  maxAttempts: number
  delayUntil: number
  priority: number
  createdAt: number
  finishedAt: number | null
  error: string | null
}
```

#### DispatchOptions

```ts
await queue.dispatch('send-email', data, {
  delay: 5000,       // Run 5 seconds later
  maxAttempts: 5,    // Retry up to 5 times (default: 3)
  priority: 1,       // Lower = higher priority (default: 0)
})
```

### Worker

```ts
const worker = new Worker(queue, options?)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `interval` | `number` | `1000` | Poll interval in milliseconds |
| `concurrency` | `number` | `1` | Max jobs to process per poll |

#### Methods

| Method | Description |
|--------|-------------|
| `process(name, handler)` | Register a handler for a job type |
| `start()` | Begin polling for jobs |
| `stop()` | Stop the worker |

---

## 💻 CLI

```bash
# Start the worker (polls for pending jobs)
npx loki work

# Dispatch a test job
npx loki dispatch send-email '{"to":"test@test.com"}'

# View queue statistics
npx loki stats
```

---

## 📊 Example: Order Processing

```ts
import { Queue, Worker } from 'loki'

const queue = new Queue()
const worker = new Worker(queue, { concurrency: 3 })

// Define handlers
worker.process('send-email', async (job) => {
  console.log(`📧 Sending to ${job.data.to}`)
  await sendEmail(job.data)
})

worker.process('process-payment', async (job) => {
  console.log(`💳 Processing payment ${job.data.orderId}`)
  await processPayment(job.data)
})

worker.process('generate-report', async (job) => {
  console.log(`📄 Generating report: ${job.data.name}`)
  await generateReport(job.data)
})

// Start worker
worker.start()

// Dispatch jobs with priority
await queue.dispatch('process-payment', { orderId: 123 }, { priority: 1 })
await queue.dispatch('send-email', { to: 'buyer@email.com' }, { priority: 2 })
await queue.dispatch('generate-report', { name: 'daily' }, { delay: 3600000 })
```

---

## 🔄 Retry Behavior

When a handler throws an error:

1. Job is marked as `failed`
2. If attempts < maxAttempts → auto-scheduled for retry with exponential backoff
3. Backoff: 1s → 2s → 4s → 8s → ... (capped at 30s)
4. After maxAttempts exhausted → stays `failed`

```ts
worker.process('flaky', async (job) => {
  throw new Error('Database timeout')
})
// Tries 3 times (default) with 1s, then 2s backoff before marking permanently failed
```

---

## 🧪 Testing

Tests use in-memory SQLite for isolation:

```bash
npm test
# ✓ 21 tests passed
```

---

## 📦 Why Loki?

| Feature | Bull | Bee-Queue | Agenda | **Loki** ⚡ |
|---------|------|-----------|--------|-------------|
| Database | Redis | Redis | MongoDB | **SQLite** |
| Zero setup | ❌ | ❌ | ❌ | ✅ |
| In-memory mode | ❌ | ❌ | ❌ | ✅ |
| TypeScript | ✅ | ❌ | ❌ | ✅ |
| Package size | Large | Medium | Medium | **Tiny** |
| Perfect for small apps | ❌ | ❌ | ❌ | ✅ |

---

## 📄 License

MIT © [Abdan Zam Zam Ramadhan](https://github.com/abdanzamzam)
