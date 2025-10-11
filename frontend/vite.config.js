import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'ws-clienterror-destroy',
      configureServer(server) {
        server.httpServer?.on('clientError', (err, socket) => {
          try { socket.destroy() } catch (e) { void e }
        })
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Autoriser explicitement l'hôte NAT/DNS
    allowedHosts: ['philippe.mourey.com'],
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:8090',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ws/, ''),
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.error('[vite-proxy] WS error:', err?.message || err)
          })
          proxy.on('close', () => {
            // console.log('[vite-proxy] WS closed')
          })
        },
      },
    },
  },
})
