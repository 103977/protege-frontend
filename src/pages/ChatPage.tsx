import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Plot from 'react-plotly.js'
import { useAuth } from '../auth/useAuth'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PlusIcon, SendIcon, Trash2Icon, CheckIcon, XIcon, LayoutDashboardIcon, MessageSquareIcon, MoonIcon, SunIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDarkMode } from '@/lib/useDarkMode'
import logo from '../assets/logo.svg'

function parseJwt(token: string) {
  try {
    return JSON.parse(atob(token.split('.')[1]))
  } catch {
    return {}
  }
}

function initialsFromName(name = '', email = '') {
  const source = name || email.split('@')[0] || 'U'
  const parts = source.replace(/[._-]/g, ' ').trim().split(/\s+/)
  return (parts[0]?.[0] || 'U').concat(parts[1]?.[0] || '').toUpperCase()
}

function formatRelativeTime(timestamp: number | null) {
  if (!timestamp) return ''
  const minutes = Math.floor((Date.now() - timestamp) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

const SUGGESTIONS = [
  { label: 'Map a landscape', hint: 'Show patent families around aripiprazole formulations' },
  { label: 'Find whitespace', hint: 'Where are competitors NOT filing in long-acting injectables?' },
  { label: 'Compare claims', hint: 'Compare independent claims across our top 3 families' },
  { label: 'Track a rival', hint: 'Recent filings assigned to a named competitor' },
]

const TOOL_LABELS: Record<string, string> = {
  lookup_cpc: 'Resolving CPC classification',
  get_leaderboard: 'Ranking entities',
  get_entity_profile: 'Pulling entity profile',
  search_entities: 'Searching companies',
  get_emergence: 'Finding emerging technology',
  get_green_leaderboard: 'Ranking green tech',
  get_family_detail: 'Fetching family detail',
  compare_entities: 'Comparing entities',
  run_custom_query: 'Running database query',
  render_chart: 'Building chart',
  search_patent_text: 'Searching Title/Abstract/Claims',
}

let idSeq = 1
const nextId = () => `${Date.now()}-${idSeq++}`

const MIN_SIDEBAR_WIDTH = 200
const MAX_SIDEBAR_WIDTH = 420
const DEFAULT_SIDEBAR_WIDTH = 264

const WS_URL = import.meta.env.VITE_WS_URL as string
const HISTORY_API_BASE = import.meta.env.VITE_HISTORY_API_BASE as string
const MAX_RECONNECT_ATTEMPTS = 5

interface Message {
  id: string
  role: 'user' | 'assistant'
  type: 'text' | 'step' | 'chart'
  text?: string
  tool?: string
  label?: string
  done?: boolean
  error?: string | null
  streaming?: boolean
  spec?: Record<string, unknown>
}

interface Chat {
  id: string
  conversationId: string | null
  title: string
  meta: string
  messages: Message[]
  messagesLoaded: boolean
}

interface MessageGroup {
  role: 'user' | 'assistant'
  items: Message[]
}

function groupMessages(messages: Message[]): MessageGroup[] {
  const groups: MessageGroup[] = []
  for (const msg of messages) {
    const last = groups[groups.length - 1]
    if (last && last.role === msg.role) {
      last.items.push(msg)
    } else {
      groups.push({ role: msg.role, items: [msg] })
    }
  }
  return groups
}

function parseHistoryMessages(items: Record<string, unknown>[]): Message[] {
  return items.map((item) => ({ id: nextId(), ...item } as Message))
}

function StepLine({ step }: { step: Message }) {
  return (
    <div className={cn('flex items-center gap-2 text-xs py-0.5', step.error ? 'text-destructive' : 'text-muted-foreground')}>
      <span className={cn('flex h-4 w-4 items-center justify-center rounded-full text-[10px] border', step.done ? (step.error ? 'border-destructive text-destructive' : 'border-emerald-500 text-emerald-500') : 'border-muted-foreground/40 text-transparent')}>
        {step.done ? (step.error ? '!' : <CheckIcon className="h-2.5 w-2.5" />) : ''}
      </span>
      <span>{step.label}</span>
      {!step.done && <span className="inline-flex gap-0.5 ml-1">{[0,1,2].map(i => <span key={i} className="h-1 w-1 rounded-full bg-muted-foreground/50 animate-bounce" style={{animationDelay: `${i*0.15}s`}} />)}</span>}
    </div>
  )
}

function applyPlotlyTheme(layout: Record<string, unknown>, isDark: boolean): Record<string, unknown> {
  const grid = isDark ? '#3a3530' : '#e8e3db'
  const result: Record<string, unknown> = {
    ...layout,
    paper_bgcolor: isDark ? '#282420' : '#fcfbf9',
    plot_bgcolor: isDark ? '#282420' : '#fcfbf9',
    font: { ...(layout.font as object || {}), color: isDark ? '#e2d9ce' : '#1e1a14' },
    autosize: true,
  }
  // Merge grid colors only into axes that already exist in the spec,
  // so we don't accidentally add axis properties that break autoscale.
  if (layout.xaxis) result.xaxis = { ...(layout.xaxis as object), gridcolor: grid, zerolinecolor: grid }
  if (layout.yaxis) result.yaxis = { ...(layout.yaxis as object), gridcolor: grid, zerolinecolor: grid }
  return result
}

function ChartBlock({ spec, isDark }: { spec: Record<string, unknown>; isDark: boolean }) {
  const themedLayout = useMemo(
    () => applyPlotlyTheme(spec.layout as Record<string, unknown>, isDark),
    [spec, isDark],
  )
  return (
    <div className="mt-2 rounded-md overflow-hidden border">
      <Plot
        data={spec.data as never[]}
        layout={themedLayout as never}
        useResizeHandler
        style={{ width: '100%', height: '340px' }}
        config={{ displayModeBar: 'hover', responsive: true, displaylogo: false }}
      />
    </div>
  )
}

export function ChatPage() {
  const navigate = useNavigate()
  const { idToken, logout } = useAuth()

  const claims = useMemo(() => parseJwt(idToken || ''), [idToken])
  const userEmail = claims.email || 'you@otsuka.jp'
  const userName = claims.name || claims['cognito:username'] || userEmail.split('@')[0]
  const userInitials = initialsFromName(userName, userEmail)

  const [chats, setChats] = useState<Chat[]>(() => [
    { id: nextId(), conversationId: null, title: 'New chat', meta: 'Just now', messages: [], messagesLoaded: true },
  ])
  const [activeChatId, setActiveChatId] = useState(() => chats[0].id)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const resizeStartRef = useRef({ x: 0, width: 0 })

  const { isDark, toggle: toggleDark } = useDarkMode()
  const activeChat = chats.find((c) => c.id === activeChatId) || chats[0]
  const messages = activeChat?.messages || []

  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingChatIdRef = useRef<string | null>(null)
  const stickToBottomRef = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages, sending])

  useEffect(() => {
    if (!confirmDeleteId) return
    const close = () => setConfirmDeleteId(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [confirmDeleteId])

  useEffect(() => {
    if (!isResizing) return
    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartRef.current.x
      setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, resizeStartRef.current.width + delta)))
    }
    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  useEffect(() => {
    if (!idToken) return
    let cancelled = false

    function connect() {
      const socket = new WebSocket(`${WS_URL}?token=${idToken}`)
      socketRef.current = socket
      socket.onopen = () => { reconnectAttemptsRef.current = 0; if (cancelled) socket.close() }
      socket.onmessage = (e) => handleSocketMessage(e.data)
      socket.onclose = () => {
        if (cancelled) return
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(1000 * 2 ** reconnectAttemptsRef.current, 10000)
          reconnectAttemptsRef.current++
          reconnectTimerRef.current = setTimeout(connect, delay)
        }
      }
      socket.onerror = (err) => console.error('WebSocket error:', err)
    }

    connect()
    return () => {
      cancelled = true
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.close()
    }
  }, [idToken])

  useEffect(() => {
    if (!idToken) return
    let cancelled = false

    async function loadConversations() {
      try {
        const res = await fetch(`${HISTORY_API_BASE}/conversations`, {
          headers: { Authorization: `Bearer ${idToken}` },
        })
        if (!res.ok) throw new Error(`Failed: ${res.status}`)
        const items: Array<{ conversationId: string; title?: string; lastMessageAt?: number }> = await res.json()
        if (cancelled) return

        const loaded: Chat[] = items.map((item) => ({
          id: item.conversationId,
          conversationId: item.conversationId,
          title: item.title || 'New chat',
          meta: formatRelativeTime(item.lastMessageAt ?? null),
          messages: [],
          messagesLoaded: false,
        }))

        setChats((prev) => {
          const drafts = prev.filter((c) => !c.conversationId)
          const loadedById = new Map(prev.filter((c) => c.conversationId && c.messagesLoaded).map((c) => [c.conversationId, c]))
          const seen = new Set<string>()
          const unique = loaded
            .filter((c) => { if (seen.has(c.conversationId!)) return false; seen.add(c.conversationId!); return true })
            .map((c) => loadedById.get(c.conversationId) || c)
          return [...drafts, ...unique]
        })
      } catch (err) {
        console.error('Failed to load conversations:', err)
      }
    }

    loadConversations()
    return () => { cancelled = true }
  }, [idToken])

  function handleSocketMessage(raw: string) {
    let data: Record<string, unknown>
    try { data = JSON.parse(raw) } catch { return }
    const chatId = pendingChatIdRef.current
    if (!chatId) return

    switch (data.event) {
      case 'conversation':
        updateChat(chatId, (c) => ({ ...c, conversationId: data.conversationId as string }))
        break
      case 'tool_running':
        updateChat(chatId, (c) => ({
          ...c,
          messages: [...c.messages, { id: nextId(), role: 'assistant', type: 'step', tool: data.tool as string, label: TOOL_LABELS[data.tool as string] || `Using ${data.tool}`, done: false, error: null }],
        }))
        break
      case 'tool_done':
        updateChat(chatId, (c) => {
          const msgs = [...c.messages]
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].type === 'step' && !msgs[i].done) {
              msgs[i] = { ...msgs[i], done: true, error: (data.error as string) || null }
              break
            }
          }
          return { ...c, messages: msgs }
        })
        break
      case 'text':
        updateChat(chatId, (c) => {
          const msgs = c.messages
          const last = msgs[msgs.length - 1]
          if (last?.type === 'text' && last.streaming) {
            return { ...c, messages: [...msgs.slice(0, -1), { ...last, text: (last.text || '') + (data.text as string) }] }
          }
          return { ...c, messages: [...msgs, { id: nextId(), role: 'assistant', type: 'text', text: data.text as string, streaming: true }] }
        })
        break
      case 'chart':
        updateChat(chatId, (c) => {
          const msgs = c.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m))
          return { ...c, messages: [...msgs, { id: nextId(), role: 'assistant', type: 'chart', spec: data.spec as Record<string, unknown>, title: data.title as string }] }
        })
        break
      case 'error':
        updateChat(chatId, (c) => ({ ...c, messages: [...c.messages, { id: nextId(), role: 'assistant', type: 'text', text: `⚠️ ${data.message}` }] }))
        setSending(false); pendingChatIdRef.current = null
        break
      case 'done':
        updateChat(chatId, (c) => ({ ...c, messages: c.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)) }))
        setSending(false); pendingChatIdRef.current = null
        break
    }
  }

  function handleNewChat() {
    const existingDraft = chats.find((c) => !c.conversationId && c.messages.length === 0)
    if (existingDraft) { setActiveChatId(existingDraft.id); setInput(''); return }
    const chat: Chat = { id: nextId(), conversationId: null, title: 'New chat', meta: 'Just now', messages: [], messagesLoaded: true }
    setChats((prev) => [chat, ...prev])
    setActiveChatId(chat.id)
    setInput('')
  }

  function handleLogout() { logout(); navigate('/login', { replace: true }) }
  function updateChat(id: string, updater: (c: Chat) => Chat) { setChats((prev) => prev.map((c) => (c.id === id ? updater(c) : c))) }
  function handleResizeStart(e: React.MouseEvent) { setIsResizing(true); resizeStartRef.current = { x: e.clientX, width: sidebarWidth }; document.body.style.userSelect = 'none' }

  async function handleSelectChat(chat: Chat) {
    setActiveChatId(chat.id)
    if (chat.messagesLoaded || !chat.conversationId) return
    try {
      const res = await fetch(`${HISTORY_API_BASE}/conversations/${chat.conversationId}/messages`, { headers: { Authorization: `Bearer ${idToken}` } })
      if (!res.ok) throw new Error(`Failed: ${res.status}`)
      const items = await res.json()
      updateChat(chat.id, (c) => ({ ...c, messages: parseHistoryMessages(items), messagesLoaded: true }))
    } catch (err) { console.error('Failed to load messages:', err) }
  }

  async function performDelete(chat: Chat) {
    if (chat.conversationId) {
      try {
        await fetch(`${HISTORY_API_BASE}/conversations/${chat.conversationId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${idToken}` } })
      } catch (err) { console.error('Failed to delete:', err); return }
    }
    const remaining = chats.filter((c) => c.id !== chat.id)
    setChats(remaining)
    if (activeChatId === chat.id) { remaining.length > 0 ? setActiveChatId(remaining[0].id) : handleNewChat() }
  }

  function sendMessage(text: string) {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) { console.error('Socket not connected'); return }
    const chatId = activeChatId
    updateChat(chatId, (c) => ({ ...c, title: c.messages.length === 0 ? trimmed.slice(0, 40) : c.title, meta: 'Just now', messages: [...c.messages, { id: nextId(), role: 'user', type: 'text', text: trimmed }] }))
    setInput(''); setSending(true); pendingChatIdRef.current = chatId
    socketRef.current.send(JSON.stringify({ action: 'sendmessage', query: trimmed, conversationId: activeChat?.conversationId || undefined }))
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    const ta = textareaRef.current
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px' }
  }

  const showGreeting = messages.length === 0 && !sending
  const groups = groupMessages(messages)
  const lastGroup = groups[groups.length - 1]
  const streaming = messages.some((m) => m.streaming)
  const showLeadingThinking = sending && (!lastGroup || lastGroup.role === 'user')
  const showTrailingThinking = sending && lastGroup?.role === 'assistant' && !streaming

  interface Block { type: 'text' | 'step' | 'chart'; id: string; text?: string; steps?: Message[]; spec?: Record<string, unknown> }

  function renderAssistantItems(items: Message[], withTrailingDots: boolean) {
    const blocks: Block[] = []
    for (const item of items) {
      const last = blocks[blocks.length - 1]
      if (item.type === 'text' && last?.type === 'text') { last.text = (last.text || '') + (item.text || '') }
      else if (item.type === 'step' && last?.type === 'step') { last.steps!.push(item) }
      else if (item.type === 'text') { blocks.push({ type: 'text', id: item.id, text: item.text || '' }) }
      else if (item.type === 'step') { blocks.push({ type: 'step', id: item.id, steps: [item] }) }
      else { blocks.push({ type: 'chart', id: item.id, spec: item.spec }) }
    }

    return (
      <div className="flex flex-col max-w-[85%]">
        <div className="rounded-lg border bg-card px-4 py-4 text-sm space-y-4">
          {blocks.map((block) => {
            if (block.type === 'step') {
              // Collapse consecutive steps with the same label into one line
              const collapsed: { step: Message; count: number }[] = []
              for (const s of block.steps!) {
                const prev = collapsed[collapsed.length - 1]
                if (prev && prev.step.label === s.label) {
                  prev.count++
                  // Keep the last step's done/error state
                  prev.step = s
                } else {
                  collapsed.push({ step: s, count: 1 })
                }
              }
              return (
                <div key={block.id} className="space-y-1.5 rounded-md bg-muted/50 px-3 py-2.5">
                  {collapsed.map(({ step: s, count }) => (
                    <div key={s.id} className="flex items-center gap-2">
                      <StepLine step={s} />
                      {count > 1 && (
                        <span className="text-[10px] text-muted-foreground bg-muted rounded px-1 py-0.5 font-mono">×{count}</span>
                      )}
                    </div>
                  ))}
                </div>
              )
            }
            if (block.type === 'chart') {
              return (
                <div key={block.id} className="py-1">
                  <ChartBlock spec={block.spec!} isDark={isDark} />
                </div>
              )
            }
            return (
              <div key={block.id} className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-li:my-0.5 prose-table:text-xs">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text || ''}</ReactMarkdown>
              </div>
            )
          })}
          {withTrailingDots && (
            <div className="flex gap-1">{[0,1,2].map(i => <span key={i} className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{animationDelay: `${i*0.15}s`}} />)}</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top nav */}
      <header className="grid grid-cols-3 h-12 items-center border-b px-4 shrink-0">
        <div className="flex items-center gap-2">
          <img src={logo} alt="IP Atlas" className="h-6 w-6" />
          <span className="font-semibold text-sm">IP Atlas</span>
        </div>
        <nav className="flex items-center justify-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')} className="gap-1.5">
            <LayoutDashboardIcon className="h-3.5 w-3.5" /> Dashboard
          </Button>
          <Button variant="secondary" size="sm" className="gap-1.5">
            <MessageSquareIcon className="h-3.5 w-3.5" /> AI Chat
          </Button>
        </nav>
        <div className="flex items-center justify-end">
          <Button variant="ghost" size="icon" onClick={toggleDark} aria-label="Toggle dark mode">
            {isDark ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="flex flex-col border-r shrink-0 overflow-hidden" style={{ width: sidebarWidth }}>
          <div className="p-3">
            <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={handleNewChat}>
              <PlusIcon className="h-4 w-4" /> New chat
            </Button>
          </div>

          <Separator />

          <div className="px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recent</p>
          </div>

          <ScrollArea className="flex-1">
            <div className="px-2 pb-2 space-y-0.5">
              {chats.map((c) => (
                <div key={c.id} className="relative group">
                  <button
                    className={cn(
                      'w-full text-left rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent',
                      c.id === activeChatId && 'bg-accent'
                    )}
                    onClick={() => handleSelectChat(c)}
                  >
                    <p className="truncate font-medium text-xs">{c.title || 'New chat'}</p>
                    <p className="text-xs text-muted-foreground">{c.meta}</p>
                  </button>
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5">
                    {confirmDeleteId === c.id ? (
                      <div className="flex items-center gap-1 bg-background border rounded-md px-1.5 py-1 shadow-sm" onClick={(e) => e.stopPropagation()}>
                        <span className="text-xs text-muted-foreground">Delete?</span>
                        <button className="text-destructive hover:text-destructive/80" onClick={() => { setConfirmDeleteId(null); performDelete(c) }}><CheckIcon className="h-3.5 w-3.5" /></button>
                        <button className="text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null) }}><XIcon className="h-3.5 w-3.5" /></button>
                      </div>
                    ) : (
                      <button
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(c.id) }}
                      >
                        <Trash2Icon className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          <Separator />
          <div className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 hover:bg-accent transition-colors text-sm">
                  <Avatar className="h-6 w-6"><AvatarFallback className="text-[10px]">{userInitials}</AvatarFallback></Avatar>
                  <span className="truncate">{userName}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-52">
                <DropdownMenuLabel className="font-normal">
                  <p className="text-xs text-muted-foreground">Signed in as</p>
                  <p className="text-xs font-medium truncate">{userEmail}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">Log out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </aside>

        {/* Resize handle */}
        <div
          className={cn('w-1 cursor-col-resize hover:bg-border transition-colors', isResizing && 'bg-border')}
          onMouseDown={handleResizeStart}
        />

        {/* Main */}
        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b px-4 py-2 shrink-0">
            <p className="text-sm font-medium truncate">{activeChat?.title || 'New chat'}</p>
          </div>

          <div className="flex-1 overflow-y-auto p-4" ref={scrollRef}>
            {showGreeting ? (
              <div className="flex flex-col items-center justify-center h-full max-w-xl mx-auto text-center gap-4">
                <img src={logo} alt="IP Atlas" className="h-12 w-12" />
                <h1 className="text-xl font-semibold">How can I help with the patent landscape?</h1>
                <p className="text-sm text-muted-foreground">Ask Atlas to analyze Otsuka's patent landscape.</p>
                <div className="grid grid-cols-2 gap-2 w-full mt-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.label}
                      className="text-left rounded-lg border p-3 hover:bg-accent transition-colors"
                      onClick={() => sendMessage(s.hint)}
                    >
                      <p className="text-sm font-medium">{s.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{s.hint}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4 max-w-3xl mx-auto">
                {groups.map((group, gi) => {
                  const isLast = gi === groups.length - 1
                  if (group.role === 'user') {
                    return (
                      <div key={group.items[0].id} className="flex justify-end">
                        <div className="rounded-lg bg-primary text-primary-foreground px-4 py-2.5 text-sm max-w-[75%]">
                          {group.items[0].text}
                        </div>
                      </div>
                    )
                  }
                  return (
                    <div key={group.items[0].id} className="flex gap-3">
                      <Avatar className="h-7 w-7 mt-0.5 shrink-0"><AvatarFallback className="bg-background p-1"><img src={logo} alt="Atlas" className="h-full w-full" /></AvatarFallback></Avatar>
                      {renderAssistantItems(group.items, isLast && showTrailingThinking)}
                    </div>
                  )
                })}

                {showLeadingThinking && (
                  <div className="flex gap-3">
                    <Avatar className="h-7 w-7 mt-0.5 shrink-0"><AvatarFallback className="bg-background p-1"><img src={logo} alt="Atlas" className="h-full w-full" /></AvatarFallback></Avatar>
                    <div className="rounded-lg border bg-card px-4 py-3 flex gap-1.5 items-center">
                      {[0,1,2].map(i => <span key={i} className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce" style={{animationDelay: `${i*0.15}s`}} />)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t p-3 shrink-0">
            <div className="max-w-3xl mx-auto">
              <div className="flex gap-2 items-end rounded-lg border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleInput}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask Atlas about your patent landscape..."
                  rows={1}
                  className="border-0 p-0 resize-none min-h-0 focus-visible:ring-0 shadow-none text-sm"
                />
                <Button
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || sending}
                >
                  <SendIcon className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-center mt-2">
                Atlas surfaces patents from OpenSearch — answers are AI-generated and may be incomplete.
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
