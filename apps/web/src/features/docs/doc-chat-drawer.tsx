import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Copy, CornerDownLeft, LoaderCircle, MessageCircle, Sparkles, X } from "lucide-react";
import { cn } from "@data-vault/ui";
import type { AiBlock, NoteChatTurn } from "@data-vault/types";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text?: string;
  blocks?: AiBlock[];
  createdAt: Date;
}

interface DocChatDrawerProps {
  open: boolean;
  onClose: () => void;
  noteTitle: string;
  onAsk: (question: string, history: NoteChatTurn[]) => Promise<{ blocks: AiBlock[] }>;
  onInsertToDoc: (blocks: AiBlock[]) => void;
  onNotify: (msg: string, tone?: "success" | "error") => void;
}

export function DocChatDrawer({
  open,
  onClose,
  noteTitle,
  onAsk,
  onInsertToDoc,
  onNotify,
}: DocChatDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendQuestion = async (text: string) => {
    const question = text.trim();
    if (!question || loading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: question,
      createdAt: new Date(),
    };

    const history: NoteChatTurn[] = messages.map((m) => ({
      role: m.role,
      text: m.text ?? (m.blocks ? blocksToPlainText(m.blocks) : ""),
    }));

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const response = await onAsk(question, history);
      const botMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        blocks: response.blocks,
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch (caught) {
      onNotify(caught instanceof Error ? caught.message : "Could not get an answer.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (msg: ChatMessage) => {
    const text = msg.text ?? (msg.blocks ? blocksToPlainText(msg.blocks) : "");
    void navigator.clipboard.writeText(text);
    setCopiedId(msg.id);
    setTimeout(() => setCopiedId(null), 2000);
    onNotify("Answer copied to clipboard");
  };

  const handleInsert = (blocks: AiBlock[]) => {
    onInsertToDoc(blocks);
    onNotify("Inserted into doc");
  };

  if (!open) return null;

  const suggestions = [
    "Summarize key takeaways",
    "Extract action items & tasks",
    "Explain this in simple terms",
    "What are the main arguments?",
  ];

  return (
    <aside
      aria-label="Doc AI Chat"
      className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-surface shadow-2xl sm:w-[420px]"
    >
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b border-line px-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="grid size-8 place-items-center rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400">
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-ink">Doc AI Chat</h3>
            <p className="truncate text-xs text-muted">{noteTitle || "Current doc"}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close chat"
          className="grid size-8 place-items-center rounded-lg text-muted hover:bg-soft hover:text-ink transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Message List */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
        {messages.length === 0 ? (
          <div className="py-8 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-purple-50 text-purple-600 dark:bg-purple-950/50 dark:text-purple-400">
              <MessageCircle className="size-6" />
            </span>
            <p className="mt-3 text-sm font-medium text-ink">Ask anything about this doc</p>
            <p className="mt-1 text-xs text-muted">
              Answers are strictly grounded in your doc content and web clips.
            </p>
            <div className="mt-5 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Suggested questions</p>
              <div className="flex flex-col gap-1.5">
                {suggestions.map((s, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => void sendQuestion(s)}
                    className="rounded-xl border border-line bg-canvas/60 px-3 py-2 text-left text-xs font-medium text-strong hover:bg-soft transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={cn("flex flex-col", msg.role === "user" ? "items-end" : "items-start")}
            >
              {msg.role === "user" ? (
                <div className="max-w-[85%] rounded-2xl rounded-tr-xs bg-ink px-3.5 py-2.5 text-xs text-canvas">
                  <p className="whitespace-pre-wrap">{msg.text}</p>
                </div>
              ) : (
                <div className="group relative max-w-[95%] space-y-2 rounded-2xl rounded-tl-xs border border-line bg-soft/60 p-3.5 text-xs text-ink">
                  {msg.blocks ? renderBlocks(msg.blocks) : <p>{msg.text}</p>}

                  <div className="flex items-center gap-1.5 pt-1 border-t border-line/60">
                    <button
                      onClick={() => handleCopy(msg)}
                      title="Copy answer"
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted hover:bg-soft hover:text-ink transition-colors"
                    >
                      {copiedId === msg.id ? <Check className="size-3 text-green-600" /> : <Copy className="size-3" />}
                      <span>{copiedId === msg.id ? "Copied" : "Copy"}</span>
                    </button>
                    {msg.blocks ? (
                      <button
                        onClick={() => handleInsert(msg.blocks!)}
                        title="Insert into document"
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-purple-700 hover:bg-purple-50 dark:text-purple-300 dark:hover:bg-purple-950/60 transition-colors"
                      >
                        <CornerDownLeft className="size-3" />
                        <span>Insert into doc</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          ))
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted">
            <LoaderCircle className="size-3.5 animate-spin text-purple-600" />
            <span>AI is reviewing doc and thinking…</span>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="border-t border-line p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendQuestion(input);
          }}
          className="relative flex items-center"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about this doc…"
            disabled={loading}
            className="w-full rounded-2xl border border-line bg-canvas px-4 py-2.5 pr-11 text-xs text-ink outline-none placeholder:text-muted focus:border-purple-600 focus:ring-1 focus:ring-purple-600"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            aria-label="Send question"
            className="absolute right-1.5 grid size-7 place-items-center rounded-xl bg-purple-600 text-white transition-opacity disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        </form>
        <p className="mt-1.5 text-center text-[10px] text-muted">
          Only reads content inside this document.
        </p>
      </div>
    </aside>
  );
}

function renderBlocks(blocks: AiBlock[]) {
  return (
    <div className="space-y-2 leading-relaxed">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case "heading":
            return (
              <h4 key={idx} className="font-semibold text-ink pt-1 first:pt-0">
                {block.text}
              </h4>
            );
          case "paragraph":
            return <p key={idx}>{block.text}</p>;
          case "bullets":
            return (
              <ul key={idx} className="space-y-1 pl-3 list-disc">
                {block.items?.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            );
          case "numbered":
            return (
              <ol key={idx} className="space-y-1 pl-3 list-decimal">
                {block.items?.map((item, i) => <li key={i}>{item}</li>)}
              </ol>
            );
          case "checklist":
            return (
              <ul key={idx} className="space-y-1 pl-1">
                {block.items?.map((item, i) => (
                  <li key={i} className="flex items-center gap-1.5">
                    <span className="text-muted">☐</span>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            );
          case "quote":
            return (
              <blockquote key={idx} className="border-l-2 border-purple-500 pl-2 italic text-muted">
                {block.text}
              </blockquote>
            );
          case "table":
            return (
              <div key={idx} className="overflow-x-auto my-1">
                <table className="w-full text-[11px] border-collapse border border-line">
                  {block.header?.length ? (
                    <thead>
                      <tr className="bg-soft">
                        {block.header.map((h, hi) => (
                          <th key={hi} className="border border-line px-2 py-1 text-left font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                  ) : null}
                  <tbody>
                    {block.rows?.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci} className="border border-line px-2 py-1">{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

function blocksToPlainText(blocks: AiBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "heading") parts.push(`\n### ${block.text}\n`);
    else if (block.type === "paragraph") parts.push(block.text ?? "");
    else if (block.type === "bullets" && block.items) {
      parts.push(block.items.map((it) => `- ${it}`).join("\n"));
    } else if (block.type === "numbered" && block.items) {
      parts.push(block.items.map((it, i) => `${i + 1}. ${it}`).join("\n"));
    } else if (block.type === "checklist" && block.items) {
      parts.push(block.items.map((it) => `- [ ] ${it.text}`).join("\n"));
    } else if (block.type === "quote") parts.push(`> ${block.text ?? ""}`);
    else if (block.type === "table") {
      if (block.header) parts.push(block.header.join(" | "));
      if (block.rows) {
        for (const row of block.rows) parts.push(row.join(" | "));
      }
    }
  }
  return parts.join("\n\n");
}
