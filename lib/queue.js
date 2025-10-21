//lib/queue.js
import { db } from "./firebase-admin";
import { executeJob } from "./job-executor";
import { getJob } from "./db";

const MAX_CONCURRENCY =
  Number(process.env.JOB_QUEUE_CONCURRENCY || 0) || 2;
const MAX_RETRIES = Number(process.env.JOB_QUEUE_MAX_RETRIES || 0) || 2;

class JobQueue {
  constructor() {
    this.pending = [];
    this.running = new Set();
    this.paused = false;
    this.bootstrapped = false;
    this.timer = null;
  }

  async resumeOnBoot() {
    if (this.bootstrapped) return;
    this.bootstrapped = true;

    try {
      const qs = await db
        .collection("jobs")
        .where("status", "in", ["PENDING", "RUNNING"])
        .get();

      for (const doc of qs.docs) {
        const id = doc.id;
        if (!this.pending.includes(id)) {
          this.pending.push(id);
        }
      }
    } catch (error) {
      console.error("[queue] resume failed", error);
    }

    this._tick();
  }

  add(jobId) {
    if (
      this.pending.includes(jobId) ||
      this.running.has(jobId)
    ) {
      return;
    }
    this.pending.push(jobId);
    this._tick();
  }

  cancel(jobId) {
    this.pending = this.pending.filter((id) => id !== jobId);
  }

  _tick() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._loop(), 25);
  }

  async _loop() {
    if (this.paused) return;

    while (
      this.running.size < MAX_CONCURRENCY &&
      this.pending.length
    ) {
      const jobId = this.pending.shift();
      if (!jobId) continue;
      this.running.add(jobId);
      this._runOne(jobId).catch((error) => {
        console.error(`[queue] job ${jobId} crashed`, error);
      });
    }
  }

  async _runOne(jobId) {
    try {
      const result = await executeJob(jobId);

      if (result.status === "FAILED") {
        const job = await getJob(jobId);
        const retries = job?.retries ?? result.retries ?? 0;
        if (retries < MAX_RETRIES) {
          setTimeout(() => this.add(jobId), 500);
        }
      }
    } finally {
      this.running.delete(jobId);
      this._tick();
    }
  }
}

const globalQueue = globalThis;
export const queue =
  globalQueue.__LOCAL_JOB_QUEUE__ ||
  (globalQueue.__LOCAL_JOB_QUEUE__ = new JobQueue());

queue.resumeOnBoot();
