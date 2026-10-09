import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
        secure: false,
      },
      '/health': {
        target: 'http://localhost:5001',
        changeOrigin: true,
        secure: false,
      },
      '/v3': {
        target: 'http://localhost:5001',
        changeOrigin: true,
        secure: false,
      },
      '/v4': {
        target: 'http://localhost:5001',
        changeOrigin: true,
        secure: false,
      },
      '/v1': {
        target: 'http://localhost:5001',
        changeOrigin: true,
        secure: false,
      },
      '/mcp': {
        target: 'http://localhost:5001',
        changeOrigin: true,
        secure: false,
      },
      '/oauth': {
        target: 'http://localhost:5001',
        changeOrigin: true,
        secure: false,
      },
      '/.well-known': {
        target: 'http://localhost:5001',
        changeOrigin: true,
        secure: false,
      },
      // This creates a "fake" local folder that actually points to Anthropic
      '/anthropic-api': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/anthropic-api/, ''),
        secure: false,
      }
    }
  }
})