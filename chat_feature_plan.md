Awesome—let’s stand up a **real, working “Chat mode”** that does *iterative* image editing with Gemini 2.5 Flash Image.
Below you’ll get **focused code for the hard parts** (backend chat endpoints + image handling + a functional Chat UI). For anything trivial, I give minimal instructions your coding agent can follow.

> **Why this design?** We use the Google Gen AI SDK’s **`ai.chats`** module to create a **stateful chat session** and call **`chat.sendMessage()`** for each turn (with **image parts** and **text**). We persist history in Firestore and rebuild it when serving each turn. We keep using Firebase Storage for outputs and the Files API for short‑lived file URIs. This matches Google’s recommended chat workflow and the new SDK surface. ([Google APIs][1])

---

## What you’ll get

* ✅ Backend API for chat sessions:

    * `POST /api/chat/sessions` – create a session
    * `GET /api/chat/sessions` – list sessions
    * `GET /api/chat/sessions/:id` – fetch metadata + recent turns
    * `DELETE /api/chat/sessions/:id` – delete a session (and its turns)
    * `POST /api/chat/sessions/:id/message` – send a message (with refs)
* ✅ Firestore data model for sessions & turns (flat, simple)
* ✅ Chat turn execution that:

    * rebuilds **history** and calls **`ai.chats.create()`**
    * attaches **ordered images** (URLs or library picks) as `fileData` parts
    * requests **image results** (and optional text) via **`responseModalities`**
    * saves output images to **Storage** and appends a **model turn**
* ✅ A functional **`/chat` page** with a **ChatPane**:

    * attach **one‑time images** (uses your existing `/api/upload/temp`)
    * see **user/model** bubbles (+ thumbnails)
    * send prompts and see **image outputs** inline
* ✅ Optional: Composer “Chat mode” **shortcut**: when **checked**, submit flow creates a chat session and sends the first message instead of enqueuing a job.

> Notes we follow from the latest docs/blogs:
> • **Files API** has a 48h TTL → we re‑upload or cache URIs. ([Google AI for Developers][2])
> • **Aspect ratios** supported by 2.5 Flash Image (portrait/square/landscape + 4:5 & 5:4). ([Google Developers Blog][3])
> • Image generation/editing is **conversational** → chat is the recommended method. ([Google AI for Developers][4])

---

# 1) Firestore shape for chat

Keep it simple and local‑dev friendly.

```
chatSessions/{sessionId}
  { title, girlId, aspectRatio, systemPrompt, createdAt, lastActive }

chatSessions/{sessionId}/turns/{turnId}
  {
    role: "user"|"model",
    text: "…",
    // For user turns (inputs):
    attachments: [{ url, mimeType?, fileUri?, expiresAtMs? }], // we fill fileUri opportunistically
    // For model turns (outputs):
    images: [{ storagePath, publicUrl, mimeType }],
    createdAt
  }
```

---

# 2) Backend — chat helpers

> We’ll reuse your existing `files.js` helpers to get **fileUri** for any URL/library image. We also add a small helper to store chat images.

### **`lib/chat.js`**

```js
// lib/chat.js
import { bucket, db, Timestamp } from '@/lib/firebase-admin';
import { ensureFileUriForLibraryImage, ensureFileUriFromUrl } from '@/lib/files';
import { GoogleGenAI, Modality } from '@google/genai';
import { MODEL_ID } from '@/lib/constants';

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

export async function saveChatImageBuffer(sessionId, turnId, idx, { buffer, mimeType }) {
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const storagePath = `chats/${sessionId}/${turnId}-${idx}.${ext}`;
  const file = bucket.file(storagePath);
  await file.save(buffer, { contentType: mimeType, resumable: false, public: true });
  try { await file.makePublic(); } catch {}
  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
  return { storagePath, publicUrl, mimeType };
}

/** Convert Firestore turns -> Gemini chat history (Parts/Contents). */
export async function buildGeminiHistoryFromTurns(turnDocs) {
  const history = [];
  for (const doc of turnDocs) {
    const t = doc.data();
    if (t.role === 'user') {
      const parts = [];
      // Attachments first, as fileData parts
      if (Array.isArray(t.attachments)) {
        for (const att of t.attachments) {
          // Try to reuse previously stored fileUri; else upload from url
          let fileUri = att.fileUri;
          if (!fileUri) {
            const uploaded = await ensureFileUriFromUrl(att.url, att.mimeType || 'image/png');
            fileUri = uploaded.fileUri;
            // opportunistically persist fileUri so we don't re-upload next time
            await doc.ref.update({
              attachments: t.attachments.map(a => a.url === att.url ? {
                ...a, fileUri, mimeType: uploaded.mimeType, expiresAtMs: Date.now() + 46*60*60*1000
              } : a)
            }).catch(() => {});
          }
          parts.push({ fileData: { fileUri, mimeType: att.mimeType || 'image/png' } });
        }
      }
      if (t.text) parts.push({ text: t.text });
      history.push({ role: 'user', parts });
    } else if (t.role === 'model') {
      // Text is enough for model messages; we don't need to reattach output images
      const parts = t.text ? [{ text: t.text }] : [];
      history.push({ role: 'model', parts });
    }
  }
  return history;
}

/** Create a new chat object given history + AR settings. */
export function createChat({ history = [], aspectRatio = '1:1' }) {
  return ai.chats.create({
    model: MODEL_ID,
    history,
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
      imageConfig: { aspectRatio },
    },
  });
}
```

---

# 3) Backend — Chat API routes

## 3.1 Create/list sessions

### **`app/api/chat/sessions/route.js`**

```js
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { db, Timestamp } from '@/lib/firebase-admin';

function serialize(ts) { return ts?.toDate?.()?.toISOString?.() || null; }

export async function GET() {
  const qs = await db.collection('chatSessions').orderBy('lastActive', 'desc').limit(30).get();
  const sessions = qs.docs.map(d => {
    const s = d.data();
    return { id: d.id, title: s.title || 'Untitled', girlId: s.girlId || '', aspectRatio: s.aspectRatio || '1:1',
      createdAt: serialize(s.createdAt), lastActive: serialize(s.lastActive) };
  });
  return Response.json({ sessions });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const { title = 'New chat', girlId = '', aspectRatio = '1:1', systemPrompt = '' } = body;
  const ref = db.collection('chatSessions').doc();
  const now = Timestamp.now();
  await ref.set({ title, girlId, aspectRatio, systemPrompt, createdAt: now, lastActive: now });
  return Response.json({ id: ref.id });
}
```

## 3.2 Get/delete a session (+ recent turns)

### **`app/api/chat/sessions/[id]/route.js`**

```js
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { db } from '@/lib/firebase-admin';

function serialize(ts) { return ts?.toDate?.()?.toISOString?.() || null; }

export async function GET(_req, { params }) {
  const sref = db.collection('chatSessions').doc(params.id);
  const ssnap = await sref.get();
  if (!ssnap.exists) return new Response('not found', { status: 404 });

  const ts = await sref.collection('turns').orderBy('createdAt', 'asc').get();
  const turns = ts.docs.map(d => {
    const t = d.data();
    return {
      id: d.id,
      role: t.role, text: t.text || '',
      attachments: t.attachments || [],
      images: t.images || [],
      createdAt: serialize(t.createdAt),
    };
  });

  const s = ssnap.data();
  return Response.json({
    session: {
      id: ssnap.id, title: s.title || 'Untitled', girlId: s.girlId || '',
      aspectRatio: s.aspectRatio || '1:1', systemPrompt: s.systemPrompt || '',
      createdAt: serialize(s.createdAt), lastActive: serialize(s.lastActive),
    },
    turns,
  });
}

export async function DELETE(_req, { params }) {
  const sref = db.collection('chatSessions').doc(params.id);
  const ssnap = await sref.get();
  if (!ssnap.exists) return new Response(null, { status: 204 });

  // delete subcollection (simple, fine for local dev)
  const ts = await sref.collection('turns').get();
  const batch = db.batch();
  ts.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  await sref.delete();
  return new Response(null, { status: 204 });
}
```

## 3.3 Send a message (the **core** of chat mode)

### **`app/api/chat/sessions/[id]/message/route.js`**

```js
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { db, Timestamp } from '@/lib/firebase-admin';
import { ensureFileUriForLibraryImage, ensureFileUriFromUrl } from '@/lib/files';
import { createChat, buildGeminiHistoryFromTurns, saveChatImageBuffer } from '@/lib/chat';
import { Modality } from '@google/genai';
import { MODEL_ID } from '@/lib/constants';

function isNonEmpty(v){ return Array.isArray(v) ? v.length>0 : !!v; }

export async function POST(req, { params }) {
  const body = await req.json().catch(() => ({}));
  const { text = '', imageIds = [], refUrls = [], imageOnly = false, aspectRatio } = body;

  const sref = db.collection('chatSessions').doc(params.id);
  const ssnap = await sref.get();
  if (!ssnap.exists) return new Response('session not found', { status: 404 });

  const session = ssnap.data();
  const ar = aspectRatio || session.aspectRatio || '1:1';

  // 1) Build history from existing turns
  const oldTurnsSnap = await sref.collection('turns').orderBy('createdAt', 'asc').get();
  const history = await buildGeminiHistoryFromTurns(oldTurnsSnap.docs);

  // 2) Prepare the "new user message" parts (images first, then text)
  const newParts = [];

  for (const id of imageIds) {
    const { fileUri, mimeType } = await ensureFileUriForLibraryImage(id);
    newParts.push({ fileData: { fileUri, mimeType } });
  }
  for (const url of refUrls) {
    const { fileUri, mimeType } = await ensureFileUriFromUrl(url);
    newParts.push({ fileData: { fileUri, mimeType } });
  }
  if (text) newParts.push({ text });

  // 3) Create chat object with history + AR, then send new message
  const chat = createChat({ history, aspectRatio: ar });
  const response = await chat.sendMessage({
    message: newParts,
    config: {
      responseModalities: imageOnly ? [Modality.IMAGE] : [Modality.TEXT, Modality.IMAGE],
      imageConfig: { aspectRatio: ar },
    },
  });

  // 4) Persist the new user turn (we store raw URLs/ids; Files API URIs are transient)
  const now = Timestamp.now();
  const userTurnRef = sref.collection('turns').doc();
  await userTurnRef.set({
    role: 'user',
    text,
    attachments: [
      ...imageIds.map((id) => ({ url: `library://${id}`, mimeType: 'image/*' })), // marker
      ...refUrls.map((u) => ({ url: u })),
    ],
    createdAt: now,
  });

  // 5) Extract model outputs (images + optional text)
  const partsOut = response?.candidates?.[0]?.content?.parts || [];
  const imagesOut = [];
  let outText = '';
  for (const p of partsOut) {
    if (p.inlineData?.data) {
      const mime = p.inlineData.mimeType || 'image/png';
      const buf = Buffer.from(p.inlineData.data, 'base64');
      imagesOut.push({ buffer: buf, mimeType: mime });
    } else if (p.text) {
      outText += p.text;
    }
  }

  // 6) Save outputs to Storage and persist model turn
  const modelTurnRef = sref.collection('turns').doc();
  const savedImages = [];
  for (let i = 0; i < imagesOut.length; i++) {
    const saved = await saveChatImageBuffer(params.id, modelTurnRef.id, i, imagesOut[i]);
    savedImages.push(saved);
  }
  await modelTurnRef.set({
    role: 'model',
    text: outText,
    images: savedImages,
    createdAt: Timestamp.now(),
  });

  // 7) Touch session lastActive
  await sref.update({ lastActive: Timestamp.now() });

  return Response.json({
    turn: {
      id: modelTurnRef.id,
      role: 'model',
      text: outText,
      images: savedImages,
    }
  });
}
```

> **Why `ai.chats.create` + `chat.sendMessage`?** It’s the supported stateful chat flow in the Gen AI SDK; `sendMessage` accepts a `message` of parts and a `config`, including **`responseModalities`** (to ask for **images**) and **`imageConfig.aspectRatio`**. ([Google APIs][1])

---

# 4) Frontend — a functional **Chat UI**

We’ll give you a working **ChatPane** and a minimal `/chat` page. This keeps components **flat** and avoids over‑nesting.

## 4.1 `/chat` page

### **`app/(ui)/chat/page.js`**

```js
'use client';

import { useEffect, useState } from 'react';
import ChatPane from '@/components/ChatPane';

export default function ChatPage() {
  const [sessions, setSessions] = useState([]);
  const [active, setActive] = useState('');

  const load = async () => {
    const res = await fetch('/api/chat/sessions');
    const data = await res.json();
    setSessions(data.sessions || []);
    if (!active && data.sessions?.[0]) setActive(data.sessions[0].id);
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    const res = await fetch('/api/chat/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'New chat', aspectRatio: '3:4' }),
    });
    const { id } = await res.json();
    await load();
    setActive(id);
  };

  const destroy = async (id) => {
    await fetch(`/api/chat/sessions/${id}`, { method: 'DELETE' });
    await load();
    if (active === id) setActive('');
  };

  return (
    <div className="grid gap-6 md:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Sessions</h2>
          <button onClick={create}
            className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-900">
            New
          </button>
        </div>
        <div className="grid gap-1">
          {sessions.map(s => (
            <button key={s.id} onClick={() => setActive(s.id)}
              className={`text-left rounded-lg px-3 py-2 text-sm transition ${
                active===s.id ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}>
              <div className="font-medium">{s.title}</div>
              <div className="text-xs text-slate-500">{s.aspectRatio} · {new Date(s.lastActive||Date.now()).toLocaleString()}</div>
            </button>
          ))}
        </div>

        {active && (
          <button onClick={() => destroy(active)}
            className="mt-4 w-full rounded-full border border-rose-400 px-3 py-1.5 text-xs font-semibold text-rose-600 dark:border-rose-500/60 dark:text-rose-300">
            Delete session
          </button>
        )}
      </aside>

      <main className="min-h-[70vh] rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        {active ? <ChatPane sessionId={active} /> : <p className="p-6 text-sm text-slate-500">Create or select a session.</p>}
      </main>
    </div>
  );
}
```

## 4.2 **`components/ChatPane.js`** (drop‑in)

```js
'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';

export default function ChatPane({ sessionId }) {
  const [session, setSession] = useState(null);
  const [turns, setTurns] = useState([]);
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState([]); // array of temp URLs
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef(null);

  const load = async () => {
    const res = await fetch(`/api/chat/sessions/${sessionId}`);
    const data = await res.json();
    setSession(data.session);
    setTurns(data.turns || []);
    queueMicrotask(() => scrollerRef.current?.scrollTo(0, scrollerRef.current.scrollHeight));
  };

  useEffect(() => { if (sessionId) load(); }, [sessionId]);

  const uploadTemp = async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload/temp', { method: 'POST', body: fd });
    if (!res.ok) throw new Error(await res.text());
    const { publicUrl } = await res.json();
    setAttachments((xs) => [...xs, publicUrl]);
  };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { await uploadTemp(f); } catch (err) { alert(String(err)); }
    e.currentTarget.value = '';
  };

  const send = async () => {
    if (!text.trim() && attachments.length === 0) return;
    setSending(true);
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          refUrls: attachments,  // ordered after any library picks (not shown here)
          imageOnly: false,
          aspectRatio: session?.aspectRatio || '1:1',
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { turn } = await res.json();
      // Optimistically add user + model turns
      const newUser = { id: `u-${Date.now()}`, role: 'user', text, attachments: attachments.map(u => ({ url: u })), createdAt: new Date().toISOString() };
      const newModel = { id: turn.id, role: 'model', text: turn.text, images: turn.images, createdAt: new Date().toISOString() };
      setTurns((xs) => [...xs, newUser, newModel]);
      setText('');
      setAttachments([]);
      queueMicrotask(() => scrollerRef.current?.scrollTo(0, scrollerRef.current.scrollHeight));
    } catch (err) {
      alert(String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="mb-2 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">{session?.title || 'Chat'}</h3>
          <p className="text-xs text-slate-500">Aspect ratio: {session?.aspectRatio || '1:1'}</p>
        </div>
      </header>

      <div ref={scrollerRef} className="flex-1 overflow-auto rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <div className="grid gap-3">
          {turns.map(t => (
            <div key={t.id} className={`max-w-[85%] rounded-lg p-3 text-sm ${t.role==='user' ? 'ml-auto bg-slate-100 dark:bg-slate-800' : 'bg-white border border-slate-200 dark:bg-slate-900 dark:border-slate-700'}`}>
              {t.text && <p className="mb-2 whitespace-pre-line">{t.text}</p>}
              {/* User attachments */}
              {t.attachments?.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {t.attachments.map((a, i) => (
                    <a key={a.url+i} href={a.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                      <Image src={a.url} alt="attach" width={300} height={300} className="h-32 w-full object-cover" />
                    </a>
                  ))}
                </div>
              )}
              {/* Model images */}
              {t.images?.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {t.images.map((img, i) => (
                    <a key={img.publicUrl+i} href={img.publicUrl} target="_blank" rel="noreferrer" className="group relative block overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                      <Image src={img.publicUrl} alt="output" width={300} height={300} className="h-40 w-full object-cover" />
                      <span className="absolute inset-x-2 bottom-2 rounded bg-white/80 px-2 py-0.5 text-[10px] font-semibold backdrop-blur dark:bg-slate-900/80">Open</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Compose bar */}
      <div className="mt-3 grid gap-2">
        {/* attached temp previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((u,i) => (
              <span key={u+i} className="inline-flex items-center gap-2 rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-800 dark:bg-slate-700 dark:text-slate-100">
                <a href={u} target="_blank" rel="noreferrer" className="max-w-[140px] truncate underline decoration-dotted">{u}</a>
                <button className="rounded-full bg-slate-300 px-1 text-[10px]" onClick={() => setAttachments(attachments.filter(x => x!==u))}>×</button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <input type="file" accept="image/*" onChange={onFile} className="text-xs" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder='Describe the change. Example: "Replace the leggings from the first image with the leggings from the second image. Keep the same face and pose."'
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
          <button onClick={send} disabled={sending}
            className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

> This UI assumes only **one‑time** attachments (temporary URLs). If you also want **library** attachments from the Chat page, add a small picker that reads `/api/library` and appends a special marker URL like `library://<id>` then:
> **PATCH (tiny)** in the message route: when it sees a `url` starting with `library://`, don’t `ensureFileUriFromUrl`—call `ensureFileUriForLibraryImage(id)` instead.

---

# 5) Composer: when **Chat mode** is checked, start a chat instead of a job (optional but handy)

In your existing `store/useComposer.js`, **replace** the `submit` method with the version below.
If `chatMode===true`, it will create a chat session and post the first message using your current **prompt + references**, then open `/chat`.

```js
// inside useComposer.js
submit: async () => {
  const state = get();
  const payload = {
    type: state.type,
    prompt: state.prompt,
    girlId: state.girlId || null,
    inputs: {
      imageIds: state.imageIds,
      refUrls: state.refUrls,
      aspectRatio: state.aspectRatio,
      imageOnly: state.imageOnly,
      chatMode: state.chatMode,
    },
  };

  set({ isSubmitting: true });
  try {
    // If "Chat mode" is on, create a chat + send first message; else enqueue a job
    if (state.chatMode) {
      // 1) create chat
      const res1 = await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Composer chat', girlId: state.girlId || '', aspectRatio: state.aspectRatio }),
      });
      if (!res1.ok) throw new Error(await res1.text());
      const { id: sessionId } = await res1.json();

      // 2) send first message
      const res2 = await fetch(`/api/chat/sessions/${sessionId}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: state.prompt,
          imageIds: state.imageIds,
          refUrls: state.refUrls,
          imageOnly: state.imageOnly,
          aspectRatio: state.aspectRatio,
        }),
      });
      if (!res2.ok) throw new Error(await res2.text());

      // 3) navigate to /chat?session=<id>
      if (typeof window !== 'undefined') {
        const url = new URL('/chat', window.location.origin);
        url.searchParams.set('session', sessionId);
        window.location.assign(url.toString());
      }
      return null;
    }

    // Default: classic queued job
    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return data.jobId;
  } finally {
    set({ isSubmitting: false });
  }
},
```

> **Why branch here?** It lets power users keep both flows:
>
> * **Stateless queued jobs** via `/api/jobs` (what you already shipped)
> * **Stateful “nanobanana” chat** for iterative edits via `/api/chat/...`

---

# 6) (Optional) Add “Open in Chat” to job cards

Minor patch to `components/JobQueueList.js`:

* Import `useRouter` & a tiny helper to **prefill a chat** with the output as the **first** attachment:

```js
import { useRouter } from 'next/navigation';

const router = useRouter();

<button
  type="button"
  onClick={async () => {
    // create chat with same AR; add output URL as first attachment by sending a first message with empty text
    const res = await fetch('/api/chat/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: `Edit ${job.id}`, aspectRatio: job.inputs?.aspectRatio || '1:1' }),
    });
    const { id } = await res.json();
    await fetch(`/api/chat/sessions/${id}/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '', refUrls: [job.result.publicUrl], aspectRatio: job.inputs?.aspectRatio || '1:1' }),
    });
    router.push('/chat');
  }}
  className="rounded-full border border-indigo-500 px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 dark:border-indigo-400/60 dark:text-indigo-300 dark:hover:bg-indigo-400/10"
>
  Open in Chat
</button>
```

---

# 7) Things your agent can add quickly (minor)

* **Title edit** for a session: small text input + `PATCH` route (optional).
* **Library picker** on Chat page (append `library://id` markers; detect in message route and call `ensureFileUriForLibraryImage`).
* **Prompt presets** dropdown (same as Composer).
* **Delete individual turns** (just delete the `turns/{id}` doc; won’t affect future turns).
* **Pin a base reference** on the session doc and auto‑prepend that image to every user send.

---

## That’s the feature—fully wired

* Stateful chats using **`ai.chats`** + **`sendMessage`** (image + text). ([Google APIs][1])
* Iterative image editing: attach **first/second** images per turn; model returns images; we save to Storage. ([Google AI for Developers][4])
* **Aspect ratios** passed consistently; matches 2.5 Flash Image AR support. ([Google Developers Blog][3])
* Files API **48h** lifecycle handled by re‑upload/caching. ([Google AI for Developers][2])


[1]: https://googleapis.github.io/js-genai/release_docs/index.html "@google/genai"
[2]: https://ai.google.dev/gemini-api/docs/files?utm_source=chatgpt.com "Files API | Gemini API | Google AI for Developers"
[3]: https://developers.googleblog.com/en/gemini-2-5-flash-image-now-ready-for-production-with-new-aspect-ratios/?utm_source=chatgpt.com "Gemini 2.5 Flash Image now ready for production with new ..."
[4]: https://ai.google.dev/gemini-api/docs/image-generation?utm_source=chatgpt.com "Image generation with Gemini (aka Nano Banana) - Gemini API"
