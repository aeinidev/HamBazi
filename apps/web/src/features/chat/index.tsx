import { useEffect, useRef, useState } from "react";
import { okValue } from "../../platform/contracts.js";
import { ClientError } from "../../platform/errors.js";
import { ErrorNotice, Panel, useRuntime, useSession, useTask } from "../../ui/shared.js";
import {
  chatMessageSchema,
  chatPageSchema,
  createChatFeed,
  type ChatMessage,
} from "./contracts.js";
export { chatMessageSchema, chatPageSchema, createChatFeed } from "./contracts.js";
export type { ChatMessage } from "./contracts.js";
export function MatchChat({ matchId }: { matchId: string }) {
  const runtime = useRuntime();
  const connection = useSession((state) => state.connection);
  const session = useSession((state) => state.session);
  const role = useSession((state) =>
    state.snapshot?.matchId === matchId ? state.snapshot.role : null,
  );
  const feed = useRef(createChatFeed(matchId));
  const active = useRef(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [canSend, setCanSend] = useState(false);
  const [limit, setLimit] = useState(500);
  const [older, setOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef<(older?: boolean) => Promise<void>>(async () => {});
  const task = useTask();
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      feed.current.clear();
    };
  }, []);
  useEffect(() => {
    let alive = true;
    let busy = false;
    const current = feed.current;
    current.clear();
    setMessages([]);
    setCanSend(false);
    setLoading(true);
    setError(null);
    if (connection !== "connected" || !session) return;
    const realtime = runtime.realtime();
    const update = () => {
      if (alive) setMessages(current.messages());
    };
    async function load(history = false) {
      if (!alive || busy) return;
      busy = true;
      try {
        const mode = history ? "older" : current.cursor() === 0 ? "latest" : "after";
        for (let batch = 0; batch < 4; batch++) {
          const requestedMode = batch === 3 ? "latest" : mode;
          const body = {
            schemaVersion: 1,
            matchId,
            ...(requestedMode === "older"
              ? { beforeSeq: current.messages()[0]?.seq }
              : requestedMode === "after"
                ? { afterSeq: current.cursor() }
                : {}),
          };
          const result = await realtime.request("chat:list", body, okValue(chatPageSchema));
          if (!alive) return;
          const page = current.page(result.value, requestedMode);
          if (!page) throw new ClientError("INVALID_RESPONSE");
          setCanSend(page.canSend);
          setLimit(page.messageLimit);
          setError(null);
          setLoading(false);
          if (requestedMode === "latest" || requestedMode === "older") setOlder(page.hasMore);
          update();
          if (mode !== "after" || !page.hasMore) break;
        }
      } catch (error) {
        if (alive) {
          setCanSend(false);
          setLoading(false);
          setError(error);
        }
      } finally {
        busy = false;
      }
    }
    loadRef.current = load;
    const stop = realtime.onChat((message) => {
      if (!alive || message.matchId !== matchId) return;
      const action = current.event(message);
      if (action === "APPLY") update();
      if (action === "GAP") void load();
    });
    void load();
    // History repairs absent subscribers or lost wakeups; no plaintext browser storage.
    const timer = setInterval(() => {
      void load();
    }, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
      stop();
      current.clear();
      loadRef.current = async () => {};
    };
  }, [matchId, runtime, connection, session]);
  useEffect(() => {
    if (role === "SPECTATOR") {
      setCanSend(false);
      void loadRef.current();
    }
  }, [role]);
  const sendingAllowed = canSend && role !== "SPECTATOR";
  const valid =
    [...draft.normalize("NFC").trim()].length > 0 &&
    [...draft.normalize("NFC").trim()].length <= limit;
  return (
    <Panel title="Match chat">
      {connection !== "connected" && <p role="status">Chat reconnecting…</p>}
      {loading && connection === "connected" && <p role="status">Loading chat…</p>}
      {error !== null && (
        <ErrorNotice
          error={error}
          retry={() => {
            void loadRef.current();
          }}
        />
      )}
      {older && (
        <button
          className="secondary"
          disabled={connection !== "connected" || messages.length > 150}
          onClick={() => {
            void loadRef.current(true);
          }}
        >
          Earlier messages
        </button>
      )}
      {messages.length === 200 && <p className="quiet">Showing up to 200 messages.</p>}
      <ol
        className="chat-messages"
        aria-label="Chat messages"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.map((message) => (
          <li key={message.messageId}>
            <span className="quiet">
              {message.userId === session?.userId ? "You" : "Match member"}
            </span>
            <p dir="auto">{message.text}</p>
          </li>
        ))}
      </ol>
      {!canSend && !loading && !error && connection === "connected" && (
        <p role="status">Chat is read-only for spectators.</p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!sendingAllowed || !valid || task.blocked) return;
          const body = { schemaVersion: 1, matchId, commandId: crypto.randomUUID(), text: draft };
          task.run(async () => {
            const result = await runtime
              .realtime()
              .request("chat:send", body, okValue(chatMessageSchema));
            if (!active.current) return;
            const action = feed.current.event(result.value);
            if (action === "APPLY") setMessages(feed.current.messages());
            if (action === "INVALID") throw new ClientError("INVALID_RESPONSE");
            setDraft("");
            await loadRef.current();
          });
        }}
      >
        <label htmlFor="chat-message">Message</label>
        <input
          id="chat-message"
          autoComplete="off"
          value={draft}
          maxLength={1000}
          disabled={!sendingAllowed || connection !== "connected" || task.blocked}
          onChange={(event) => setDraft(event.target.value)}
        />
        <p className="quiet">
          {[...draft.normalize("NFC").trim()].length} / {limit}
        </p>
        <button disabled={!sendingAllowed || connection !== "connected" || task.blocked || !valid}>
          Send message
        </button>
      </form>
      {task.notice}
    </Panel>
  );
}
