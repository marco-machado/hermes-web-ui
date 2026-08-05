export type Role = 'user' | 'assistant' | 'system' | 'tool'

export interface ChatMessage {
  id: string
  role: Role
  text: string
  pending?: boolean
  error?: string
  interim?: boolean
  toolName?: string
}

export interface SessionSummary {
  id: string
  title: string
  preview: string
  startedAt: number
  messageCount: number
  source: string
}

export interface TranscriptRow {
  role: Role
  text?: string
  name?: string
  context?: string
  display_kind?: string
  row_id?: number | string
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

export function loadConnection(): ConnectionConfig {
  return {
    host: import.meta.env.VITE_HERMES_HOST || '127.0.0.1',
    port: import.meta.env.VITE_HERMES_PORT || '9119',
    token: import.meta.env.VITE_HERMES_TOKEN || '',
    cwd: import.meta.env.VITE_HERMES_CWD || '',
  }
}
