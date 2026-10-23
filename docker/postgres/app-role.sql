-- UON CONNECT — papel de execução da aplicação (princípio do menor privilégio).
-- Execute como o usuário proprietário das tabelas, DEPOIS das migrações:
--   psql "$OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 -v app_password='senha-forte' -f docker/postgres/app-role.sql
--
-- O papel uon_app:
--   * lê e grava dados de negócio (DML), sem criar/alterar/excluir tabelas;
--   * NÃO pode atualizar, excluir ou truncar eventos de auditoria;
--   * NÃO é proprietário das tabelas, portanto não consegue usar o procedimento de recuperação
--     da conta fundadora nem desativar triggers.

-- psql variables are not expanded inside DO blocks, hence \gexec.
SELECT format('CREATE ROLE uon_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uon_app') \gexec

GRANT CONNECT ON DATABASE uon_connect TO uon_app;
GRANT USAGE ON SCHEMA public TO uon_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO uon_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO uon_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO uon_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM uon_app;
-- Tabelas criadas por migrações futuras recebem os mesmos privilégios.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO uon_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO uon_app;
