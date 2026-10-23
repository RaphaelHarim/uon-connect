import { io, type Socket } from 'socket.io-client';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

let socket: Socket | null = null;
const stateListeners = new Set<(s: ConnectionState) => void>();
let state: ConnectionState = 'offline';

function setState(s: ConnectionState) {
  state = s;
  stateListeners.forEach((l) => l(s));
}

/** One shared realtime connection per tab, authenticated by the session cookie. */
export function getSocket(): Socket {
  if (socket) return socket;
  setState('connecting');
  socket = io({ path: '/socket.io', transports: ['websocket', 'polling'], withCredentials: true, reconnectionDelayMax: 10_000 });
  socket.on('connect', () => setState('connected'));
  socket.on('disconnect', () => setState(navigator.onLine ? 'reconnecting' : 'offline'));
  socket.io.on('reconnect_attempt', () => setState('reconnecting'));
  socket.on('connect_error', () => setState(navigator.onLine ? 'reconnecting' : 'offline'));
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
  setState('offline');
}

export const connectionState = () => state;
export function onConnectionState(l: (s: ConnectionState) => void) {
  stateListeners.add(l);
  return () => {
    stateListeners.delete(l);
  };
}
