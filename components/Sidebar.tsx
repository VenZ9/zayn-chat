"use client";

import { useEffect, useRef, useState } from "react";
import type { Chat } from "@/lib/types";

type Props = {
  open: boolean;
  chats: Chat[];
  activeId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
};

export default function Sidebar({
  open,
  chats,
  activeId,
  onClose,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) inputRef.current?.focus();
  }, [editingId]);

  function startRename(chat: Chat) {
    setEditingId(chat.id);
    setDraft(chat.title);
  }

  function commitRename() {
    if (editingId) onRename(editingId, draft);
    setEditingId(null);
  }

  return (
    <>
      {open && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-40 flex h-full w-[260px] shrink-0 flex-col border-r border-ink-800 bg-ink-900 transition-transform duration-200 md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between p-3">
          <span className="text-sm font-semibold text-neutral-100">Zayn Chat</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-1.5 text-neutral-400 hover:text-neutral-100 md:hidden"
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        <button
          type="button"
          onClick={onNew}
          className="mx-3 mb-3 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-left text-[13px] font-medium text-neutral-200 transition hover:border-ink-600 hover:bg-ink-800"
        >
          + New chat
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-neutral-500">
            History
          </p>

          {chats.length === 0 && (
            <p className="px-2 py-2 text-xs text-neutral-500">No chats yet.</p>
          )}

          {chats.map((chat) =>
            editingId === chat.id ? (
              <input
                key={chat.id}
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setEditingId(null);
                }}
                className="my-0.5 w-full rounded-md border border-sky-700 bg-ink-800 px-2 py-1.5 text-[13px] text-neutral-100 outline-none"
              />
            ) : (
              <div
                key={chat.id}
                className={`group my-0.5 flex items-center gap-1 rounded-md px-2 py-1.5 ${
                  chat.id === activeId ? "bg-ink-800" : "hover:bg-ink-850"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(chat.id)}
                  title={chat.title}
                  className={`min-w-0 flex-1 truncate text-left text-[13px] ${
                    chat.id === activeId ? "text-neutral-100" : "text-neutral-400"
                  }`}
                >
                  {chat.title}
                </button>
                <button
                  type="button"
                  onClick={() => startRename(chat)}
                  title="Rename"
                  className="shrink-0 rounded px-1 text-[11px] text-neutral-600 hover:text-neutral-200"
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(chat.id)}
                  title="Delete"
                  className="shrink-0 rounded px-1 text-[11px] text-neutral-600 hover:text-red-400"
                >
                  ✕
                </button>
              </div>
            )
          )}
        </div>

        <p className="border-t border-ink-800 p-3 text-[11px] leading-snug text-neutral-600">
          Chats are saved in this browser only.
        </p>
      </aside>
    </>
  );
}
