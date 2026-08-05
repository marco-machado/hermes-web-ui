import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const targetHost = env.VITE_HERMES_HOST || '127.0.0.1'
  const targetPort = env.VITE_HERMES_PORT || '9119'
  const target = `http://${targetHost}:${targetPort}`

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      // Optional same-origin proxy if you later point the client at window.location.
      // Default UI still connects directly to hermes serve (loopback Origin is accepted).
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  }
})
