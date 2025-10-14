import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'

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
    host: ['192.168.1.187'],
    port: 5173,
    https: {
      key: fs.readFileSync('../certs/localhost-key.pem'),
      cert: fs.readFileSync('../certs/localhost-cert.pem'),
    },
    // Autoriser explicitement l'hôte NAT/DNS
    allowedHosts: ['philippe.mourey.com', '192.168.1.187'],
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:8090',
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ws/, ''),
        configure: (proxy) => {
          proxy.on('proxyReqWs', (proxyReq, req, socket, options, head) => {
            // Ajoute l'IP réelle du client dans le header X-Forwarded-For
            if (req.socket && req.socket.remoteAddress) {
              proxyReq.setHeader('X-Forwarded-For', req.socket.remoteAddress);
            }
            // Log chaque tentative de connexion WS (origine, IP, headers)
            console.log('[vite-proxy] Tentative WS:', {
              url: req.url,
              remoteAddress: req.socket?.remoteAddress,
              headers: req.headers
            });
          });
        },
      },
      // Ajout du proxy pour le backend PHP
      '/backend': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false, // Doit être false car backend en HTTP
        selfHandleResponse: false,
        rewrite: (path) => path.replace(/^\/backend/, ''), // Important : retire le préfixe /backend
      },
    },
  },
})
