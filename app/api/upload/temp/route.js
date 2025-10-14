export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { bucket } from "@/lib/firebase-admin";
import { v4 as uuid } from "uuid";

export async function POST(request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || typeof file === "string") {
    return Response.json({ error: "missing file" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "image/png";
  const id = uuid().replace(/-/g, "");
  const ext = mimeType.includes("png")
    ? "png"
    : mimeType.includes("webp")
    ? "webp"
    : "jpg";
  const storagePath = `temps/${id}.${ext}`;

  const storageFile = bucket.file(storagePath);

  await storageFile.save(buffer, {
    contentType: mimeType,
    resumable: false,
    public: true,
  });

  try {
    await storageFile.makePublic();
  } catch {
    // Ignore IAM issues on local buckets; signed URLs may be used instead.
  }

  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

  return Response.json({
    publicUrl,
    storagePath,
    mimeType,
  });
}
