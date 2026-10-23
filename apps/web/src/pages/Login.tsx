import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, KeyRound, ShieldCheck, Smartphone } from 'lucide-react';
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
  localEnabled: boolean;
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
  const passwordSet = params.get('senha') === 'definida';

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
            {passwordSet && (
              <div className="mb-4">
                <Notice tone="success">Senha definida. Entre com seu e-mail e a nova senha.</Notice>
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

            {providers.data?.localEnabled && (
              <div className={providers.data.entraEnabled ? 'mt-6 border-t border-line pt-5' : ''}>
                <LocalLoginForm onDone={() => qc.invalidateQueries({ queryKey: ['me'] })} />
              </div>
            )}

            {providers.data && !providers.data.entraEnabled && !providers.data.localEnabled && (
              <Notice tone="neutral" icon={<KeyRound className="size-4" />}>
                Nenhum método de login foi configurado neste ambiente. Procure a administração.
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

function LocalLoginForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const login = useMutation({
    mutationFn: () => post<{ ok: boolean; mfaRequired: boolean; challenge?: string }>('/auth/login', { email, password }),
    onSuccess: (r) => {
      setPassword('');
      if (r.mfaRequired && r.challenge) setChallenge(r.challenge);
      else onDone();
    },
  });
  const verify = useMutation({
    mutationFn: () => post('/auth/login/mfa', { challenge, code }),
    onSuccess: onDone,
    onError: () => setCode(''),
  });

  if (challenge) {
    const expired = (verify.error as { code?: string } | null)?.code === 'unauthorized' && /expirou|tentativas/.test((verify.error as Error).message);
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          verify.mutate();
        }}
      >
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <Smartphone className="size-4 text-fg-3" aria-hidden />
          Verificação em duas etapas
        </div>
        <Field label="Código do aplicativo autenticador" hint="Abra o aplicativo autenticador no celular e digite os 6 dígitos do UON CONNECT." required>
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
              required
            />
          )}
        </Field>
        {verify.error && <Notice tone="danger">{(verify.error as Error).message}</Notice>}
        <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={verify.isPending} disabled={code.length !== 6}>
          Confirmar
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-center"
          onClick={() => {
            setChallenge(null);
            setCode('');
            verify.reset();
          }}
        >
          {expired ? 'Entrar novamente' : 'Voltar'}
        </Button>
      </form>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        login.mutate();
      }}
    >
      <Field label="E-mail" required>
        {(id) => <Input id={id} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />}
      </Field>
      <Field label="Senha" required>
        {(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
      </Field>
      {login.error && <Notice tone="danger">{(login.error as Error).message}</Notice>}
      <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={login.isPending}>
        Entrar
      </Button>
      <p className="text-center text-[12px] text-fg-3">Esqueceu a senha ou ainda não tem acesso? Peça um link à administração.</p>
    </form>
  );
}
