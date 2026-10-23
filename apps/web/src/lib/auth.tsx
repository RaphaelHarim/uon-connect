import { type MeResponse, type Permission, type PublicConfig } from '@uon/shared/browser';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo } from 'react';
import { ApiError, get, onUnauthorized, post, setCsrfToken } from './api';
import { closeSocket } from './socket';

interface AuthValue {
  me: MeResponse | null;
  config: (PublicConfig & { demoData: boolean }) | undefined;
  loading: boolean;
  can: (p: Permission) => boolean;
  isLeader: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<unknown>;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['config'], queryFn: () => get<PublicConfig & { demoData: boolean }>('/config'), staleTime: 5 * 60_000 });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await get<MeResponse>('/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    retry: (n, err) => !(err instanceof ApiError && err.status === 401) && n < 2,
  });

  useEffect(() => setCsrfToken(me.data?.csrfToken ?? null), [me.data?.csrfToken]);
  useEffect(
    () =>
      onUnauthorized(() => {
        if (qc.getQueryData(['me'])) {
          closeSocket();
          qc.setQueryData(['me'], null);
        }
      }),
    [qc],
  );

  const logout = useCallback(async () => {
    try {
      const r = await post<{ entraLogoutUrl: string | null }>('/auth/logout');
      closeSocket();
      qc.clear();
      if (r.entraLogoutUrl) {
        window.location.href = r.entraLogoutUrl;
        return;
      }
    } finally {
      qc.setQueryData(['me'], null);
    }
  }, [qc]);

  const value = useMemo<AuthValue>(() => {
    const data = me.data ?? null;
    const perms = new Set(data?.permissions ?? []);
    return {
      me: data,
      config: config.data,
      loading: me.isLoading,
      can: (p) => perms.has(p),
      isLeader: !!data && (data.scopes.headDepartmentIds.length > 0 || data.scopes.coordinatedTeamIds.length > 0),
      logout,
      refresh: () => me.refetch(),
    };
  }, [me, config.data, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('AuthProvider ausente');
  return ctx;
}

export function useMe() {
  const { me } = useAuth();
  if (!me) throw new Error('Usuário não autenticado');
  return me;
}
