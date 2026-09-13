"use client";

import { useEffect, useRef, useState } from "react";
import type { Chat, Message } from "@/lib/types";
import { loadActiveId, loadChats, saveActiveId, saveChats } from "@/lib/storage";
import Sidebar from "./Sidebar";
import MessageList from "./MessageList";
import Composer from "./Composer";

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean || "New chat";
}

export default function ChatView() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // Messages live here while a response streams, so we never lose a partial reply.
  const streamingRef = useRef<{ chatId: string; message: Message } | null>(null);

  useEffect(() => {
    const stored = loadChats();
    setChats(stored);
    const last = loadActiveId();
    setActiveId(stored.find((c) => c.id === last)?.id ?? stored[0]?.id ?? null);
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) saveChats(chats);
  }, [chats, ready]);

  useEffect(() => {
    if (ready && activeId) saveActiveId(activeId);
  }, [activeId, ready]);

  const active = chats.find((c) => c.id === activeId) ?? null;
  const messages = active?.messages ?? [];

  function update(id: string, fn: (chat: Chat) => Chat) {
    setChats((prev) => prev.map((chat) => (chat.id === id ? fn(chat) : chat)));
  }

  function newChat() {
    stop();
    const chat: Chat = {
      id: uid(),
      title: "New chat",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setChats((prev) => [chat, ...prev]);
    setActiveId(chat.id);
    setError(null);
    setMenuOpen(false);
  }

  function renameChat(id: string, title: string) {
    const clean = title.trim();
    if (clean) update(id, (chat) => ({ ...chat, title: clean, updatedAt: Date.now() }));
  }

  function deleteChat(id: string) {
    setChats((prev) => {
      const next = prev.filter((chat) => chat.id !== id);
      if (id === activeId) setActiveId(next[0]?.id ?? null);
      return next;
    });
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }

  /** Streams an assistant reply for the given conversation. */
  async function run(chatId: string, history: Message[]) {
    const placeholder: Message = { id: uid(), role: "assistant", content: "" };
    streamingRef.current = { chatId, message: placeholder };
    setStreaming(true);
    setError(null);
    update(chatId, (chat) => ({ ...chat, messages: [...chat.messages, placeholder] }));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let detail = `Request failed (${res.status}).`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) detail = data.error;
        } catch {
          // non-JSON error body
        }
        throw new Error(detail);
      }

      if (!res.body) throw new Error("Empty response from server.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;

        const streamed = streamingRef.current;
        if (!streamed) break;
        streamed.message = { ...streamed.message, content: streamed.message.content + chunk };

        const { id, content } = streamed.message;
        setChats((prev) =>
          prev.map((chat) =>
            chat.id === streamed.chatId
              ? {
                  ...chat,
                  messages: chat.messages.map((m) => (m.id === id ? { ...m, content } : m)),
                }
              : chat
          )
        );
      }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      if (!aborted) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    } finally {
      // Drop the placeholder if it never received any text.
      const streamed = streamingRef.current;
      if (streamed && !streamed.message.content.trim()) {
        const { chatId: cid, message } = streamed;
        setChats((prev) =>
          prev.map((chat) =>
            chat.id === cid
              ? { ...chat, messages: chat.messages.filter((m) => m.id !== message.id) }
              : chat
          )
        );
      }
      streamingRef.current = null;
      abortRef.current = null;
      setStreaming(false);
    }
  }

  function send(text: string) {
    const clean = text.trim();
    if (!clean) return;

    let chatId = activeId;
    let history: Message[];

    if (chatId && chats.some((c) => c.id === chatId)) {
      const current = chats.find((c) => c.id === chatId);
      history = [...(current?.messages ?? []), { id: uid(), role: "user", content: clean }];
      update(chatId, (chat) => ({
        ...chat,
        title: chat.messages.length === 0 ? titleFrom(clean) : chat.title,
        messages: history,
        updatedAt: Date.now(),
      }));
    } else {
      chatId = uid();
      const chat: Chat = {
        id: chatId,
        title: titleFrom(clean),
        messages: [{ id: uid(), role: "user", content: clean }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      history = chat.messages;
      setChats((prev) => [chat, ...prev]);
      setActiveId(chatId);
    }

    void run(chatId, history);
  }

  function regenerate() {
    if (streaming || messages.length === 0) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser || !active) return;

    const index = active.messages.indexOf(lastUser);
    const history = active.messages.slice(0, index + 1);
    update(active.id, (chat) => ({ ...chat, messages: history, updatedAt: Date.now() }));
    void run(active.id, history);
  }

  const canRegenerate =
    !streaming && messages.some((m) => m.role === "user") && messages.at(-1)?.role === "assistant";

  return (
    <div className="flex h-dvh overflow-hidden bg-ink-950">
      <Sidebar
        open={menuOpen}
        chats={chats}
        activeId={activeId}
        onClose={() => setMenuOpen(false)}
        onSelect={(id) => {
          setActiveId(id);
          setMenuOpen(false);
        }}
        onNew={newChat}
        onRename={renameChat}
        onDelete={deleteChat}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-ink-800 px-3 py-2.5">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="rounded px-1.5 py-1 text-neutral-300 hover:bg-ink-800 md:hidden"
            aria-label="Open menu"
          >
            ☰
          </button>
          <span className="truncate text-sm text-neutral-300">
            {active?.title ?? "New chat"}
          </span>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={regenerate}
              disabled={!canRegenerate}
              title="Regenerate the last response"
              className="rounded-lg border border-ink-700 px-2.5 py-1 text-xs text-neutral-300 transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Regenerate
            </button>
            <button
              type="button"
              onClick={newChat}
              className="rounded-lg border border-ink-700 px-2.5 py-1 text-xs text-neutral-300 transition hover:bg-ink-800"
            >
              New chat
            </button>
          </div>
        </header>

        <MessageList
          messages={messages}
          streaming={streaming}
          error={error}
          onExample={(text) => send(text)}
        />

        <Composer streaming={streaming} onSend={send} onStop={stop} />
      </main>
    </div>
  );
}
