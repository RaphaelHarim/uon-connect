import { Link } from 'react-router';
import { Button, EmptyState } from '@/components/ui';

export function NotFoundPage() {
  return (
    <EmptyState
      title="Página não encontrada"
      description="O endereço não existe ou você não tem acesso a este conteúdo."
      action={
        <Link to="/">
          <Button variant="primary">Voltar ao painel</Button>
        </Link>
      }
    />
  );
}
