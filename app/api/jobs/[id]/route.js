export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { bucket, db } from "@/lib/firebase-admin";
import { getJob, updateJob } from "@/lib/db";
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

export async function GET(_request, { params }) {
  const job = await getJob(params.id);
  if (!job) {
    return new Response("not found", { status: 404 });
  }
  return Response.json(serializeJob(job));
}

export async function DELETE(_request, { params }) {
  const job = await getJob(params.id);
  if (!job) {
    return new Response("not found", { status: 404 });
  }

  if (["PENDING", "RUNNING"].includes(job.status)) {
    queue.cancel(params.id);
    await updateJob(params.id, { status: "CANCELLED" });
    return new Response(null, { status: 204 });
  }

  if (job?.result?.storagePath) {
    try {
      await bucket.file(job.result.storagePath).delete();
    } catch {
      // ignore missing file
    }
  }

  await db.collection("jobs").doc(params.id).delete();

  return new Response(null, { status: 204 });
}
