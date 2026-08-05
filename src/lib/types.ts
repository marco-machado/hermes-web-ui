export type Role = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: Role
  text: string
  pending?: boolean
  error?: string
  interim?: boolean
}

export interface ToolCall {
  id: string
  name: string
  argsPreview?: string
  resultPreview?: string
  status: 'running' | 'done' | 'error'
  startedAt: number
  durationS?: number
}

export interface ApprovalPrompt {
  sessionId: string
  command: string
  description: string
  allowPermanent?: boolean
  smartDenied?: boolean
}

export interface ClarifyPrompt {
  sessionId?: string
  requestId: string
  question: string
  choices?: string[] | null
}

export interface ConnectionConfig {
  host: string
  port: string
  token: string
  cwd: string
}

export interface GatewayEventPayload {
  text?: string
  message?: string
  status?: string
  name?: string
  tool_id?: string
  tool_call_id?: string
  id?: string
  args?: unknown
  arguments?: unknown
  preview?: string
  result?: unknown
  summary?: string
  error?: string | boolean
  duration_s?: number
  request_id?: string
  question?: string
  choices?: string[] | null
  command?: string
  description?: string
  allow_permanent?: boolean
  smart_denied?: boolean
  model?: string
  provider?: string
  cwd?: string
  title?: string
  stored_session_id?: string
  response_previewed?: boolean
}

export const STORAGE_KEY = 'hermes-web-ui:connection'

export function loadConnection(): ConnectionConfig {
  const defaults: ConnectionConfig = {
    host: import.meta.env.VITE_HERMES_HOST || '127.0.0.1',
    port: import.meta.env.VITE_HERMES_PORT || '9119',
    token: import.meta.env.VITE_HERMES_TOKEN || '',
    cwd: import.meta.env.VITE_HERMES_CWD || '',
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    return { ...defaults, ...JSON.parse(raw) }
  } catch {
    return defaults
  }
}

export function saveConnection(cfg: ConnectionConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
}
