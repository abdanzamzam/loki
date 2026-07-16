import { describe, it, expect } from 'vitest'
import { Queue, Worker } from '../index'

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeQueue() {
  return new Queue({ dbPath: ':memory:' })
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── Queue ──────────────────────────────────────────────────────────────────

describe('Queue', () => {
  it('creates a queue and table', () => {
    const q = makeQueue()
    const stats = q.stats()
    expect(stats.total).toBe(0)
    q.close()
  })

  it('dispatches a job', async () => {
    const q = makeQueue()
    const job = await q.dispatch('test', { foo: 'bar' })
    expect(job.id).toBeTruthy()
    expect(job.name).toBe('test')
    expect(job.data).toEqual({ foo: 'bar' })
    expect(job.status).toBe('pending')
    expect(job.attempts).toBe(0)
    expect(job.maxAttempts).toBe(3)
    q.close()
  })

  it('dispatches job with custom options', async () => {
    const q = makeQueue()
    const job = await q.dispatch('priority-job', {}, {
      delay: 5000,
      maxAttempts: 5,
      priority: 1,
    })
    expect(job.maxAttempts).toBe(5)
    expect(job.priority).toBe(1)
    expect(job.delayUntil).toBeGreaterThan(Date.now())
    q.close()
  })

  it('dispatches batch jobs', async () => {
    const q = makeQueue()
    const jobs = await q.dispatchBatch([
      { name: 'a' },
      { name: 'b', data: { x: 1 } },
    ])
    expect(jobs).toHaveLength(2)
    expect(q.stats().pending).toBe(2)
    q.close()
  })

  it('picks next pending job (FIFO)', async () => {
    const q = makeQueue()
    await q.dispatch('first')
    await q.dispatch('second')
    expect(q.pick()!.name).toBe('first')
    q.close()
  })

  it('picks high priority job first', async () => {
    const q = makeQueue()
    await q.dispatch('low', {}, { priority: 10 })
    await q.dispatch('high', {}, { priority: 1 })
    expect(q.pick()!.name).toBe('high')
    q.close()
  })

  it('does not pick delayed jobs', async () => {
    const q = makeQueue()
    await q.dispatch('delayed', {}, { delay: 60000 })
    expect(q.pick()).toBeNull()
    q.close()
  })

  it('picks delayed job after delay expires', async () => {
    const q = makeQueue()
    await q.dispatch('soon', {}, { delay: 10 })
    await delay(50)
    expect(q.pick()!.name).toBe('soon')
    q.close()
  })

  it('tracks processing and completion', async () => {
    const q = makeQueue()
    const job = await q.dispatch('test')
    q.markProcessing(job.id)
    q.markCompleted(job.id)
    expect(q.stats().completed).toBe(1)
    q.close()
  })

  it('stats returns correct counts', async () => {
    const q = makeQueue()
    await q.dispatch('a')
    await q.dispatch('b')
    await q.dispatch('c')
    expect(q.stats().pending).toBe(3)

    const j1 = q.pick()!
    q.markProcessing(j1.id)
    q.markCompleted(j1.id)

    const j2 = q.pick()!
    q.markProcessing(j2.id)
    q.markFailed(j2.id, 'fail')

    const s = q.stats()
    expect(s.completed).toBe(1)
    expect(s.failed).toBe(1)
    expect(s.pending).toBe(1)
    expect(s.total).toBe(3)
    q.close()
  })

  it('retry resets failed job to pending', async () => {
    const q = makeQueue()
    const job = await q.dispatch('retry-me')
    q.markProcessing(job.id)
    q.markFailed(job.id, 'oops')
    expect(q.stats().failed).toBe(1)
    q.retry(job.id)
    expect(q.stats().failed).toBe(0)
    expect(q.stats().pending).toBe(1)
    q.close()
  })

  it('clean removes old completed jobs', async () => {
    const q = makeQueue()
    const job = await q.dispatch('old')
    q.markProcessing(job.id)
    q.markCompleted(job.id)
    expect(q.stats().completed).toBe(1)
    const removed = q.clean(0)
    expect(removed).toBeGreaterThanOrEqual(1)
    expect(q.stats().completed).toBe(0)
    q.close()
  })

  it('uses custom table name', () => {
    const q = new Queue({ dbPath: ':memory:', table: 'custom_jobs' })
    expect(q.stats().total).toBe(0)
    q.close()
  })

  it('scheduleRetry sets delay_until', async () => {
    const q = makeQueue()
    const job = await q.dispatch('retry-test')
    q.markProcessing(job.id)
    q.markFailed(job.id, 'err')
    q.scheduleRetry(job.id, 1)

    // Wait for backoff (1s) + buffer
    await delay(1200)
    const picked = q.pick()
    expect(picked).not.toBeNull()
    expect(picked!.name).toBe('retry-test')
    q.close()
  }, 5000)
})

// ─── Worker ─────────────────────────────────────────────────────────────────

describe('Worker', () => {
  it('processes a job', async () => {
    const q = makeQueue()
    const w = new Worker(q, { interval: 50 })

    let handled = ''
    w.process('greet', async (job) => {
      handled = job.data.name as string
    })

    await q.dispatch('greet', { name: 'Abdan' })
    w.start()
    await delay(300)
    w.stop()

    expect(handled).toBe('Abdan')
    expect(q.stats().completed).toBe(1)
    q.close()
  })

  it('marks job as failed when handler throws', async () => {
    const q = makeQueue()
    const w = new Worker(q, { interval: 50 })

    w.process('crash', async () => {
      throw new Error('boom')
    })

    await q.dispatch('crash', {}, { maxAttempts: 1 })
    w.start()
    await delay(500)
    w.stop()

    expect(q.stats().failed).toBe(1)
    q.close()
  })

  it('processes multiple jobs with concurrency', async () => {
    const q = makeQueue()
    const w = new Worker(q, { interval: 50, concurrency: 5 })

    let count = 0
    w.process('fast', async () => { count++ })

    await q.dispatchBatch([
      { name: 'fast' }, { name: 'fast' }, { name: 'fast' },
    ])

    w.start()
    await delay(500)
    w.stop()

    expect(count).toBe(3)
    q.close()
  })

  it('fails unregistered job type', async () => {
    const q = makeQueue()
    const w = new Worker(q, { interval: 50 })

    await q.dispatch('unknown', {}, { maxAttempts: 1 })
    w.start()
    await delay(300)
    w.stop()

    expect(q.stats().failed).toBe(1)
    q.close()
  })

  it('retries and eventually succeeds', async () => {
    const q = makeQueue()
    const w = new Worker(q, { interval: 50 })

    let attempts = 0
    w.process('flaky', async () => {
      attempts++
      if (attempts < 2) throw new Error('not yet')
    })

    await q.dispatch('flaky', {}, { maxAttempts: 3 })
    w.start()
    await delay(2500)
    w.stop()

    expect(attempts).toBe(2)
    expect(q.stats().completed).toBe(1)
    q.close()
  }, 10000)

  it('stop prevents further processing', async () => {
    const q = makeQueue()
    const w = new Worker(q, { interval: 50 })

    let count = 0
    w.process('task', async () => { count++ })

    await q.dispatch('task')
    w.start()
    await delay(200)
    w.stop()
    const c1 = count

    await q.dispatch('task')
    await delay(300)

    expect(count).toBe(c1)
    q.close()
  })

  it('start does not double-process', async () => {
    const q = makeQueue()
    const w = new Worker(q, { interval: 50 })

    let count = 0
    w.process('x', async () => { count++ })

    await q.dispatch('x')
    w.start()
    w.start() // double start should be no-op
    await delay(200)
    w.stop()

    expect(count).toBe(1)
    q.close()
  })
})
