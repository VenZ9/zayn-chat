"use client";

import { useState } from "react";
import type { ReactNode } from "react";

/* Dependency-free markdown renderer:
   headings, lists, quotes, rules, links, bold/italic/inline code, code blocks. */

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-ink-700 bg-ink-900">
      <div className="flex items-center justify-between border-b border-ink-700 px-3 py-1.5">
        <span className="text-[11px] uppercase tracking-wide text-neutral-500">
          {lang || "code"}
        </span>
        <button
          type="button"
          onClick={copy}
          className="rounded px-2 py-0.5 text-[11px] text-neutral-400 transition hover:bg-ink-800 hover:text-neutral-100"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function inline(text: string, base: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${base}-${i++}`;

    if (tok.startsWith("`")) {
      out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("**")) {
      out.push(
        <strong key={key} className="font-semibold text-neutral-100">
          {tok.slice(2, -2)}
        </strong>
      );
    } else if (tok.startsWith("[")) {
      const split = tok.indexOf("](");
      out.push(
        <a key={key} href={tok.slice(split + 2, -1)} target="_blank" rel="noreferrer noopener">
          {tok.slice(1, split)}
        </a>
      );
    } else {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ content }: { content: string }) {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];

  let para: string[] = [];
  let list: string[] = [];
  let ordered = false;
  let key = 0;

  const flushPara = () => {
    if (!para.length) return;
    blocks.push(<p key={`p${key++}`}>{inline(para.join(" "), `p${key}`)}</p>);
    para = [];
  };

  const flushList = () => {
    if (!list.length) return;
    const items = list.map((t, idx) => <li key={idx}>{inline(t, `l${key}-${idx}`)}</li>);
    blocks.push(
      ordered ? <ol key={`o${key++}`}>{items}</ol> : <ul key={`u${key++}`}>{items}</ul>
    );
    list = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = line.match(/^\s*```(\w+)?/);
    if (fence) {
      flushPara();
      flushList();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      blocks.push(<CodeBlock key={`c${key++}`} code={buf.join("\n")} lang={fence[1]} />);
      continue;
    }

    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      const Tag = (level === 1 ? "h1" : level === 2 ? "h2" : level === 3 ? "h3" : "h4") as "h1";
      blocks.push(<Tag key={`h${key++}`}>{inline(heading[2], `h${key}`)}</Tag>);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushPara();
      flushList();
      blocks.push(<hr key={`r${key++}`} />);
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushPara();
      flushList();
      blocks.push(<blockquote key={`q${key++}`}>{inline(quote[1], `q${key}`)}</blockquote>);
      continue;
    }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (list.length && ordered) flushList();
      ordered = false;
      list.push(ul[1]);
      continue;
    }

    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      flushPara();
      if (list.length && !ordered) flushList();
      ordered = true;
      list.push(ol[1]);
      continue;
    }

    flushList();
    para.push(line.trim());
  }

  flushPara();
  flushList();

  return <div className="md">{blocks}</div>;
}
