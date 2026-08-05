import { useCallback, useEffect, useRef, useState } from 'react'
import {
  JsonRpcGatewayClient,
  buildWsUrl,
  type ConnectionState,
  type GatewayEvent,
} from '../lib/json-rpc-gateway'
import type {
  ApprovalPrompt,
  ChatMessage,
  ClarifyPrompt,
  ConnectionConfig,
  GatewayEventPayload,
  SessionSummary,
  ToolCall,
  TranscriptRow,
} from '../lib/types'

const PROMPT_SUBMIT_TIMEOUT_MS = 1_800_000

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function preview(value: unknown, max = 400): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.length > max ? `${value.slice(0, max)}…` : value
  try {
    const s = JSON.stringify(value, null, 0)
    return s.length > max ? `${s.slice(0, max)}…` : s
  } catch {
    return String(value)
  }
}

function toolId(p: GatewayEventPayload | undefined): string {
  return String(p?.tool_call_id || p?.tool_id || p?.id || uid('tool'))
}

interface SessionEnterResult {
  session_id: string
  stored_session_id?: string
  resumed?: string
  session_key?: string
  messages?: TranscriptRow[]
  running?: boolean
  info?: { model?: string }
}

function hydrateMessages(rows: TranscriptRow[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const row of rows) {
    if (row.display_kind === 'hidden') continue
    if (row.role === 'tool') {
      out.push({ id: uid('h'), role: 'tool', toolName: row.name || 'tool', text: row.context || '' })
      continue
    }
    if (!row.text) continue
    out.push({ id: uid('h'), role: row.role, text: row.text })
  }
  return out
}

function rpcCode(e: unknown): number | undefined {
  return typeof e === 'object' && e !== null ? (e as { code?: number }).code : undefined
}

export function useHermesChat() {
  const clientRef = useRef<JsonRpcGatewayClient | null>(null)
  const assistantIdRef = useRef<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const cfgRef = useRef<ConnectionConfig | null>(null)

  const [connState, setConnState] = useState<ConnectionState>('idle')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [storedSessionId, setStoredSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [model, setModel] = useState<string>('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [tools, setTools] = useState<ToolCall[]>([])
  const [approval, setApproval] = useState<ApprovalPrompt | null>(null)
  const [clarify, setClarify] = useState<ClarifyPrompt | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastEvent, setLastEvent] = useState<string>('')

  const setLiveSession = useCallback((sid: string | null) => {
    sessionIdRef.current = sid
    setSessionId(sid)
  }, [])

  const dispose = useCallback(() => {
    clientRef.current?.close()
    clientRef.current = null
    setLiveSession(null)
    setStoredSessionId(null)
    setSessions([])
    setConnState('idle')
    setRunning(false)
    setApproval(null)
    setClarify(null)
  }, [setLiveSession])

  useEffect(() => () => dispose(), [dispose])

  const wireEvents = useCallback((gw: JsonRpcGatewayClient) => {
    const scoped =
      <P,>(fn: (ev: GatewayEvent<P>) => void) =>
      (ev: GatewayEvent<P>) => {
        if (ev.session_id && sessionIdRef.current && ev.session_id !== sessionIdRef.current) return
        fn(ev)
      }

    const offs = [
      gw.onState(setConnState),
      gw.onAny(ev => setLastEvent(ev.type)),
      gw.on<{ message?: string }>(
        'error',
        scoped(ev => {
          if (ev.payload?.message) setError(ev.payload.message)
        }),
      ),
      gw.on<GatewayEventPayload>(
        'session.info',
        scoped(ev => {
          const p = ev.payload
          if (!p) return
          if (p.model) setModel(p.model)
          if (p.stored_session_id) setStoredSessionId(p.stored_session_id)
        }),
      ),
      gw.on<GatewayEventPayload>(
        'message.start',
        scoped(() => {
          const id = uid('a')
          assistantIdRef.current = id
          setRunning(true)
          setMessages(m => [...m, { id, role: 'assistant', text: '', pending: true }])
        }),
      ),
      gw.on<GatewayEventPayload>(
        'message.delta',
        scoped(ev => {
          const chunk = ev.payload?.text ?? ''
          if (!chunk) return
          setMessages(m => {
            const id = assistantIdRef.current
            if (!id) {
              const nid = uid('a')
              assistantIdRef.current = nid
              return [...m, { id: nid, role: 'assistant', text: chunk, pending: true }]
            }
            return m.map(msg => (msg.id === id ? { ...msg, text: msg.text + chunk, pending: true } : msg))
          })
        }),
      ),
      gw.on<GatewayEventPayload>(
        'message.interim',
        scoped(ev => {
          const text = ev.payload?.text ?? ''
          if (!text) return
          setMessages(m => [...m, { id: uid('i'), role: 'assistant', text, interim: true }])
        }),
      ),
      gw.on<GatewayEventPayload>(
        'message.complete',
        scoped(ev => {
          const p = ev.payload
          setRunning(false)
          setMessages(m => {
            const id = assistantIdRef.current
            const finalText = p?.text
            if (!id) {
              if (finalText) {
                return [
                  ...m,
                  {
                    id: uid('a'),
                    role: 'assistant',
                    text: finalText,
                    error: p?.status === 'error' ? String(p.message || p.error || 'error') : undefined,
                  },
                ]
              }
              return m
            }
            return m.map(msg => {
              if (msg.id !== id) return msg
              return {
                ...msg,
                pending: false,
                text: finalText && !p?.response_previewed ? finalText : msg.text || finalText || '',
                error: p?.status === 'error' ? String(p.message || p.error || 'error') : undefined,
              }
            })
          })
          assistantIdRef.current = null
        }),
      ),
      gw.on<GatewayEventPayload>(
        'tool.start',
        scoped(ev => {
          const p = ev.payload
          const id = toolId(p)
          setTools(t => [
            ...t.filter(x => x.id !== id),
            {
              id,
              name: String(p?.name || 'tool'),
              argsPreview: preview(p?.args ?? p?.arguments ?? p?.preview),
              status: 'running',
              startedAt: Date.now(),
            },
          ])
        }),
      ),
      gw.on<GatewayEventPayload>(
        'tool.progress',
        scoped(ev => {
          const p = ev.payload
          const id = toolId(p)
          const chunk = preview(p?.preview ?? p?.text ?? p?.summary)
          if (!chunk) return
          setTools(t =>
            t.map(x => (x.id === id ? { ...x, resultPreview: (x.resultPreview || '') + chunk } : x)),
          )
        }),
      ),
      gw.on<GatewayEventPayload>(
        'tool.complete',
        scoped(ev => {
          const p = ev.payload
          const id = toolId(p)
          const err = p?.error === true || (typeof p?.error === 'string' && p.error)
          setTools(t =>
            t.map(x =>
              x.id === id
                ? {
                    ...x,
                    status: err ? 'error' : 'done',
                    durationS: p?.duration_s,
                    resultPreview: preview(p?.result ?? p?.summary ?? p?.preview ?? x.resultPreview),
                  }
                : x,
            ),
          )
        }),
      ),
      gw.on<GatewayEventPayload>(
        'approval.request',
        scoped(ev => {
          const p = ev.payload
          setApproval({
            sessionId: ev.session_id || '',
            command: String(p?.command || ''),
            description: String(p?.description || 'Approval required'),
            allowPermanent: p?.allow_permanent !== false,
            smartDenied: Boolean(p?.smart_denied),
          })
        }),
      ),
      gw.on<GatewayEventPayload>(
        'clarify.request',
        scoped(ev => {
          const p = ev.payload
          if (!p?.request_id) return
          setClarify({
            sessionId: ev.session_id,
            requestId: String(p.request_id),
            question: String(p.question || 'Clarification needed'),
            choices: p.choices,
          })
        }),
      ),
    ]
    return () => offs.forEach(off => off())
  }, [])

  const refreshSessions = useCallback(async (limit = 50) => {
    const gw = clientRef.current
    if (!gw) return
    try {
      const res = await gw.request<{ sessions?: Array<Record<string, unknown>> }>('session.list', {
        limit,
      })
      setSessions(
        (res.sessions ?? []).map(s => ({
          id: String(s.id),
          title: String(s.title || ''),
          preview: String(s.preview || ''),
          startedAt: Number(s.started_at || 0),
          messageCount: Number(s.message_count || 0),
          source: String(s.source || ''),
        })),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const enterSession = useCallback(
    (result: SessionEnterResult) => {
      assistantIdRef.current = null
      setLiveSession(result.session_id)
      setMessages(hydrateMessages(result.messages ?? []))
      setTools([])
      setApproval(null)
      setClarify(null)
      setRunning(Boolean(result.running))
      setModel(result.info?.model ?? '')
      setStoredSessionId(result.resumed ?? result.stored_session_id ?? result.session_key ?? null)
      return result.session_id
    },
    [setLiveSession],
  )

  const connect = useCallback(
    async (cfg: ConnectionConfig) => {
      setError(null)
      dispose()
      setMessages([])
      setTools([])
      setModel('')

      const gw = new JsonRpcGatewayClient({
        closedErrorMessage: 'Hermes gateway connection closed',
        connectErrorMessage: 'Could not connect to Hermes gateway',
        requestIdPrefix: 'w',
        requestTimeoutMs: 60_000,
      })
      clientRef.current = gw
      cfgRef.current = cfg
      const unwire = wireEvents(gw)

      try {
        if (!cfg.token.trim()) {
          throw new Error('Session token required')
        }
        const url = buildWsUrl({
          host: cfg.host.trim() || '127.0.0.1',
          port: cfg.port.trim() || '9119',
          token: cfg.token.trim(),
        })
        await gw.connect(url)
        await refreshSessions()
      } catch (e) {
        unwire()
        dispose()
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        throw e
      }
    },
    [dispose, wireEvents, refreshSessions],
  )

  const startSession = useCallback(async () => {
    const gw = clientRef.current
    if (!gw) throw new Error('Not connected')
    setError(null)
    const cwd = cfgRef.current?.cwd.trim()
    try {
      const created = await gw.request<SessionEnterResult>('session.create', {
        close_on_disconnect: false,
        source: 'web',
        ...(cwd ? { cwd } : {}),
      })
      const sid = enterSession(created)
      void refreshSessions()
      return sid
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      throw e
    }
  }, [enterSession, refreshSessions])

  const resumeSession = useCallback(
    async (storedId: string) => {
      const gw = clientRef.current
      if (!gw) throw new Error('Not connected')
      setError(null)
      try {
        const resumed = await gw.request<SessionEnterResult>('session.resume', {
          session_id: storedId,
          close_on_disconnect: false,
          source: 'web',
        })
        return enterSession(resumed)
      } catch (e) {
        if (rpcCode(e) === 4007) {
          setError('Session no longer exists — list refreshed')
          void refreshSessions()
        } else {
          setError(e instanceof Error ? e.message : String(e))
        }
        throw e
      }
    },
    [enterSession, refreshSessions],
  )

  const branchSession = useCallback(
    async (name?: string) => {
      const gw = clientRef.current
      const sid = sessionIdRef.current
      if (!gw || !sid) throw new Error('Not connected')
      setError(null)
      try {
        const branched = await gw.request<SessionEnterResult>('session.branch', {
          session_id: sid,
          ...(name ? { name } : {}),
        })
        const nid = enterSession(branched)
        void refreshSessions()
        return nid
      } catch (e) {
        if (rpcCode(e) === 4008) {
          setError('Nothing to branch — send a message first')
        } else {
          setError(e instanceof Error ? e.message : String(e))
        }
        throw e
      }
    },
    [enterSession, refreshSessions],
  )

  const send = useCallback(
    async (text: string) => {
      const gw = clientRef.current
      const sid = sessionId
      if (!gw || !sid) throw new Error('Not connected')
      const trimmed = text.trim()
      if (!trimmed) return

      setError(null)
      setMessages(m => [...m, { id: uid('u'), role: 'user', text: trimmed }])
      setRunning(true)

      try {
        await gw.request(
          'prompt.submit',
          { session_id: sid, text: trimmed },
          PROMPT_SUBMIT_TIMEOUT_MS,
        )
      } catch (e) {
        setRunning(false)
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        throw e
      }
    },
    [sessionId],
  )

  const interrupt = useCallback(async () => {
    const gw = clientRef.current
    const sid = sessionId
    if (!gw || !sid) return
    await gw.request('session.interrupt', { session_id: sid })
  }, [sessionId])

  const respondApproval = useCallback(
    async (choice: 'once' | 'always' | 'deny') => {
      const gw = clientRef.current
      const sid = sessionId || approval?.sessionId
      if (!gw || !sid) return
      await gw.request('approval.respond', { session_id: sid, choice })
      setApproval(null)
    },
    [approval?.sessionId, sessionId],
  )

  const respondClarify = useCallback(
    async (answer: string) => {
      const gw = clientRef.current
      if (!gw || !clarify) return
      await gw.request('clarify.respond', {
        request_id: clarify.requestId,
        answer,
        ...(sessionId ? { session_id: sessionId } : {}),
      })
      setClarify(null)
    },
    [clarify, sessionId],
  )

  return {
    connState,
    sessionId,
    storedSessionId,
    sessions,
    model,
    messages,
    tools,
    approval,
    clarify,
    running,
    error,
    lastEvent,
    connect,
    dispose,
    startSession,
    resumeSession,
    branchSession,
    refreshSessions,
    send,
    interrupt,
    respondApproval,
    respondClarify,
    setError,
  }
}
