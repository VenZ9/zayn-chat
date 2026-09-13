import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Msg = { role: "user" | "assistant"; content: string };

const MAX_MESSAGES = 40;
const MAX_CHARS = 12000;

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

  // Keep only well-formed user/assistant turns, newest last, within a small budget.
  const messages: Msg[] = [];
  let budget = MAX_CHARS;
  for (const item of raw.slice(-MAX_MESSAGES)) {
    const role = (item as { role?: unknown } | null)?.role;
    const content = (item as { content?: unknown } | null)?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const trimmed = content.trim();
    if (!trimmed) continue;
    const clipped = trimmed.slice(0, budget);
    budget -= clipped.length;
    messages.push({ role, content: clipped });
    if (budget <= 0) break;
  }

  // OpenRouter needs the conversation to start with a user turn.
  while (messages.length > 0 && messages[0].role !== "user") messages.shift();
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

  let upstream: Response;
  try {
    upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages, stream: true }),
    });
  } catch {
    return Response.json({ error: "Could not reach OpenRouter." }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    let detail = `OpenRouter request failed (${upstream.status}).`;
    try {
      const err = (await upstream.json()) as { error?: { message?: string } };
      if (err?.error?.message) detail = String(err.error.message);
    } catch {
      // response body was not JSON - keep the generic message
    }
    return Response.json({ error: detail }, { status: upstream.status || 502 });
  }

  return new Response(toTextStream(upstream.body), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Turn OpenRouter's SSE stream into a plain text stream of answer deltas. */
function toTextStream(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
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

        if (out) controller.enqueue(encoder.encode(out));
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}
