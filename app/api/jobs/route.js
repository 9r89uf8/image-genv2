export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createJobDoc, listJobs } from "@/lib/db";
import { queue } from "@/lib/queue";

function serializeTimestamp(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  return value;
}

function serializeJob(job) {
  if (!job) return null;
  return {
    ...job,
    createdAt: serializeTimestamp(job.createdAt),
    startedAt: serializeTimestamp(job.startedAt),
    finishedAt: serializeTimestamp(job.finishedAt),
  };
}

export async function GET() {
  const jobs = await listJobs(50);
  return Response.json({ jobs: jobs.map(serializeJob) });
}

export async function POST(request) {
  const body = await request.json();

  const jobId = await createJobDoc({
    type: body.type || "generate",
    prompt: body.prompt || "",
    inputs: body.inputs || {},
    girlId: body.girlId ?? null,
    rerunOf: body.rerunOf ?? null,
  });

  queue.add(jobId);

  return Response.json({ jobId });
}
