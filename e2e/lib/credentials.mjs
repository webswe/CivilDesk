// Process-local credential store for the isolated native E2E application.
// Restarting the application preserves this runner's memory; ending the spec discards it.
import http from 'node:http';

const PORT = 4456;
export function createE2eCredentialStore() {
  let credential = null;
  let server;
  return {
    exists: () => credential !== null,
    start: () => new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        if (req.url !== '/credential' || !['GET', 'PUT', 'DELETE'].includes(req.method)) { res.writeHead(405); res.end(); return; }
        if (req.method === 'GET') {
          res.writeHead(credential === null ? 204 : 200, { 'content-type': 'text/plain' });
          res.end(credential ?? '');
        } else if (req.method === 'DELETE') {
          credential = null; res.writeHead(204); res.end();
        } else {
          let raw = '';
          req.on('data', chunk => { raw += chunk; if (raw.length > 4096) req.destroy(); });
          req.on('end', () => { credential = raw; res.writeHead(204); res.end(); });
        }
      });
      server.once('error', reject);
      server.listen(PORT, '127.0.0.1', resolve);
    }),
    stop: () => new Promise(resolve => {
      credential = null;
      if (!server) return resolve();
      server.closeAllConnections?.();
      server.close(resolve);
      server = null;
    }),
  };
}

export const e2eCredentials = createE2eCredentialStore();
