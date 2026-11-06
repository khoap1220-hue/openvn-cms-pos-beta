import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { Server } from 'socket.io';

// Default port 3013 on local host (or REALTIME_PORT from env)
const PORT = Number(process.env.REALTIME_PORT) || 3013;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function handleHealth(res: ServerResponse): void {
  sendJson(res, 200, {
    ok: true,
    clients: io.engine.clientsCount,
    uptime: Math.floor(process.uptime()),
  });
}

function handleEmit(req: IncomingMessage, res: ServerResponse): void {
  let raw = '';
  let overflow = false;
  req.on('data', (chunk: Buffer) => {
    if (raw.length <= 1_000_000) raw += chunk.toString();
    else overflow = true;
  });
  req.on('end', () => {
    if (overflow) {
      sendJson(res, 400, { ok: false, error: 'Body too large (max 1MB)' });
      return;
    }
    try {
      const body = JSON.parse(raw) as { event?: unknown; payload?: unknown };
      if (
        typeof body !== 'object' ||
        body === null ||
        Array.isArray(body) ||
        typeof body.event !== 'string' ||
        body.event.length === 0
      ) {
        sendJson(res, 400, {
          ok: false,
          error: 'Invalid body: expected JSON { event: string, payload: any }',
        });
        return;
      }
      io.emit(body.event, body.payload ?? null);
      sendJson(res, 200, { ok: true, clients: io.engine.clientsCount });
    } catch {
      sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
    }
  });
}

const httpServer = createServer();

const io = new Server(httpServer, {
  path: '/', // required by the Caddy gateway — do not change
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// NOTE: with path '/', engine.io's internal check() matches EVERY request and
// would shadow the HTTP routes below (it replies "Transport unknown"). Re-order
// the request listeners so our routes are handled first; socket.io traffic
// (polling requests carrying EIO= / transport=, plus websocket upgrades) is
// forwarded to the original engine.io handlers.
const engineRequestHandlers = httpServer.listeners('request');
httpServer.removeAllListeners('request');
httpServer.on('request', (req: IncomingMessage, res: ServerResponse) => {
  const url = (req.url ?? '').split('?')[0];

  if (req.method === 'GET' && url === '/health') {
    handleHealth(res);
    return;
  }

  if (req.method === 'POST' && url === '/emit') {
    handleEmit(req, res);
    return;
  }

  if (typeof req.url === 'string' && req.url.includes('EIO=')) {
    for (const handler of engineRequestHandlers) {
      handler.call(httpServer, req, res);
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not found' });
});

io.on('connection', (socket) => {
  console.log(`[realtime] client connected: ${socket.id} (total: ${io.engine.clientsCount})`);

  socket.on('ping-custom', (cb?: (data: unknown) => void) => {
    if (typeof cb === 'function') cb({ ok: true, t: Date.now() });
  });

  socket.on('disconnect', (reason) => {
    console.log(
      `[realtime] client disconnected: ${socket.id} reason=${reason} (total: ${io.engine.clientsCount})`,
    );
  });
});

httpServer.listen(PORT, () => {
  console.log(`[realtime] socket.io broadcast service listening on port ${PORT}`);
});

function shutdown(signal: string): void {
  console.log(`[realtime] received ${signal}, shutting down...`);
  io.disconnectSockets(true); // drop live clients so httpServer.close can complete
  httpServer.close(() => {
    console.log('[realtime] http server closed, exiting.');
    process.exit(0);
  });
  // Fallback so the process never hangs on close.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
