import type { Server } from 'socket.io';

/**
 * Thin wrapper around Socket.IO so services can publish events without knowing whether the
 * realtime server is attached (it isn't in unit tests or CLI scripts).
 * Each user has a private room `user:<id>`; events are always addressed to users, never broadcast
 * to rooms the server hasn't authorised.
 */
export class Realtime {
  private io: Server | null = null;
  /** Users whose connected clients reported inactivity. Process-local (see ARCHITECTURE.md). */
  readonly idleUsers = new Set<string>();

  attach(io: Server) {
    this.io = io;
  }

  get attached() {
    return this.io !== null;
  }

  toUsers(userIds: Iterable<string>, event: string, payload: unknown) {
    if (!this.io) return;
    const rooms = [...new Set(userIds)].map((id) => `user:${id}`);
    if (rooms.length > 0) this.io.to(rooms).emit(event, payload);
  }

  toAuthenticated(event: string, payload: unknown) {
    this.io?.to('authenticated').emit(event, payload);
  }

  /** Forcefully closes every realtime connection of a user (deactivation, session revocation). */
  disconnectUser(userId: string) {
    this.io?.in(`user:${userId}`).disconnectSockets(true);
  }

  connectedUserIds(): Set<string> {
    const out = new Set<string>();
    if (!this.io) return out;
    for (const [room] of this.io.sockets.adapter.rooms) {
      if (room.startsWith('user:')) out.add(room.slice(5));
    }
    return out;
  }

  get server() {
    return this.io;
  }
}
