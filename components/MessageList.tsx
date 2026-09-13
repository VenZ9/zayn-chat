"use client";

import { useEffect, useRef } from "react";
import type { Message } from "@/lib/types";
import Markdown from "./markdown";

const EXAMPLES = [
  "Explain how a transformer neural network works.",
  "Write a Python function that reverses a linked list.",
  "Summarise the causes of World War I in 5 bullet points.",
  "Give me a 7-day beginner workout plan.",
];

function Bubble({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="mt-5 flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink-700 px-3.5 py-2.5 text-[15px] leading-relaxed text-neutral-100">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5 flex gap-3">
      <div className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-ink-700 text-center text-[11px] font-semibold leading-7 text-neutral-300">
        AI
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <Markdown content={message.content} />
      </div>
    </div>
  );
}

function Typing() {
  return (
    <div className="mt-5 flex gap-3">
      <div className="h-7 w-7 shrink-0 rounded-full bg-ink-700 text-center text-[11px] font-semibold leading-7 text-neutral-300">
        AI
      </div>
      <div className="flex items-center gap-1 pt-2.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-500"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

type Props = {
  messages: Message[];
  streaming: boolean;
  error: string | null;
  onExample: (text: string) => void;
};

export default function MessageList({ messages, streaming, error, onExample }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streaming]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-y-auto px-4 py-10">
        <div className="w-full max-w-lg text-center">
          <h1 className="text-2xl font-semibold text-neutral-100">Zayn Chat</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Ask anything. Answers stream in as they are written.
          </p>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => onExample(example)}
                className="rounded-lg border border-ink-700 bg-ink-850 p-3 text-left text-[13px] leading-snug text-neutral-300 transition hover:border-ink-600 hover:text-neutral-100"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-4">
        {messages.map((message) => (
          <Bubble key={message.id} message={message} />
        ))}

        {streaming && <Typing />}

        {error && (
          <p className="mt-5 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-[13px] text-red-300">
            {error}
          </p>
        )}

        <div ref={endRef} />
      </div>
    </div>
  );
}
