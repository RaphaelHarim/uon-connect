import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { BrandMark } from '@/components/layout/AppShell';
import { Button, Field, Input, Notice, Spinner } from '@/components/ui';
import { post } from '@/lib/api';

interface TokenInfo {
  purpose: 'invite' | 'reset';
  email: string;
  displayName: string;
  expiresAt: string;
}


export default function SetPasswordPage() {
  // The token travels in the URL fragment; it's kept in state and removed from the address bar
  // after the first commit (an initializer may run more than once, an effect after commit won't lose it).
  const [token] = useState(() => window.location.hash.slice(1));
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const info = useQuery({
    queryKey: ['password-token'],
    queryFn: () => post<TokenInfo>('/auth/password/inspect', { token }),
    enabled: token.length > 0,
    retry: false,
    staleTime: Infinity,
  });
  const save = useMutation({
    mutationFn: () => post('/auth/password/set', { token, password }),
    onSuccess: () => navigate('/login?senha=definida', { replace: true }),
  });
  const mismatch = confirm.length > 0 && confirm !== password;
  const tooShort = password.length > 0 && password.length < 12;

  return (
    <div className="flex min-h-full flex-col bg-bg">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-[420px]">
          <div className="mb-8 flex flex-col items-center gap-3 text-center">
            <BrandMark />
          </div>
          <div className="rounded-2xl border border-line bg-surface p-6 shadow-card">
            {!token && (
              <>
                <h1 className="text-lg font-semibold">Link incompleto</h1>
                <p className="mt-2 text-[13px] text-fg-2">Abra o link completo que você recebeu da administração. Se ele não funcionar, peça um novo.</p>
              </>
            )}
            {token && info.isLoading && <Spinner />}
            {info.error && (
              <>
                <h1 className="mb-3 text-lg font-semibold">Link indisponível</h1>
                <Notice tone="danger">{(info.error as Error).message}</Notice>
              </>
            )}
            {info.data && (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!mismatch && !tooShort) save.mutate();
                }}
              >
                <div>
                  <h1 className="text-lg font-semibold">{info.data.purpose === 'invite' ? 'Crie sua senha' : 'Defina uma nova senha'}</h1>
                  <p className="mt-1 text-[13px] text-fg-2">
                    {info.data.displayName} · {info.data.email}
                  </p>
                </div>
                {/* Lets password managers save the new credential under the right account. */}
                <input type="email" name="username" autoComplete="username" value={info.data.email} readOnly hidden />
                <Field label="Nova senha" hint="Pelo menos 12 caracteres. Uma frase com algumas palavras é fácil de lembrar e difícil de adivinhar." error={tooShort ? 'Use pelo menos 12 caracteres.' : undefined} required>
                  {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />}
                </Field>
                <Field label="Confirme a senha" error={mismatch ? 'As senhas não coincidem.' : undefined} required>
                  {(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />}
                </Field>
                {save.error && <Notice tone="danger">{(save.error as Error).message}</Notice>}
                <Button type="submit" variant="primary" size="lg" className="w-full justify-center" loading={save.isPending} disabled={!password || mismatch || tooShort}>
                  Salvar senha
                </Button>
                <p className="text-[12px] text-fg-3">O link só pode ser usado uma vez. Definir a senha encerra as sessões abertas desta conta.</p>
              </form>
            )}
            <p className="mt-5 text-center text-[13px]">
              <Link to="/login" className="text-brand-text underline-offset-2 hover:underline">
                Ir para o login
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
