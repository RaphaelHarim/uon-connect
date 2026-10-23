import type { PresenceView } from '@uon/shared/browser';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { type ConnectionState, connectionState, getSocket, onConnectionState } from './socket';
import { useAuth } from './auth';
import { useToast } from './toast';

const PresenceCtx = createContext<Map<string, PresenceView>>(new Map());
const ConnCtx = createContext<ConnectionState>('offline');

const IDLE_MS = 5 * 60_000;

/**
 * Wires realtime events into the query cache. Messages and notifications are always fetched over
 * HTTP; the socket only signals that something changed, so a lost connection never loses data.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [presence, setPresence] = useState(() => new Map<string, PresenceView>());
  const [conn, setConn] = useState<ConnectionState>(connectionState());
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (!me) return;
    const s = getSocket();
    const off = onConnectionState(setConn);
    setConn(connectionState());

    const onPresence = (p: PresenceView) => setPresence((m) => new Map(m).set(p.userId, p));
    const onNotification = (n: { title: string; category: string }) => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      if (!location.pathname.startsWith('/conversas') || n.category !== 'message') toastRef.current.info(n.title);
    };
    const onMessage = (m: { conversationId: string }) => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['messages', m.conversationId] });
    };
    const onConversation = (c: { id: string }) => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['conversation', c.id] });
    };
    const onRead = (r: { conversationId: string }) => void qc.invalidateQueries({ queryKey: ['conversation', r.conversationId] });
    const onTicket = (t: { id: string }) => {
      void qc.invalidateQueries({ queryKey: ['ticket', t.id] });
      void qc.invalidateQueries({ queryKey: ['tickets'] });
    };
    const onRevoked = () => {
      qc.setQueryData(['me'], null);
    };
    const onReconnect = () => {
      // Catch up on anything missed while disconnected.
      void qc.invalidateQueries({ queryKey: ['conversations'] });
      void qc.invalidateQueries({ queryKey: ['messages'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    };

    s.on('presence:update', onPresence);
    s.on('notification:new', onNotification);
    s.on('message:new', onMessage);
    s.on('message:updated', onMessage);
    s.on('conversation:updated', onConversation);
    s.on('conversation:read', onRead);
    s.on('ticket:updated', onTicket);
    s.on('session:revoked', onRevoked);
    s.on('connect', onReconnect);

    // Idle detection: activity in this tab keeps the automatic status "available".
    let idle = false;
    let timer: number;
    const markActive = () => {
      if (idle) {
        idle = false;
        s.emit('presence:idle', { idle: false });
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        idle = true;
        s.emit('presence:idle', { idle: true });
      }, IDLE_MS);
    };
    const events = ['pointerdown', 'keydown', 'visibilitychange'] as const;
    events.forEach((e) => window.addEventListener(e, markActive, { passive: true }));
    markActive();

    return () => {
      off();
      events.forEach((e) => window.removeEventListener(e, markActive));
      window.clearTimeout(timer);
      s.off('presence:update', onPresence);
      s.off('notification:new', onNotification);
      s.off('message:new', onMessage);
      s.off('message:updated', onMessage);
      s.off('conversation:updated', onConversation);
      s.off('conversation:read', onRead);
      s.off('ticket:updated', onTicket);
      s.off('session:revoked', onRevoked);
      s.off('connect', onReconnect);
    };
  }, [me, qc]);

  return (
    <ConnCtx.Provider value={conn}>
      <PresenceCtx.Provider value={presence}>{children}</PresenceCtx.Provider>
    </ConnCtx.Provider>
  );
}

/** Live presence if known from the socket, else the value that came with the API response. */
export function usePresence(userId: string | undefined, fallback?: PresenceView | null) {
  const map = useContext(PresenceCtx);
  return (userId && map.get(userId)) || fallback || null;
}

export const useConnection = () => useContext(ConnCtx);
