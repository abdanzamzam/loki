#!/usr/bin/env node
import { Queue, Worker } from './index.js'

const [cmd, ...args] = process.argv.slice(2)

function help() {
  console.log(`
⚡ Loki — Simple Queue Worker

Usage:
  loki work              Start the worker (polls for jobs)
  loki dispatch <name>   Dispatch a test job
  loki stats             Show queue statistics
  loki help              Show this help
`)
}

async function main() {
  const queue = new Queue()

  if (cmd === 'work') {
    const worker = new Worker(queue, { interval: 1000 })

    // Register example handler
    worker.process('send-email', async (job) => {
      console.log(`📧 [${job.id}] Sending email to ${JSON.stringify(job.data.to)}`)
      await new Promise((r) => setTimeout(r, 500))
      console.log(`✅ [${job.id}] Email sent`)
    })

    worker.process('process-pdf', async (job) => {
      console.log(`📄 [${job.id}] Processing PDF: ${JSON.stringify(job.data.filename)}`)
      await new Promise((r) => setTimeout(r, 1000))
      console.log(`✅ [${job.id}] PDF processed`)
    })

    console.log('⚡ Worker started, polling every 1s...')
    worker.start()

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n⏹  Worker stopped')
      worker.stop()
      queue.close()
      process.exit(0)
    })
  } else if (cmd === 'dispatch') {
    const name = args[0]
    const data = args[1] ? JSON.parse(args[1]) : { default: true }
    const job = await queue.dispatch(name, data)
    console.log(`📝 Dispatched job: ${job.id} (${job.name})`)
  } else if (cmd === 'stats') {
    const stats = queue.stats()
    console.log('📊 Queue Stats:')
    console.log(`  Total:      ${stats.total}`)
    console.log(`  Pending:    ${stats.pending}`)
    console.log(`  Processing: ${stats.processing}`)
    console.log(`  Completed:  ${stats.completed}`)
    console.log(`  Failed:     ${stats.failed}`)
  } else {
    help()
  }
}

main().catch(console.error)
