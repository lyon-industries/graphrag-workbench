import type { ChildProcess } from 'node:child_process'

type IndexJob = {
  id: string
  child: ChildProcess
  startedAt: number
  provider: string
  completionModel: string
}

const globalJobs = globalThis as typeof globalThis & { __graphragIndexJob?: IndexJob }

export function getIndexJob() {
  return globalJobs.__graphragIndexJob
}

export function setIndexJob(job: IndexJob) {
  globalJobs.__graphragIndexJob = job
}

export function clearIndexJob(id: string) {
  if (globalJobs.__graphragIndexJob?.id === id) {
    globalJobs.__graphragIndexJob = undefined
  }
}
