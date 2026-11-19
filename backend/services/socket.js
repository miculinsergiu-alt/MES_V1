/**
 * Real-time updates (Socket.io).
 *
 * Connections must present a valid login token; each socket joins the room of
 * its company, and events are only ever sent to that room — never to other
 * companies.
 */
const { Server } = require('socket.io');
const config = require('../config');
const { verifyToken, COOKIE_NAME } = require('../middleware/auth');
const db = require('../db');

let io;

const roomFor = (companyId) => `company:${companyId}`;

function initSocket(server) {
  io = new Server(server, {
    cors: config.corsOrigins.length ? { origin: config.corsOrigins, credentials: true } : undefined,
  });

  io.use((socket, next) => {
    try {
      // Browser: the httpOnly session cookie; other clients: auth.token.
      const cookie = (socket.handshake.headers.cookie || '').split(';').map((s) => s.trim())
        .find((s) => s.startsWith(`${COOKIE_NAME}=`));
      const token = socket.handshake.auth?.token || (cookie ? decodeURIComponent(cookie.slice(COOKIE_NAME.length + 1)) : null);
      if (!token) return next(new Error('unauthorized'));
      socket.data.user = verifyToken(token);
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(roomFor(socket.data.user.company_id));
  });

  return io;
}

/**
 * Sends an event to all users of the current request's company.
 * Inside a request, it is sent only after the database change is committed.
 */
function broadcast(event, data) {
  const ctx = db.currentContext();
  const companyId = ctx?.companyId;
  if (!io || !companyId) return;
  db.afterCommit(() => io.to(roomFor(companyId)).emit(event, data));
}

module.exports = { initSocket, broadcast };
