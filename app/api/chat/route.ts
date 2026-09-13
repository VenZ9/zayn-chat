import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Msg = { role: "user" | "assistant"; content: string };

const MAX_MESSAGES = 40;
const MAX_CHARS = 12000;

// OpenRouter must send response headers within this long. Free models are often
// queued upstream while capacity is found, and without a bound here the browser
// just sits on a pending request until its own timeout fires - which shows up as
// "Failed to fetch" with no explanation of what actually went wrong.
const TTFB_TIMEOUT_MS = 60_000;
// Once the answer is streaming, this much silence means the provider died.
const IDLE_TIMEOUT_MS = 30_000;
// ...and the whole request can never outlive this, headers included.
const TOTAL_TIMEOUT_MS = 180_000;

const INTERRUPT_NOTICE: Record<string, string> = {
  idle: "the model stopped responding.",
  total: `the request hit the ${TOTAL_TIMEOUT_MS / 1000}s time limit.`,
  ttfb: "OpenRouter did not respond in time.",
};

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function POST(req: NextRequest) {
  const reqId = Math.random().toString(36).slice(2, 8);
  const startedAt = Date.now();
  const elapsed = () => `${Date.now() - startedAt}ms`;
  const log = (...parts: unknown[]) => console.log(`[chat ${reqId}]`, ...parts);

  log("stage=received POST /api/chat");

  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;

  if (!apiKey || !model) {
    log("stage=config rejected: missing OPENROUTER_API_KEY or OPENROUTER_MODEL");
    return Response.json(
      { error: "Server is missing OPENROUTER_API_KEY or OPENROUTER_MODEL." },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    log("stage=parse rejected: invalid JSON body");
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const raw = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(raw) || raw.length === 0) {
    log("stage=parse rejected: no messages provided");
    return Response.json({ error: "No messages provided." }, { status: 400 });
  }

  const messages = buildMessages(raw);
  if (messages.length === 0) {
    log("stage=parse rejected: no valid messages", { received: raw.length });
    return Response.json({ error: "No valid messages provided." }, { status: 400 });
  }

  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  log("stage=parsed", { received: raw.length, forwarded: messages.length, chars });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-Title": process.env.OPENROUTER_APP_NAME || "Zayn Chat",
  };
  if (process.env.OPENROUTER_SITE_URL) {
    headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL;
  }

  // One controller governs the whole upstream call: connect, headers AND body
  // streaming. It is fired by the TTFB timer, the idle timer, the total timer or
  // the client disconnecting.
  const upstreamAbort = new AbortController();
  let abortReason: "ttfb" | "idle" | "total" | "client" | null = null;

  const abortWith = (reason: "ttfb" | "idle" | "total", message: string) => {
    if (upstreamAbort.signal.aborted) return;
    abortReason = reason;
    log(`stage=timeout reason=${reason} at ${elapsed()}`);
    upstreamAbort.abort(new Error(message));
  };

  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  // Before headers arrive the idle bound is not armed: while we are waiting for
  // OpenRouter there is exactly one thing that can be late, so only bound that.
  const ttfbTimer = setTimeout(
    () =>
      abortWith(
        "ttfb",
        `OpenRouter did not send response headers within ${TTFB_TIMEOUT_MS / 1000}s.`
      ),
    TTFB_TIMEOUT_MS
  );

  const totalTimer = setTimeout(
    () =>
      abortWith(
        "total",
        `OpenRouter exceeded the ${TOTAL_TIMEOUT_MS / 1000}s request limit.`
      ),
    TOTAL_TIMEOUT_MS
  );

  // Once streaming starts, silence is what we bound instead.
  const bumpIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () =>
        abortWith(
          "idle",
          `OpenRouter stopped sending data for ${IDLE_TIMEOUT_MS / 1000}s.`
        ),
      IDLE_TIMEOUT_MS
    );
  };

  const onClientAbort = () => {
    if (upstreamAbort.signal.aborted) return;
    abortReason = "client";
    log(`stage=client-disconnected at ${elapsed()}`);
    upstreamAbort.abort(new Error("Client disconnected."));
  };

  if (req.signal.aborted) onClientAbort();
  else req.signal.addEventListener("abort", onClientAbort, { once: true });

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(ttfbTimer);
    clearTimeout(totalTimer);
    if (idleTimer) clearTimeout(idleTimer);
    req.signal.removeEventListener("abort", onClientAbort);
  };

  let upstream: Response;
  try {
    log(`stage=requesting-openrouter model=${model} stream=true url=${OPENROUTER_URL}`);
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
      log(`stage=aborted-before-headers reason=${abortReason} at ${elapsed()}: ${reason}`);
      // The client is already gone in this case, so the body never reaches anyone.
      return Response.json({ error: reason }, { status: 504 });
    }
    log(`stage=network-error at ${elapsed()}: ${String((err as Error)?.message ?? "")}`);
    return Response.json(
      { error: "Could not reach OpenRouter. " + String((err as Error)?.message ?? "") },
      { status: 502 }
    );
  }

  clearTimeout(ttfbTimer);
  log(`stage=openrouter-headers status=${upstream.status} ttfb=${elapsed()}`);

  if (!upstream.ok || !upstream.body) {
    let detail = `OpenRouter request failed (${upstream.status}).`;
    try {
      const err = (await upstream.json()) as { error?: { message?: string } };
      if (err?.error?.message) detail = String(err.error.message);
    } catch {
      // response body was not JSON - keep the generic message
    }
    log(`stage=openrouter-error status=${upstream.status} detail=${detail}`);
    cleanup();
    return Response.json({ error: detail }, { status: upstream.status || 502 });
  }

  let sawFirstChunk = false;
  let outChars = 0;

  return new Response(
    toTextStream(upstream.body, {
      onChunk: (chars) => {
        if (!sawFirstChunk) {
          sawFirstChunk = true;
          log(`stage=first-chunk at ${elapsed()}`);
        }
        outChars += chars;
        bumpIdle();
      },
      onEnd: (reason) => {
        log(`stage=stream-end reason=${reason} chars=${outChars} total=${elapsed()}`);
        cleanup();
      },
      abortReason: () => abortReason,
    }),
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
  hooks: {
    onChunk: (chars: number) => void;
    onEnd: (reason: string) => void;
    abortReason: () => "ttfb" | "idle" | "total" | "client" | null;
  }
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let ended = false;

  const finish = (reason: string) => {
    if (ended) return false;
    ended = true;
    hooks.onEnd(reason);
    return true;
  };

  const close = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    try {
      controller.close();
    } catch {
      // already closed or cancelled - nothing to do
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          finish("complete");
          close(controller);
          return;
        }

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

        hooks.onChunk(out.length);
        if (out) controller.enqueue(encoder.encode(out));
      } catch (err) {
        const reason = hooks.abortReason();
        const label = reason ?? `error:${String((err as Error)?.message ?? err)}`;
        if (finish(label) && reason && reason !== "client") {
          // Do NOT error the stream here. A destroyed response surfaces in the
          // browser as a bare "Failed to fetch" and discards the text that was
          // already rendered. Close it cleanly and explain the cut in-band.
          try {
            controller.enqueue(
              encoder.encode(`\n\n[Response interrupted - ${INTERRUPT_NOTICE[reason]}]`)
            );
          } catch {
            // stream no longer writable - the notice is best-effort
          }
        }
        close(controller);
      }
    },
    cancel(reason) {
      finish("cancelled");
      return reader.cancel(reason).catch(() => {});
    },
  });
}
