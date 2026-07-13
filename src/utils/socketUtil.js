// socketUtil.js
import { Server } from 'socket.io';

let io;

export function initializeSocket(server) {
  io = new Server(server, { cors: { origin: '*' } });

  io.on('connection', () => {
    console.log('Client connected');
  });
}

export function emitReportStatus(data) {
  if (io) {
    io.emit('report-status', data);
  }
}

export function emitSessionStatus(data) {
  if (io) {
    io.emit('session-status', data);
  }
}
