import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Msg = { role: "user" | "assistant"; content: string };

const MAX_MESSAGES = 40;
const MAX_CHARS = 12000;

// Abort the upstream request if OpenRouter goes quiet for this long...
const IDLE_TIMEOUT_MS = 30_000;
// ...or if the whole stream runs longer than this, headers included.
const TOTAL_TIMEOUT_MS = 180_000;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;

  if (!apiKey || !model) {
    return Response.json(
      { error: "Server is missing OPENROUTER_API_KEY or OPENROUTER_MODEL." },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const raw = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(raw) || raw.length === 0) {
    return Response.json({ error: "No messages provided." }, { status: 400 });
  }

  const messages = buildMessages(raw);
  if (messages.length === 0) {
    return Response.json({ error: "No valid messages provided." }, { status: 400 });
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-Title": process.env.OPENROUTER_APP_NAME || "Zayn Chat",
  };
  if (process.env.OPENROUTER_SITE_URL) {
    headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL;
  }

  // One controller governs the whole upstream call: connect, headers AND body
  // streaming. It is fired by the total timer, the idle timer, or the client.
  const upstreamAbort = new AbortController();

  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const totalTimer = setTimeout(
    () => upstreamAbort.abort(new Error("Upstream exceeded the total time limit.")),
    TOTAL_TIMEOUT_MS
  );

  const bumpIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => upstreamAbort.abort(new Error("Upstream stalled mid-stream.")),
      IDLE_TIMEOUT_MS
    );
  };

  const onClientAbort = () =>
    upstreamAbort.abort(new Error("Client disconnected."));

  if (req.signal.aborted) onClientAbort();
  else req.signal.addEventListener("abort", onClientAbort, { once: true });

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(totalTimer);
    if (idleTimer) clearTimeout(idleTimer);
    req.signal.removeEventListener("abort", onClientAbort);
  };

  let upstream: Response;
  try {
    bumpIdle();
    upstream = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages, stream: true }),
      signal: upstreamAbort.signal,
    });
  } catch (err) {
    cleanup();
    if (upstreamAbort.signal.aborted) {
      const reason = String(upstreamAbort.signal.reason?.message ?? "Upstream aborted.");
      return Response.json({ error: reason }, { status: 504 });
    }
    return Response.json(
      { error: "Could not reach OpenRouter. " + String((err as Error)?.message ?? "") },
      { status: 502 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    let detail = `OpenRouter request failed (${upstream.status}).`;
    try {
      const err = (await upstream.json()) as { error?: { message?: string } };
      if (err?.error?.message) detail = String(err.error.message);
    } catch {
      // response body was not JSON - keep the generic message
    }
    cleanup();
    return Response.json({ error: detail }, { status: upstream.status || 502 });
  }

  return new Response(
    toTextStream(upstream.body, { onChunk: bumpIdle, onEnd: cleanup }),
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    }
  );
}

/**
 * Keep the newest turns inside MAX_CHARS. We walk the conversation backwards so
 * recent context always wins the budget, then restore chronological order.
 *
 * Leading assistant turns are dropped up front: a truncated older answer is not
 * useful context, and letting one consume the budget (or leaving the array
 * starting on an assistant turn) is what previously emptied the request.
 */
function buildMessages(raw: unknown[]): Msg[] {
  const turns: Msg[] = [];
  for (const item of raw) {
    const role = (item as { role?: unknown } | null)?.role;
    const content = (item as { content?: unknown } | null)?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const trimmed = content.trim();
    if (!trimmed) continue;
    turns.push({ role, content: trimmed });
  }

  while (turns.length > 0 && turns[0].role !== "user") turns.shift();

  const kept: Msg[] = [];
  let spent = 0;
  for (let i = turns.length - 1; i >= 0 && kept.length < MAX_MESSAGES; i--) {
    const room = MAX_CHARS - spent;
    if (room <= 0) break;
    const turn = turns[i];
    const content = turn.content.length > room ? turn.content.slice(0, room) : turn.content;
    kept.push({ role: turn.role, content });
    spent += content.length;
  }
  kept.reverse();

  // Trimming the oldest turn can expose an assistant turn (or the budget can run
  // out entirely) - drop those too so the request always opens with a user turn.
  while (kept.length > 0 && kept[0].role !== "user") kept.shift();

  return kept;
}

/** Turn OpenRouter's SSE stream into a plain text stream of answer deltas. */
function toTextStream(
  stream: ReadableStream<Uint8Array>,
  hooks: { onChunk: () => void; onEnd: () => void }
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let ended = false;

  const end = () => {
    if (ended) return;
    ended = true;
    hooks.onEnd();
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          end();
          controller.close();
          return;
        }

        hooks.onChunk();

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        let out = "";
        for (const event of events) {
          for (const line of event.split("\n")) {
            const text = line.trim();
            if (!text.startsWith("data:")) continue;
            const data = text.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const json = JSON.parse(data) as {
                choices?: { delta?: { content?: string | null } }[];
              };
              const delta = json.choices?.[0]?.delta?.content;
              if (typeof delta === "string" && delta) out += delta;
            } catch {
              // partial chunk or keep-alive comment - skip
            }
          }
        }

        if (out) controller.enqueue(encoder.encode(out));
      } catch (err) {
        end();
        controller.error(err);
      }
    },
    cancel(reason) {
      end();
      return reader.cancel(reason).catch(() => {});
    },
  });
}
