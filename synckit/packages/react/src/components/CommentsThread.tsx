import { type JsonValue } from "@synckit/client";
import { useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";

import { useComments, type CommentView } from "../hooks.js";
import { colorFor, initialsOf, relativeTime } from "../store.js";

const surface: CSSProperties = {
  font: "var(--synckit-font, 400 14px system-ui, sans-serif)",
  color: "var(--synckit-text, #18181b)",
  background: "var(--synckit-surface, #fff)",
  border: "var(--synckit-border, 1px solid #e4e4e7)",
  borderRadius: "var(--synckit-radius, 8px)",
  padding: 12,
  maxWidth: 420,
};

const buttonStyle: CSSProperties = {
  font: "var(--synckit-font, 500 13px system-ui, sans-serif)",
  background: "var(--synckit-accent, #4f46e5)",
  color: "#fff",
  border: "none",
  borderRadius: "var(--synckit-radius, 8px)",
  padding: "6px 12px",
  cursor: "pointer",
};

const subtleButton: CSSProperties = {
  ...buttonStyle,
  background: "transparent",
  color: "var(--synckit-muted, #71717a)",
  padding: "2px 6px",
};

function Composer({
  onSubmit,
  placeholder,
  autoFocus,
}: {
  onSubmit: (body: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const [body, setBody] = useState("");

  const submit = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setBody("");
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
      <textarea
        aria-label={placeholder}
        placeholder={placeholder}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
        autoFocus={autoFocus}
        style={{
          flex: 1,
          resize: "vertical",
          font: "inherit",
          padding: 8,
          border: "var(--synckit-border, 1px solid #e4e4e7)",
          borderRadius: "var(--synckit-radius, 8px)",
        }}
      />
      <button type="submit" style={buttonStyle} disabled={!body.trim()}>
        Send
      </button>
    </form>
  );
}

function CommentItem({
  comment,
  onResolve,
}: {
  comment: CommentView;
  onResolve?: (resolved: boolean) => void;
}) {
  const resolved = comment.resolvedAt !== null;
  return (
    <div
      data-testid={`comment-${comment.id}`}
      style={{ display: "flex", gap: 8, opacity: comment.pending ? 0.55 : 1 }}
    >
      <span
        aria-hidden
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: colorFor(comment.endUserId),
          color: "#fff",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          font: "var(--synckit-font, 600 10px system-ui, sans-serif)",
          flexShrink: 0,
        }}
      >
        {initialsOf(null, comment.endUserId)}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
          <strong style={{ fontSize: 13 }}>{comment.endUserId}</strong>
          <time
            dateTime={comment.createdAt}
            style={{ color: "var(--synckit-muted, #71717a)", fontSize: 12 }}
          >
            {comment.pending ? "sending…" : relativeTime(comment.createdAt)}
          </time>
          {onResolve && (
            <button
              type="button"
              aria-pressed={resolved}
              onClick={() => onResolve(!resolved)}
              style={{ ...subtleButton, marginLeft: "auto" }}
            >
              {resolved ? "Resolved ✓" : "Resolve"}
            </button>
          )}
        </div>
        <p
          style={{
            margin: "2px 0 0",
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
            ...(resolved ? { color: "var(--synckit-muted, #71717a)" } : {}),
          }}
        >
          {comment.body}
        </p>
      </div>
    </div>
  );
}

/**
 * Complete comment thread UI for a room (optionally scoped to an anchor):
 * composer, threaded replies, resolve/unresolve and optimistic sends.
 */
export function CommentsThread({ anchor }: { anchor?: JsonValue }) {
  const { comments, isLoading, error, create, resolve } = useComments(
    anchor === undefined ? {} : { anchor },
  );
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  const roots = comments.filter((comment) => comment.threadId === null);
  const repliesOf = (rootId: string) => comments.filter((comment) => comment.threadId === rootId);

  return (
    <section aria-label="Comments" style={surface}>
      {isLoading && <p style={{ color: "var(--synckit-muted, #71717a)" }}>Loading comments…</p>}
      {error && (
        <p role="alert" style={{ color: "var(--synckit-danger, #dc2626)" }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {roots.map((root) => (
          <div key={root.id}>
            <CommentItem
              comment={root}
              onResolve={(resolved) => void resolve(root.id, resolved).catch(() => undefined)}
            />
            <div
              style={{
                marginLeft: 32,
                marginTop: 6,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {repliesOf(root.id).map((reply) => (
                <CommentItem key={reply.id} comment={reply} />
              ))}
              {replyingTo === root.id ? (
                <Composer
                  autoFocus
                  placeholder="Reply…"
                  onSubmit={(body) => {
                    setReplyingTo(null);
                    void create({ body, threadId: root.id }).catch(() => undefined);
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setReplyingTo(root.id)}
                  style={{ ...subtleButton, alignSelf: "flex-start" }}
                >
                  Reply
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: roots.length > 0 ? 14 : 0 }}>
        <Composer
          placeholder="Add a comment"
          onSubmit={(body) => void create({ body }).catch(() => undefined)}
        />
      </div>
    </section>
  );
}
