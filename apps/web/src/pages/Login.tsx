import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, KeyRound, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { BrandMark } from '@/components/layout/AppShell';
import { Button, Field, Input, Notice, Select, Spinner } from '@/components/ui';
import { API_PREFIX } from '@uon/shared/browser';
import { get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Providers {
  devLoginEnabled: boolean;
  entraEnabled: boolean;
  demoUsers: { email: string; displayName: string; jobTitle: string | null }[];
}

export function LoginPage() {
  const { me, loading } = useAuth();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const providers = useQuery({ queryKey: ['providers'], queryFn: () => get<Providers>('/auth/providers') });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const back = params.get('voltar');
  const returnTo = back && back.startsWith('/') && !back.startsWith('//') ? back : '/';
  const error = params.get('erro');

  const devLogin = useMutation({
    mutationFn: () => post('/auth/dev-login', { email, password }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });

  if (!loading && me) return <Navigate to={returnTo} replace />;

  return (
    <div className="flex min-h-full flex-col bg-bg">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex flex-col items-center gap-3 text-center">
            <BrandMark />
            <p className="text-sm text-fg-2">Plataforma corporativa da UON Consulting</p>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-6 shadow-card">
            <h1 className="text-lg font-semibold">Entrar</h1>
            <p className="mt-1 mb-5 text-[13px] text-fg-3">Use sua conta corporativa para acessar.</p>

            {error && (
              <div className="mb-4">
                <Notice tone="danger">{error}</Notice>
              </div>
            )}

            {providers.isLoading && <Spinner />}

            {providers.data?.entraEnabled && (
              <a href={`${API_PREFIX}/auth/entra/login?returnTo=${encodeURIComponent(returnTo)}`}>
                <Button variant="primary" size="lg" className="w-full justify-center" icon={<ShieldCheck className="size-4" />}>
                  Entrar com a conta Microsoft
                </Button>
              </a>
            )}

            {providers.data && !providers.data.entraEnabled && (
              <Notice tone="neutral" icon={<KeyRound className="size-4" />}>
                O login corporativo (Microsoft Entra ID) ainda não foi configurado neste ambiente.
              </Notice>
            )}

            {providers.data?.devLoginEnabled && (
              <form
                className="mt-6 space-y-4 border-t border-line pt-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  devLogin.mutate();
                }}
              >
                <div className="flex items-center gap-2 text-[13px] font-semibold text-warning">
                  <FlaskConical className="size-4" aria-hidden />
                  Acesso de desenvolvimento (somente contas fictícias)
                </div>
                <Field label="Conta de demonstração" required>
                  {(id) => (
                    <Select id={id} value={email} onChange={(e) => setEmail(e.target.value)} required>
                      <option value="">Selecione…</option>
                      {providers.data.demoUsers.map((u) => (
                        <option key={u.email} value={u.email}>
                          {u.displayName} — {u.jobTitle}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Senha de teste" hint="Definida em DEV_LOGIN_PASSWORD no arquivo .env do servidor." required>
                  {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
                </Field>
                {devLogin.error && <Notice tone="danger">{(devLogin.error as Error).message}</Notice>}
                <Button type="submit" className="w-full justify-center" loading={devLogin.isPending}>
                  Entrar como conta de demonstração
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
      <footer className="pb-6 text-center text-[11px] tracking-[0.16em] text-fg-3 uppercase">Patrimônio de UON Consulting · Uso interno</footer>
    </div>
  );
}
