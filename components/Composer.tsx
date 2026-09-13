"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
};

export default function Composer({ streaming, onSend, onStop }: Props) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!value && ref.current) ref.current.style.height = "auto";
  }, [value]);

  function submit() {
    const text = value.trim();
    if (!text || streaming) return;
    onSend(text);
    setValue("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter makes a newline.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  function handleInput(e: React.FormEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  return (
    <div className="border-t border-ink-800 bg-ink-950/80 backdrop-blur">
      <div className="mx-auto w-full max-w-3xl px-3 py-3 sm:px-4">
        <div className="flex items-end gap-2 rounded-2xl border border-ink-700 bg-ink-850 p-2 focus-within:border-ink-600">
          <textarea
            ref={ref}
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Message Zayn Chat…"
            className="max-h-[200px] flex-1 resize-none bg-transparent px-1.5 py-1.5 text-[15px] leading-relaxed text-neutral-100 outline-none placeholder:text-neutral-500"
          />

          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              className="shrink-0 rounded-xl bg-ink-700 px-3.5 py-2 text-sm font-medium text-neutral-100 transition hover:bg-ink-600"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!value.trim()}
              className="shrink-0 rounded-xl bg-sky-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-neutral-500"
            >
              Send
            </button>
          )}
        </div>

        <p className="mt-2 hidden text-center text-[11px] text-neutral-600 sm:block">
          Enter to send · Shift + Enter for a new line
        </p>
      </div>
    </div>
  );
}
