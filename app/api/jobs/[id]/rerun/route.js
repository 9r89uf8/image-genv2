export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { db } from "@/lib/firebase-admin";
import { createJobDoc, getJob } from "@/lib/db";
import { queue } from "@/lib/queue";

export async function POST(request, { params }) {
  const original = await getJob(params.id);
  if (!original) {
    return new Response("not found", { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const prompt = body.prompt ?? original.prompt;

  const jobId = await createJobDoc({
    type: original.type,
    prompt,
    inputs: original.inputs,
    girlId: original.girlId ?? null,
    rerunOf: params.id,
  });

  await db.collection("jobs").doc(params.id).update({
    lastRerunId: jobId,
  });

  queue.add(jobId);

  return Response.json({ jobId });
}
