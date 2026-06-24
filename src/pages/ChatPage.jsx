import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Plot from "react-plotly.js";
import { useAuth } from "../auth/useAuth";
import "./ChatPage.css";

function parseJwt(token) {
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch {
    return {};
  }
}

function initialsFromName(name = "", email = "") {
  const source = name || email.split("@")[0] || "U";
  const parts = source.replace(/[._-]/g, " ").trim().split(/\s+/);
  return (parts[0]?.[0] || "U").concat(parts[1]?.[0] || "").toUpperCase();
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return "";
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

const SUGGESTIONS = [
  { label: "Map a landscape", hint: "Show patent families around aripiprazole formulations" },
  { label: "Find whitespace", hint: "Where are competitors NOT filing in long-acting injectables?" },
  { label: "Compare claims", hint: "Compare independent claims across our top 3 families" },
  { label: "Track a rival", hint: "Recent filings assigned to a named competitor" },
];

// Friendlier step labels than raw tool names.
const TOOL_LABELS = {
  lookup_cpc: "Resolving CPC classification",
  get_leaderboard: "Ranking entities",
  get_entity_profile: "Pulling entity profile",
  search_entities: "Searching companies",
  get_emergence: "Finding emerging technology",
  get_green_leaderboard: "Ranking green tech",
  get_family_detail: "Fetching family detail",
  compare_entities: "Comparing entities",
  run_custom_query: "Running database query",
  render_chart: "Building chart",
  search_patent_text: "Searching Title/Abstract/Claims",
};

let idSeq = 1;
const nextId = () => `${Date.now()}-${idSeq++}`;

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 420;
const DEFAULT_SIDEBAR_WIDTH = 264;

const WS_URL = import.meta.env.VITE_WS_URL;
const HISTORY_API_BASE = import.meta.env.VITE_HISTORY_API_BASE;
const MAX_RECONNECT_ATTEMPTS = 5;

// Group consecutive same-side messages into one visual turn (one avatar).
function groupMessages(messages) {
  const groups = [];
  for (const msg of messages) {
    const last = groups[groups.length - 1];
    if (last && last.role === msg.role) {
      last.items.push(msg);
    } else {
      groups.push({ role: msg.role, items: [msg] });
    }
  }
  return groups;
}

// The history Lambda returns items already shaped like the live socket sends
// them ({ role, type: "text"|"step"|"chart", ... }), so we just attach a
// local id for React keys — no re-parsing of raw blocks needed here.
function parseHistoryMessages(items) {
  return items.map((item) => ({ id: nextId(), ...item }));
}

function StepLine({ step }) {
  return (
    <div className={`step-line ${step.error ? "step-error" : ""}`}>
      <span className={`step-icon ${step.done ? "done" : "running"}`}>
        {step.done ? (step.error ? "!" : "✓") : ""}
      </span>
      <span className="step-label">{step.label}</span>
    </div>
  );
}

function ChartBlock({ spec }) {
  return (
    <div className="chart-block">
      <Plot
        data={spec.data}
        layout={{ ...spec.layout, autosize: true }}
        useResizeHandler
        style={{ width: "100%", height: "340px" }}
        config={{
          displayModeBar: "hover",
          responsive: true,
          displaylogo: false,
        }}
      />
    </div>
  );
}

export function ChatPage() {
  const navigate = useNavigate();
  const { idToken, logout } = useAuth();

  const claims = useMemo(() => parseJwt(idToken || ""), [idToken]);
  const userEmail = claims.email || "you@otsuka.jp";
  const userName = claims.name || claims["cognito:username"] || userEmail.split("@")[0];
  const userInitials = initialsFromName(userName, userEmail);

  const [chats, setChats] = useState(() => [
    {
      id: nextId(),
      conversationId: null,
      title: "New chat",
      meta: "Just now",
      messages: [],
      messagesLoaded: true,
    },
  ]);
  const [activeChatId, setActiveChatId] = useState(() => chats[0].id);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const resizeStartRef = useRef({ x: 0, width: 0 });

  const activeChat = chats.find((c) => c.id === activeChatId) || chats[0];
  const messages = activeChat?.messages || [];

  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const socketRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const pendingChatIdRef = useRef(null);

  const stickToBottomRef = useRef(true);

  // Track the user's scroll intent: stick to bottom only while they're at
  // the bottom. The moment they scroll up, stop auto-scrolling until they
  // return to the bottom on their own.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distanceFromBottom < 80;
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // On new content, only snap down if the user hasn't scrolled away.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  useEffect(() => {
    if (!confirmDeleteId) return;
    const close = () => setConfirmDeleteId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [confirmDeleteId]);

  useEffect(() => {
    if (!isResizing) return;

    function handleMouseMove(e) {
      const delta = e.clientX - resizeStartRef.current.x;
      const next = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, resizeStartRef.current.width + delta)
      );
      setSidebarWidth(next);
    }

    function handleMouseUp() {
      setIsResizing(false);
      document.body.style.userSelect = "";
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;

    function connect() {
      const socket = new WebSocket(`${WS_URL}?token=${idToken}`);
      socketRef.current = socket;

      socket.onopen = () => {
        reconnectAttemptsRef.current = 0;
        // Cleanup ran while this socket was still CONNECTING (e.g. StrictMode's
        // mount→cleanup→remount in dev). Close it now that it's actually open,
        // instead of calling close() mid-handshake, which logs a spurious error.
        if (cancelled) socket.close();
      };

      socket.onmessage = (e) => handleSocketMessage(e.data);

      socket.onclose = () => {
        if (cancelled) return;
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 10000);
          reconnectAttemptsRef.current += 1;
          reconnectTimerRef.current = setTimeout(connect, delay);
        }
      };

      socket.onerror = (err) => console.error("WebSocket error:", err);
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimerRef.current);
      const socket = socketRef.current;
      // Only close immediately if the handshake has actually finished.
      // Closing a CONNECTING socket throws the "closed before connection is
      // established" warning; if it's still connecting, onopen above will
      // close it as soon as it's safe to do so.
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
  }, [idToken]);

  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;

    async function loadConversations() {
      try {
        const res = await fetch(`${HISTORY_API_BASE}/conversations`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!res.ok) throw new Error(`Failed to load conversations: ${res.status}`);
        const items = await res.json();
        if (cancelled) return;

        const loaded = items.map((item) => ({
          id: item.conversationId,
          conversationId: item.conversationId,
          title: item.title || "New chat",
          meta: formatRelativeTime(item.lastMessageAt),
          messages: [],
          messagesLoaded: false,
        }));

        setChats((prev) => {
          const drafts = prev.filter((c) => !c.conversationId);

          // Preserve already-loaded message state for chats we've opened, so a
          // re-fetch of the list doesn't blow away messages on screen.
          const loadedById = new Map(
            prev
              .filter((c) => c.conversationId && c.messagesLoaded)
              .map((c) => [c.conversationId, c])
          );

          const seen = new Set();
          const unique = loaded
            .filter((c) => {
              if (seen.has(c.conversationId)) return false;
              seen.add(c.conversationId);
              return true;
            })
            .map((c) => loadedById.get(c.conversationId) || c);

          return [...drafts, ...unique];
        });
      } catch (err) {
        console.error("Failed to load conversation history:", err);
      }
    }

    loadConversations();
    return () => { cancelled = true; };
  }, [idToken]);

  function handleSocketMessage(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    const chatId = pendingChatIdRef.current;
    if (!chatId) return;

    switch (data.event) {
      case "conversation":
        updateChat(chatId, (c) => ({ ...c, conversationId: data.conversationId }));
        break;

      // Each tool call becomes a permanent step in the answer's trail.
      case "tool_running":
        updateChat(chatId, (c) => ({
          ...c,
          messages: [
            ...c.messages,
            {
              id: nextId(),
              role: "assistant",
              type: "step",
              tool: data.tool,
              label: TOOL_LABELS[data.tool] || `Using ${data.tool}`,
              done: false,
              error: null,
            },
          ],
        }));
        break;

      // Mark the most recent unfinished step as done (or errored).
      case "tool_done":
        updateChat(chatId, (c) => {
          const msgs = [...c.messages];
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].type === "step" && !msgs[i].done) {
              msgs[i] = { ...msgs[i], done: true, error: data.error || null };
              break;
            }
          }
          return { ...c, messages: msgs };
        });
        break;

      case "text":
        updateChat(chatId, (c) => {
          const msgs = c.messages;
          const last = msgs[msgs.length - 1];
          if (last?.type === "text" && last.streaming) {
            return {
              ...c,
              messages: [...msgs.slice(0, -1), { ...last, text: last.text + data.text }],
            };
          }
          return {
            ...c,
            messages: [...msgs, { id: nextId(), role: "assistant", type: "text", text: data.text, streaming: true }],
          };
        });
        break;

      case "chart":
        updateChat(chatId, (c) => {
          const msgs = c.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m));
          return {
            ...c,
            messages: [...msgs, { id: nextId(), role: "assistant", type: "chart", spec: data.spec, title: data.title }],
          };
        });
        break;

      case "error":
        updateChat(chatId, (c) => ({
          ...c,
          messages: [...c.messages, { id: nextId(), role: "assistant", type: "text", text: `⚠️ ${data.message}` }],
        }));
        setSending(false);
        pendingChatIdRef.current = null;
        break;

      case "done":
        updateChat(chatId, (c) => ({
          ...c,
          messages: c.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
        }));
        setSending(false);
        pendingChatIdRef.current = null;
        break;

      default:
        break;
    }
  }

  function handleNewChat() {
    const existingDraft = chats.find((c) => !c.conversationId && c.messages.length === 0);
    if (existingDraft) {
      setActiveChatId(existingDraft.id);
      setInput("");
      return;
    }

    const chat = {
      id: nextId(),
      conversationId: null,
      title: "New chat",
      meta: "Just now",
      messages: [],
      messagesLoaded: true,
    };
    setChats((prev) => [chat, ...prev]);
    setActiveChatId(chat.id);
    setInput("");
  }

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  function updateChat(id, updater) {
    setChats((prev) => prev.map((c) => (c.id === id ? updater(c) : c)));
  }

  function handleResizeStart(e) {
    setIsResizing(true);
    resizeStartRef.current = { x: e.clientX, width: sidebarWidth };
    document.body.style.userSelect = "none";
  }

  async function handleSelectChat(chat) {
    setActiveChatId(chat.id);
    if (chat.messagesLoaded || !chat.conversationId) return;

    try {
      const res = await fetch(`${HISTORY_API_BASE}/conversations/${chat.conversationId}/messages`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error(`Failed to load messages: ${res.status}`);
      const items = await res.json();

      updateChat(chat.id, (c) => ({
        ...c,
        messages: parseHistoryMessages(items),
        messagesLoaded: true,
      }));
    } catch (err) {
      console.error("Failed to load conversation messages:", err);
    }
  }

  function handleDeleteClick(e, chatId) {
    e.stopPropagation();
    setConfirmDeleteId(chatId);
  }

  async function performDelete(chat) {
    if (chat.conversationId) {
      try {
        await fetch(`${HISTORY_API_BASE}/conversations/${chat.conversationId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${idToken}` },
        });
      } catch (err) {
        console.error("Failed to delete conversation:", err);
        return;
      }
    }

    const remaining = chats.filter((c) => c.id !== chat.id);
    setChats(remaining);

    if (activeChatId === chat.id) {
      remaining.length > 0 ? setActiveChatId(remaining[0].id) : handleNewChat();
    }
  }

  function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      console.error("Socket not connected yet — try again in a moment");
      return;
    }

    const chatId = activeChatId;
    const userMsg = { id: nextId(), role: "user", type: "text", text: trimmed };

    updateChat(chatId, (c) => ({
      ...c,
      title: c.messages.length === 0 ? trimmed.slice(0, 40) : c.title,
      meta: "Just now",
      messages: [...c.messages, userMsg],
    }));

    setInput("");
    setSending(true);
    pendingChatIdRef.current = chatId;

    socketRef.current.send(JSON.stringify({
      action: "sendmessage",
      query: trimmed,
      conversationId: activeChat?.conversationId || undefined,
    }));
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function handleInput(e) {
    setInput(e.target.value);
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
    }
  }

  const showGreeting = messages.length === 0 && !sending;
  const groups = groupMessages(messages);
  const lastGroup = groups[groups.length - 1];
  const streaming = messages.some((m) => m.streaming);
  // Show standalone thinking dots only before the assistant turn has begun.
  const showLeadingThinking = sending && (!lastGroup || lastGroup.role === "user");
  // Show trailing dots inside the active assistant turn while it's still working
  // but not actively streaming visible text.
  const showTrailingThinking = sending && lastGroup?.role === "assistant" && !streaming;

  // Walks items in the exact order they happened, collapsing consecutive
  // same-kind items (three steps in a row stack tightly; a streamed answer
  // split by a tool call still reads as one paragraph). The whole turn —
  // steps, text, chart, more text — renders inside ONE bubble, so a
  // multi-step answer reads as a single message instead of fragmenting into
  // several separate cards.
  function renderAssistantItems(items, withTrailingDots) {
    const blocks = [];
    for (const item of items) {
      const last = blocks[blocks.length - 1];
      if (item.type === "text" && last?.type === "text") {
        last.text += item.text;
      } else if (item.type === "step" && last?.type === "step") {
        last.steps.push(item);
      } else if (item.type === "text") {
        blocks.push({ type: "text", id: item.id, text: item.text });
      } else if (item.type === "step") {
        blocks.push({ type: "step", id: item.id, steps: [item] });
      } else {
        blocks.push({ type: "chart", id: item.id, spec: item.spec });
      }
    }

    return (
      <div className="turn-col">
        <div className="bubble markdown turn-bubble">
          {blocks.map((block) => {
            if (block.type === "step") {
              return (
                <div key={block.id} className="step-group">
                  {block.steps.map((step) => <StepLine key={step.id} step={step} />)}
                </div>
              );
            }
            if (block.type === "chart") {
              return <ChartBlock key={block.id} spec={block.spec} />;
            }
            return (
              <ReactMarkdown key={block.id} remarkPlugins={[remarkGfm]}>
                {block.text}
              </ReactMarkdown>
            );
          })}
          {withTrailingDots && (
            <div className="bubble typing inline-typing">
              <span></span>
              <span></span>
              <span></span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-app">
      <header className="top-nav">
        <div className="brand">
          <div className="brand-mark">P</div>
          <span className="brand-text">IP Atlas</span>
        </div>

        <nav className="top-links">
          <button className="top-link" onClick={() => navigate("/dashboard")}>
            Dashboard
          </button>
          <button className="top-link active">AI Chat</button>
        </nav>
      </header>

      <div className="chat-body">
        <aside className="side-nav" style={{ width: sidebarWidth, flexBasis: sidebarWidth }}>
          <button className="new-chat-btn" onClick={handleNewChat}>
            + New chat
          </button>

          <div className="recent-label">Recent</div>

          <div className="recent-list">
            {chats.map((c) => (
              <div
                key={c.id}
                className={`recent-item ${c.id === activeChatId ? "active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => handleSelectChat(c)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSelectChat(c);
                  }
                }}
              >
                <div className="recent-item-text">
                  <span className="recent-title">{c.title || "New chat"}</span>
                  <span className="recent-meta">{c.meta}</span>
                </div>
                <div className="delete-confirm-wrap">
                  <button
                    className="recent-delete"
                    onClick={(e) => handleDeleteClick(e, c.id)}
                    aria-label="Delete chat"
                  >
                    ×
                  </button>

                  {confirmDeleteId === c.id && (
                    <div className="delete-confirm-popover" onClick={(e) => e.stopPropagation()}>
                      <p className="delete-confirm-text">Delete this chat?</p>
                      <div className="delete-confirm-actions">
                        <button
                          className="confirm-btn confirm-yes"
                          onClick={() => { setConfirmDeleteId(null); performDelete(c); }}
                        >
                          Yes
                        </button>
                        <button className="confirm-btn confirm-no" onClick={() => setConfirmDeleteId(null)}>
                          No
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="user-menu" onClick={(e) => e.stopPropagation()}>
            <button className="user-trigger" onClick={() => setMenuOpen((o) => !o)}>
              <span className="user-avatar">{userInitials}</span>
              <span className="user-name">{userName}</span>
            </button>

            {menuOpen && (
              <div className="user-dropdown">
                <div className="dropdown-label">Signed in as</div>
                <div className="dropdown-email">{userEmail}</div>
                <button className="dropdown-logout" onClick={handleLogout}>
                  Log out
                </button>
              </div>
            )}
          </div>
        </aside>

        <div
          className={`resize-handle ${isResizing ? "dragging" : ""}`}
          onMouseDown={handleResizeStart}
        />

        <main className="chat-main">
          <div className="chat-header">
            <p className="active-title">{activeChat?.title || "New chat"}</p>
          </div>

          <div className="chat-scroll" ref={scrollRef}>
            {showGreeting ? (
              <div className="greeting">
                <div className="greeting-mark">P</div>
                <h1>How can I help with the patent landscape?</h1>
                <p>Ask Atlas to analyze Otsuka's patent landscape.</p>

                <div className="suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.label}
                      className="suggestion"
                      onClick={() => sendMessage(s.hint)}
                    >
                      <span className="suggestion-label">{s.label}</span>
                      <span className="suggestion-hint">{s.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="messages">
                {groups.map((group, gi) => {
                  const isLast = gi === groups.length - 1;
                  if (group.role === "user") {
                    return (
                      <div key={group.items[0].id} className="turn turn-user">
                        <div className="bubble">{group.items[0].text}</div>
                      </div>
                    );
                  }
                  return (
                    <div key={group.items[0].id} className="turn turn-bot">
                      <div className="bot-avatar">P</div>
                      {renderAssistantItems(group.items, isLast && showTrailingThinking)}
                    </div>
                  );
                })}

                {showLeadingThinking && (
                  <div className="turn turn-bot">
                    <div className="bot-avatar">P</div>
                    <div className="turn-col">
                      <div className="bubble typing">
                        <span></span>
                        <span></span>
                        <span></span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="composer-wrap">
            <div className="composer">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder="Ask Atlas about your patent landscape..."
                rows={1}
              />
              <button
                className="send-btn"
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || sending}
                aria-label="Send"
              >
                ↑
              </button>
            </div>
            <p className="composer-note">
              Atlas surfaces patents from OpenSearch — answers are AI-generated and
              may be incomplete.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}