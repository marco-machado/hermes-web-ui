import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useHermesChat } from './hooks/useHermesChat'
import { loadConnection, type ConnectionConfig } from './lib/types'
import './App.css'

const STATE_LABEL: Record<string, string> = {
  idle: 'idle',
  connecting: 'connecting',
  open: 'connected',
  closed: 'closed',
  error: 'error',
}

export default function App() {
  const chat = useHermesChat()
  const [cfg, setCfg] = useState<ConnectionConfig>(() => loadConnection())
  const [draft, setDraft] = useState('')
  const [clarifyDraft, setClarifyDraft] = useState('')
  const [busyConnect, setBusyConnect] = useState(false)
  const [busySession, setBusySession] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [chat.messages, chat.tools, chat.approval, chat.clarify])

  const wsOpen = chat.connState === 'open'
  const hasSession = Boolean(chat.sessionId)
  const canSend = wsOpen && hasSession && !busyConnect && draft.trim().length > 0
  const canBranch =
    hasSession &&
    !chat.running &&
    !busySession &&
    chat.messages.some(m => m.role === 'user' || m.role === 'assistant')

  const statusTone = useMemo(() => {
    if (chat.connState === 'open') return 'ok'
    if (chat.connState === 'connecting') return 'warn'
    if (chat.connState === 'error') return 'bad'
    return 'muted'
  }, [chat.connState])

  async function onConnect(e?: FormEvent) {
    e?.preventDefault()
    setBusyConnect(true)
    try {
      await chat.connect(cfg)
    } catch {
      /* surfaced in chat.error */
    } finally {
      setBusyConnect(false)
    }
  }

  async function withSessionBusy(action: () => Promise<unknown>) {
    setBusySession(true)
    try {
      await action()
    } catch {
      /* surfaced in chat.error */
    } finally {
      setBusySession(false)
    }
  }

  async function onSend(e?: FormEvent) {
    e?.preventDefault()
    if (!canSend) return
    const text = draft
    setDraft('')
    try {
      await chat.send(text)
    } catch {
      setDraft(text)
    }
  }

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <div className="mark" aria-hidden />
          <div>
            <h1>Hermes Web</h1>
            <p className="sub">Custom React client · TUI gateway JSON-RPC</p>
          </div>
        </div>
        <div className={`pill tone-${statusTone}`}>
          <span className="dot" />
          {STATE_LABEL[chat.connState] ?? chat.connState}
          {chat.running ? ' · running' : ''}
          {chat.lastEvent ? ` · ${chat.lastEvent}` : ''}
        </div>
      </header>

      <form className="conn" onSubmit={onConnect}>
        <label>
          Host
          <input
            value={cfg.host}
            onChange={e => setCfg(c => ({ ...c, host: e.target.value }))}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label>
          Port
          <input
            value={cfg.port}
            onChange={e => setCfg(c => ({ ...c, port: e.target.value }))}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="grow">
          Session token
          <input
            value={cfg.token}
            onChange={e => setCfg(c => ({ ...c, token: e.target.value }))}
            placeholder="HERMES_DASHBOARD_SESSION_TOKEN"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="grow">
          CWD (optional)
          <input
            value={cfg.cwd}
            onChange={e => setCfg(c => ({ ...c, cwd: e.target.value }))}
            placeholder="/path/to/project"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <div className="conn-actions">
          {!wsOpen ? (
            <button type="submit" disabled={busyConnect || !cfg.token.trim()}>
              {busyConnect ? 'Connecting…' : 'Connect'}
            </button>
          ) : (
            <button type="button" className="ghost" onClick={() => chat.dispose()}>
              Disconnect
            </button>
          )}
        </div>
      </form>

      <div className="meta">
        <span>session {chat.sessionId ?? '—'}</span>
        <span>stored {chat.storedSessionId ?? '—'}</span>
        <span>model {chat.model || '—'}</span>
        {wsOpen && (
          <button
            type="button"
            className="ghost"
            disabled={!canBranch}
            onClick={() => void withSessionBusy(() => chat.branchSession())}
          >
            Branch
          </button>
        )}
      </div>

      {chat.error && (
        <div className="banner bad" role="alert">
          <span>{chat.error}</span>
          <button type="button" className="ghost" onClick={() => chat.setError(null)}>
            dismiss
          </button>
        </div>
      )}

      <div className={`workspace${wsOpen ? ' with-sidebar' : ''}`}>
        {wsOpen && (
          <aside className="sidebar">
            <div className="sidebar-head">
              <button
                type="button"
                disabled={busySession}
                onClick={() => void withSessionBusy(() => chat.startSession())}
              >
                New session
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busySession}
                onClick={() => void chat.refreshSessions()}
              >
                Refresh
              </button>
            </div>
            <div className="session-list">
              {chat.sessions.length === 0 && <p className="muted">No stored sessions</p>}
              {chat.sessions.map(s => (
                <button
                  key={s.id}
                  type="button"
                  className={`session-item${s.id === chat.storedSessionId ? ' active' : ''}`}
                  disabled={busySession}
                  onClick={() => void withSessionBusy(() => chat.resumeSession(s.id))}
                >
                  <span className="session-title">{s.title || s.preview || s.id}</span>
                  <span className="session-meta">
                    {s.messageCount} msgs
                    {s.source ? ` · ${s.source}` : ''}
                  </span>
                </button>
              ))}
            </div>
          </aside>
        )}

        <main className="main">
        <section className="thread" aria-live="polite">
          {chat.messages.length === 0 &&
            (wsOpen && !hasSession ? (
              <div className="empty">
                <h2>Pick a session</h2>
                <p>Resume one from the list, or start a new session.</p>
              </div>
            ) : (
              <div className="empty">
                <h2>Talk to the real Hermes agent</h2>
                <ol>
                  <li>
                    Point host/port at a running <code>hermes serve</code> (or dashboard) gateway
                  </li>
                  <li>Paste the session token and Connect</li>
                  <li>Send a prompt — tools, approvals, and streaming land here</li>
                </ol>
              </div>
            ))}

          {chat.messages.map(m =>
            m.role === 'tool' ? (
              <div key={m.id} className="msg role-tool">
                <span className="role">tool</span>
                <span className="tool-name">{m.toolName}</span>
                {m.text && <span className="tool-ctx">{m.text}</span>}
              </div>
            ) : (
              <article
                key={m.id}
                className={`msg role-${m.role}${m.interim ? ' interim' : ''}${m.error ? ' errored' : ''}`}
              >
                <header>
                  <span className="role">{m.role}</span>
                  {m.pending && <span className="tag">streaming</span>}
                  {m.interim && <span className="tag">interim</span>}
                  {m.error && <span className="tag bad">error</span>}
                </header>
                <pre className="body">{m.text || (m.pending ? '…' : '')}</pre>
                {m.error && <p className="err">{m.error}</p>}
              </article>
            ),
          )}

          {chat.tools.length > 0 && (
            <div className="tools">
              <h3>Tools</h3>
              {chat.tools.map(t => (
                <div key={t.id} className={`tool status-${t.status}`}>
                  <div className="tool-head">
                    <strong>{t.name}</strong>
                    <span className="tag">{t.status}</span>
                    {t.durationS != null && <span className="muted">{t.durationS.toFixed(1)}s</span>}
                  </div>
                  {t.argsPreview && (
                    <pre className="tool-pre">
                      <span className="k">in</span>
                      {t.argsPreview}
                    </pre>
                  )}
                  {t.resultPreview && (
                    <pre className="tool-pre">
                      <span className="k">out</span>
                      {t.resultPreview}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}

          {chat.approval && (
            <div className="overlay approval">
              <h3>Approval required</h3>
              <p>{chat.approval.description}</p>
              {chat.approval.command && <pre className="body">{chat.approval.command}</pre>}
              <div className="row">
                <button type="button" onClick={() => void chat.respondApproval('once')}>
                  Allow once
                </button>
                {chat.approval.allowPermanent && !chat.approval.smartDenied && (
                  <button type="button" onClick={() => void chat.respondApproval('always')}>
                    Always allow
                  </button>
                )}
                <button type="button" className="danger" onClick={() => void chat.respondApproval('deny')}>
                  Deny
                </button>
              </div>
            </div>
          )}

          {chat.clarify && (
            <div className="overlay clarify">
              <h3>Clarification</h3>
              <p>{chat.clarify.question}</p>
              {chat.clarify.choices && chat.clarify.choices.length > 0 && (
                <div className="row wrap">
                  {chat.clarify.choices.map(c => (
                    <button key={c} type="button" onClick={() => void chat.respondClarify(c)}>
                      {c}
                    </button>
                  ))}
                </div>
              )}
              <form
                className="row"
                onSubmit={e => {
                  e.preventDefault()
                  void chat.respondClarify(clarifyDraft)
                  setClarifyDraft('')
                }}
              >
                <input
                  className="grow-input"
                  value={clarifyDraft}
                  onChange={e => setClarifyDraft(e.target.value)}
                  placeholder="Type an answer"
                />
                <button type="submit" disabled={!clarifyDraft.trim()}>
                  Send
                </button>
              </form>
            </div>
          )}

          <div ref={bottomRef} />
        </section>
        </main>
      </div>

      <form className="composer" onSubmit={onSend}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={
            hasSession ? 'Message Hermes…' : wsOpen ? 'Start or resume a session' : 'Connect first'
          }
          disabled={!hasSession}
          rows={3}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void onSend()
            }
          }}
        />
        <div className="composer-actions">
          {chat.running && (
            <button type="button" className="ghost" onClick={() => void chat.interrupt()}>
              Interrupt
            </button>
          )}
          <button type="submit" disabled={!canSend}>
            Send
          </button>
        </div>
      </form>
    </div>
  )
}
