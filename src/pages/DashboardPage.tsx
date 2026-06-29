import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Plot from 'react-plotly.js'
import { useAuth } from '../auth/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { LayoutDashboardIcon, MessageSquareIcon, SparklesIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useDarkMode } from '@/lib/useDarkMode'
import logo from '../assets/logo.svg'

function parseJwt(token: string) {
  try { return JSON.parse(atob(token.split('.')[1])) } catch { return {} }
}

function initialsFromName(name = '', email = '') {
  const source = name || email.split('@')[0] || 'U'
  const parts = source.replace(/[._-]/g, ' ').trim().split(/\s+/)
  return (parts[0]?.[0] || 'U').concat(parts[1]?.[0] || '').toUpperCase()
}

const WS_URL = import.meta.env.VITE_WS_URL as string
const MAX_RECONNECT_ATTEMPTS = 5

const DASHBOARD_SUGGESTIONS = [
  'Who leads in battery technology?',
  'Tell me about the Otsuka portfolio as a group',
  'Compare Samsung SDI and LG Energy Solution',
  'What technologies are emerging in healthcare?',
]

function scaleBubbleSizes(values: number[], minPx = 14, maxPx = 48): number[] {
  const max = Math.max(...values.map((v) => (typeof v === 'number' ? v : 0)), 1)
  return values.map((v) => {
    const frac = Math.sqrt(Math.max(v, 0)) / Math.sqrt(max)
    return minPx + frac * (maxPx - minPx)
  })
}

interface AxisOption { id: string; key: string; label: string }
interface Axis { fixed?: { key: string; label: string }; switchable?: boolean; options?: AxisOption[]; default?: string }
interface TileAxes { x?: Axis; y?: Axis }

interface Tile {
  kind: 'kpi' | 'interactive_chart' | 'table'
  title: string
  value?: number | string
  chartType?: string
  orientation?: string
  labelKey?: string
  sizeKey?: string
  rows?: Record<string, unknown>[]
  columns?: string[]
  axes?: TileAxes
  initial?: { xKey?: string; yKey?: string; measureKey?: string }
  initial_spec?: { data: unknown[]; layout: Record<string, unknown> }
}

function labelForKey(axis: Axis | undefined, key: string): string {
  if (!axis) return ''
  if (axis.fixed) return axis.fixed.label
  return axis.options?.find((o) => o.key === key)?.label || ''
}

function initialKey(tile: Tile, dim: 'x' | 'y'): string {
  const axis = tile.axes?.[dim]
  const fromInitial = tile.initial?.[`${dim}Key` as 'xKey' | 'yKey']
  if (fromInitial) return fromInitial
  if (dim === 'x' && tile.initial?.measureKey) return tile.initial.measureKey
  if (axis?.fixed?.key) return axis.fixed.key
  if (axis?.switchable && axis.options) {
    const def = axis.options.find((o) => o.id === axis.default)
    return def?.key || axis.options[0]?.key || ''
  }
  return ''
}

function buildSpec(tile: Tile, xKey: string, yKey: string): { data: unknown[]; layout: Record<string, unknown> } {
  const base = tile.initial_spec!
  const layout: Partial<Plotly.Layout> = JSON.parse(JSON.stringify(base.layout || {}))
  const rows = tile.rows || []
  const xLabel = labelForKey(tile.axes?.x, xKey)
  const yLabel = labelForKey(tile.axes?.y, yKey)

  switch (tile.chartType) {
    case 'bar': {
      const horizontal = tile.orientation === 'h'
      const valueKey = horizontal ? xKey : yKey
      const sorted = [...rows].sort((a, b) => horizontal ? (a[valueKey] as number) - (b[valueKey] as number) : (b[valueKey] as number) - (a[valueKey] as number))
      const trace = { ...base.data[0], type: 'bar' as const, orientation: horizontal ? 'h' as const : undefined, x: horizontal ? sorted.map(r => r[valueKey]) : sorted.map(r => r[tile.labelKey!]), y: horizontal ? sorted.map(r => r[tile.labelKey!]) : sorted.map(r => r[valueKey]) }
      if ((layout as Record<string, unknown>).xaxis) (layout as Record<string, { title: { text: string } }>).xaxis.title = { text: horizontal ? xLabel : yLabel }
      if ((layout as Record<string, unknown>).yaxis) (layout as Record<string, { title: { text: string } }>).yaxis.title = { text: horizontal ? yLabel : xLabel }
      return { data: [trace], layout }
    }
    case 'line': {
      const trace = { ...base.data[0], type: 'scatter' as const, mode: 'lines+markers' as const, x: rows.map(r => r[xKey]), y: rows.map(r => r[yKey]) }
      if ((layout as Record<string, unknown>).xaxis) (layout as Record<string, { title: { text: string } }>).xaxis.title = { text: xLabel }
      if ((layout as Record<string, unknown>).yaxis) (layout as Record<string, { title: { text: string } }>).yaxis.title = { text: yLabel }
      return { data: [trace], layout }
    }
    case 'scatter': {
      const sizeVals = rows.map(r => r[tile.sizeKey!] as number)
      const trace = { ...base.data[0], type: 'scatter' as const, mode: 'markers+text' as const, x: rows.map(r => r[xKey]), y: rows.map(r => r[yKey]), text: rows.map(r => r[tile.labelKey!]), textposition: 'top center' as const, marker: { ...(base.data[0] as Record<string, unknown>).marker as Record<string, unknown>, size: scaleBubbleSizes(sizeVals) } }
      if ((layout as Record<string, unknown>).xaxis) (layout as Record<string, { title: { text: string } }>).xaxis.title = { text: xLabel }
      if ((layout as Record<string, unknown>).yaxis) (layout as Record<string, { title: { text: string } }>).yaxis.title = { text: yLabel }
      return { data: [trace], layout }
    }
    case 'treemap': {
      const labels = rows.map(r => r[tile.labelKey!])
      const values = rows.map(r => r[xKey])
      const trace = { ...base.data[0], type: 'treemap' as const, labels, parents: labels.map(() => ''), values, branchvalues: 'total' as const }
      return { data: [trace], layout }
    }
    default:
      return base
  }
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
  if (layout.xaxis) result.xaxis = { ...(layout.xaxis as object), gridcolor: grid, zerolinecolor: grid }
  if (layout.yaxis) result.yaxis = { ...(layout.yaxis as object), gridcolor: grid, zerolinecolor: grid }
  return result
}

function AxisControl({ axis, value, onChange, label }: { axis?: Axis; value: string; onChange: (v: string) => void; label: string }) {
  if (!axis?.switchable) return null
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded border bg-background px-2 py-1 text-xs">
        {axis.options!.map((o) => <option key={o.id} value={o.key}>{o.label}</option>)}
      </select>
    </label>
  )
}

function InteractiveChart({ tile, isDark }: { tile: Tile; isDark: boolean }) {
  const [xKey, setXKey] = useState(() => initialKey(tile, 'x'))
  const [yKey, setYKey] = useState(() => initialKey(tile, 'y'))
  const spec = useMemo(() => buildSpec(tile, xKey, yKey), [tile, xKey, yKey])
  const themedLayout = useMemo(
    () => applyPlotlyTheme(spec.layout as Record<string, unknown>, isDark),
    [spec, isDark],
  )
  const xSwitch = tile.axes?.x?.switchable
  const ySwitch = tile.axes?.y?.switchable
  const xLabel = tile.chartType === 'treemap' ? 'Measure by' : 'X axis'

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-medium">{tile.title}</CardTitle>
          {(xSwitch || ySwitch) && (
            <div className="flex items-center gap-3 shrink-0">
              <AxisControl axis={tile.axes?.x} value={xKey} onChange={setXKey} label={xLabel} />
              <AxisControl axis={tile.axes?.y} value={yKey} onChange={setYKey} label="Y axis" />
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <Plot
          data={spec.data as never[]}
          layout={themedLayout as never}
          useResizeHandler
          style={{ width: '100%', height: '380px' }}
          config={{ displayModeBar: 'hover', responsive: true, displaylogo: false }}
        />
      </CardContent>
    </Card>
  )
}

function KpiCard({ tile }: { tile: Tile }) {
  const value = typeof tile.value === 'number'
    ? tile.value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : tile.value
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <p className="text-xs text-muted-foreground">{tile.title}</p>
        <p className="text-2xl font-semibold mt-1">{value}</p>
      </CardContent>
    </Card>
  )
}

function TableTile({ tile }: { tile: Tile }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{tile.title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className="max-h-72">
          <table className="w-full text-sm">
            <thead>
              <tr>{tile.columns!.map((c) => <th key={c} className="text-left py-1.5 pr-4 text-xs font-medium text-muted-foreground border-b">{c}</th>)}</tr>
            </thead>
            <tbody>
              {tile.rows!.map((row, ri) => (
                <tr key={ri} className="border-b last:border-0">
                  {(row as unknown[]).map((cell, ci) => (
                    <td key={ci} className="py-1.5 pr-4 text-xs">
                      {typeof cell === 'number' ? cell.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

interface Dashboard { title: string; template_id: string; tiles: Tile[] }

export function DashboardPage() {
  const navigate = useNavigate()
  const { idToken, logout } = useAuth()

  const claims = useMemo(() => parseJwt(idToken || ''), [idToken])
  const userEmail = claims.email || 'you@otsuka.jp'
  const userName = claims.name || claims['cognito:username'] || userEmail.split('@')[0]
  const userInitials = initialsFromName(userName, userEmail)

  const { isDark, toggle: toggleDark } = useDarkMode()
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [preamble, setPreamble] = useState('')
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)

  const socketRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      socket.onerror = (err) => console.error('Dashboard WS error:', err)
    }

    connect()
    return () => {
      cancelled = true
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.close()
    }
  }, [idToken])

  function handleSocketMessage(raw: string) {
    let data: Record<string, unknown>
    try { data = JSON.parse(raw) } catch { return }

    switch (data.type) {
      case 'start': setPreamble(''); setDashboard(null); break
      case 'token': setPreamble((p) => p + (data.text as string)); break
      case 'plan': break
      case 'dashboard': setDashboard({ title: data.title as string, template_id: data.template_id as string, tiles: data.tiles as Tile[] }); break
      case 'done': setRunning(false); break
      case 'error': setPreamble((p) => p + `\n\n⚠️ ${data.message || 'Something went wrong.'}`); setRunning(false); break
    }
  }

  function runQuery(text: string) {
    const trimmed = text.trim()
    if (!trimmed || running) return
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) { console.error('Socket not connected'); return }
    setInput(''); setRunning(true); setPreamble(''); setDashboard(null)
    socketRef.current.send(JSON.stringify({ action: 'createdashboard', prompt: trimmed }))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); runQuery(input) }
  }

  function handleLogout() { logout(); navigate('/login', { replace: true }) }

  const kpis = dashboard?.tiles.filter((t) => t.kind === 'kpi') || []
  const rest = dashboard?.tiles.filter((t) => t.kind !== 'kpi') || []
  const showEmpty = !dashboard && !running && !preamble

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top nav */}
      <header className="grid grid-cols-3 h-12 items-center border-b px-4 shrink-0">
        <div className="flex items-center gap-2">
          <img src={logo} alt="IP Atlas" className="h-6 w-6" />
          <span className="font-semibold text-sm">IP Atlas</span>
        </div>
        <nav className="flex items-center justify-center gap-1">
          <Button variant="secondary" size="sm" className="gap-1.5">
            <LayoutDashboardIcon className="h-3.5 w-3.5" /> Dashboard
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate('/chat')} className="gap-1.5">
            <MessageSquareIcon className="h-3.5 w-3.5" /> AI Chat
          </Button>
        </nav>
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={toggleDark} aria-label="Toggle dark mode">
            {isDark ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent transition-colors text-sm">
                <Avatar className="h-6 w-6"><AvatarFallback className="text-[10px]">{userInitials}</AvatarFallback></Avatar>
                <span className="text-sm">{userName}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="font-normal">
                <p className="text-xs text-muted-foreground">Signed in as</p>
                <p className="text-xs font-medium truncate">{userEmail}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">Log out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Composer bar */}
      <div className="border-b px-4 py-3 shrink-0">
        <div className="max-w-2xl mx-auto flex gap-2">
          <Input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask for a dashboard — a landscape, a company, a comparison..."
            className="flex-1"
          />
          <Button onClick={() => runQuery(input)} disabled={!input.trim() || running} className="gap-1.5 shrink-0">
            <SparklesIcon className="h-3.5 w-3.5" />
            {running ? 'Building…' : 'Generate'}
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 max-w-6xl mx-auto">
          {showEmpty ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
              <img src={logo} alt="IP Atlas" className="h-14 w-14" />
              <h1 className="text-xl font-semibold">Build a patent landscape dashboard</h1>
              <p className="text-sm text-muted-foreground">Describe what you want to see — Atlas picks the right layout.</p>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {DASHBOARD_SUGGESTIONS.map((s) => (
                  <button key={s} className="text-left rounded-lg border p-3 text-sm hover:bg-accent transition-colors" onClick={() => runQuery(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {preamble && (
                <Card>
                  <CardContent className="pt-4">
                    <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-li:my-0.5">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{preamble}</ReactMarkdown>
                    </div>
                  </CardContent>
                </Card>
              )}

              {running && !dashboard && (
                <div className="flex justify-center py-8">
                  <div className="flex gap-1.5">{[0,1,2].map(i => <span key={i} className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{animationDelay: `${i*0.15}s`}} />)}</div>
                </div>
              )}

              {dashboard && (
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold">{dashboard.title}</h2>

                  {kpis.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      {kpis.map((t, i) => <KpiCard key={i} tile={t} />)}
                    </div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {rest.map((t, i) => {
                      if (t.kind === 'interactive_chart') return <InteractiveChart key={i} tile={t} isDark={isDark} />
                      if (t.kind === 'table') return <TableTile key={i} tile={t} />
                      return null
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
