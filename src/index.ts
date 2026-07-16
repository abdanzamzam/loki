// ─── Types ──────────────────────────────────────────────────────────────────

export interface JobPayload {
  /** Unique job ID (auto-generated) */
  id: string
  /** Job name (handler key) */
  name: string
  /** Arbitrary job data */
  data: Record<string, unknown>
  /** Job status */
  status: 'pending' | 'processing' | 'completed' | 'failed'
  /** Number of attempts so far */
  attempts: number
  /** Max attempts before marking as failed */
  maxAttempts: number
  /** Run after this timestamp (ms) */
  delayUntil: number
  /** Priority (lower = higher priority) */
  priority: number
  /** Created at timestamp */
  createdAt: number
  /** Completed / failed timestamp */
  finishedAt: number | null
  /** Error message if failed */
  error: string | null
}

export type JobStatus = JobPayload['status']

export interface QueueOptions {
  /** Database file path (SQLite only) */
  dbPath?: string
  /** Custom table name */
  table?: string
}

export interface DispatchOptions {
  /** Delay in ms before the job becomes available */
  delay?: number
  /** Max retry attempts (default: 3) */
  maxAttempts?: number
  /** Priority — lower runs first (default: 0) */
  priority?: number
}

export interface WorkerOptions {
  /** Poll interval in ms (default: 1000) */
  interval?: number
  /** Max jobs to process per poll (default: 1) */
  concurrency?: number
}

export type JobHandler = (job: JobPayload) => Promise<void> | void

// ─── Internal helpers ───────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// ─── Queue ──────────────────────────────────────────────────────────────────

export class Queue {
  private db: import('better-sqlite3').Database
  public readonly table: string

  constructor(options: QueueOptions = {}) {
    const BetterSqlite3 = require('better-sqlite3')
    this.db = new BetterSqlite3(options.dbPath || './loki.sqlite')
    this.table = options.table || 'loki_jobs'
    this.setup()
  }

  private setup() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        delay_until INTEGER NOT NULL DEFAULT 0,
        priority INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        finished_at INTEGER,
        error TEXT
      )
    `)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_loki_pending
      ON ${this.table} (status, delay_until, priority, created_at)
    `)
  }

  /**
   * Dispatch a new job to the queue.
   */
  async dispatch(
    name: string,
    data: Record<string, unknown> = {},
    options: DispatchOptions = {},
  ): Promise<JobPayload> {
    const now = Date.now()
    const job: JobPayload = {
      id: generateId(),
      name,
      data,
      status: 'pending',
      attempts: 0,
      maxAttempts: options.maxAttempts ?? 3,
      delayUntil: now + (options.delay ?? 0),
      priority: options.priority ?? 0,
      createdAt: now,
      finishedAt: null,
      error: null,
    }

    const stmt = this.db.prepare(`
      INSERT INTO ${this.table} (id, name, data, status, attempts, max_attempts, delay_until, priority, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      job.id, job.name, JSON.stringify(job.data), job.status,
      job.attempts, job.maxAttempts, job.delayUntil, job.priority, job.createdAt,
    )

    return job
  }

  /**
   * Dispatch multiple jobs in a batch (single transaction).
   */
  async dispatchBatch(
    jobs: { name: string; data?: Record<string, unknown>; options?: DispatchOptions }[],
  ): Promise<JobPayload[]> {
    const now = Date.now()
    const payloads: JobPayload[] = jobs.map((j) => ({
      id: generateId(),
      name: j.name,
      data: j.data ?? {},
      status: 'pending' as const,
      attempts: 0,
      maxAttempts: j.options?.maxAttempts ?? 3,
      delayUntil: now + (j.options?.delay ?? 0),
      priority: j.options?.priority ?? 0,
      createdAt: now,
      finishedAt: null,
      error: null,
    }))

    const insert = this.db.transaction(() => {
      const stmt = this.db.prepare(`
        INSERT INTO ${this.table} (id, name, data, status, attempts, max_attempts, delay_until, priority, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const j of payloads) {
        stmt.run(j.id, j.name, JSON.stringify(j.data), j.status, j.attempts, j.maxAttempts, j.delayUntil, j.priority, j.createdAt)
      }
    })
    insert()

    return payloads
  }

  /**
   * Pick the next pending job (FIFO + priority).
   */
  pick(): JobPayload | null {
    const row = this.db.prepare(`
      SELECT * FROM ${this.table}
      WHERE status = 'pending' AND delay_until <= ?
      ORDER BY priority ASC, created_at ASC
      LIMIT 1
    `).get(Date.now()) as Record<string, unknown> | undefined

    if (!row) return null
    return this.toJob(row)
  }

  /**
   * Mark a job as processing.
   */
  markProcessing(id: string): void {
    this.db.prepare(`
      UPDATE ${this.table} SET status = 'processing', attempts = attempts + 1
      WHERE id = ?
    `).run(id)
  }

  /**
   * Mark a job as completed.
   */
  markCompleted(id: string): void {
    this.db.prepare(`
      UPDATE ${this.table} SET status = 'completed', finished_at = ?
      WHERE id = ?
    `).run(Date.now(), id)
  }

  /**
   * Mark a job as failed.
   */
  markFailed(id: string, error: string): void {
    this.db.prepare(`
      UPDATE ${this.table} SET status = 'failed', finished_at = ?, error = ?
      WHERE id = ?
    `).run(Date.now(), error, id)
  }

  /**
   * Reset a failed job back to pending (for retry).
   */
  retry(id: string): void {
    this.db.prepare(`
      UPDATE ${this.table} SET status = 'pending', error = NULL
      WHERE id = ? AND status = 'failed'
    `).run(id)
  }

  /**
   * Get job stats: counts by status.
   */
  stats(): { pending: number; processing: number; completed: number; failed: number; total: number } {
    const rows = this.db.prepare(`
      SELECT status, COUNT(*) as count FROM ${this.table} GROUP BY status
    `).all() as { status: string; count: number }[]

    const map = { pending: 0, processing: 0, completed: 0, failed: 0 }
    for (const row of rows) {
      if (row.status in map) map[row.status as keyof typeof map] = row.count
    }
    const total = Object.values(map).reduce((a, b) => a + b, 0)
    return { ...map, total }
  }

  /**
   * Clean completed/failed jobs older than the given age (ms).
   */
  clean(maxAge: number = 86400000): number {
    const cutoff = Date.now() - maxAge
    const result = this.db.prepare(`
      DELETE FROM ${this.table} WHERE status IN ('completed', 'failed') AND finished_at <= ?
    `).run(cutoff)
    return result.changes
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close()
  }

  private toJob(row: Record<string, unknown>): JobPayload {
    return {
      id: row.id as string,
      name: row.name as string,
      data: JSON.parse(row.data as string),
      status: row.status as JobStatus,
      attempts: row.attempts as number,
      maxAttempts: row.max_attempts as number,
      delayUntil: row.delay_until as number,
      priority: row.priority as number,
      createdAt: row.created_at as number,
      finishedAt: (row.finished_at as number) ?? null,
      error: (row.error as string) ?? null,
    }
  }
}

// ─── Worker ─────────────────────────────────────────────────────────────────

export class Worker {
  private queue: Queue
  private handlers: Map<string, JobHandler> = new Map()
  private running = false
  private timer: ReturnType<typeof setInterval> | null = null
  private interval: number
  private concurrency: number

  constructor(queue: Queue, options: WorkerOptions = {}) {
    this.queue = queue
    this.interval = options.interval ?? 1000
    this.concurrency = options.concurrency ?? 1
  }

  /**
   * Register a handler for a job type.
   */
  process(name: string, handler: JobHandler): void {
    this.handlers.set(name, handler)
  }

  /**
   * Start polling for jobs.
   */
  start(): void {
    if (this.running) return
    this.running = true
    this.timer = setInterval(() => this.tick(), this.interval)
    // Immediate first tick
    this.tick()
  }

  /**
   * Stop the worker.
   */
  stop(): void {
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async tick(): Promise<void> {
    if (!this.running) return

    for (let i = 0; i < this.concurrency; i++) {
      const job = this.queue.pick()
      if (!job) break

      const handler = this.handlers.get(job.name)
      if (!handler) {
        this.queue.markFailed(job.id, `No handler registered for "${job.name}"`)
        continue
      }

      this.queue.markProcessing(job.id)

      try {
        await handler(job)
        this.queue.markCompleted(job.id)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)

        if (job.attempts >= job.maxAttempts) {
          this.queue.markFailed(job.id, msg)
        } else {
          // Revert to pending so it gets picked again
          this.queue.markFailed(job.id, msg)
          // Auto-retry with exponential backoff
          const retryDelay = Math.min(1000 * Math.pow(2, job.attempts), 30000)
          setTimeout(() => this.queue.retry(job.id), retryDelay)
        }
      }
    }
  }
}
