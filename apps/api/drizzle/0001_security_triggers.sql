-- UON CONNECT — persistence-level protections.
--
-- These triggers back up the checks done by the application services, so a bug or a
-- direct API call cannot bypass them:
--   * the founder account can't be deleted, deactivated, demoted or re-linked to another identity;
--   * audit events are append-only and chained by SHA-256 hashes.
--
-- The only way around the founder protection is the formal recovery procedure
-- (docs/RECOVERY.md): a database session that owns the tables and runs
-- `SET LOCAL uon.founder_recovery = 'on'` inside a transaction. The application runtime role
-- recommended for production (docs/DATABASE.md) does not own the tables and can't do it.

CREATE OR REPLACE FUNCTION uon_founder_recovery_allowed() RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF coalesce(current_setting('uon.founder_recovery', true), '') <> 'on' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM pg_roles r
    WHERE r.rolname = session_user
      AND (r.rolsuper OR pg_has_role(session_user, (SELECT tableowner FROM pg_tables WHERE schemaname = current_schema() AND tablename = 'users'), 'MEMBER'))
  );
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION uon_protect_founder_user() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_founder AND NOT uon_founder_recovery_allowed() THEN
      RAISE EXCEPTION 'founder_protected: a conta fundadora só pode ser criada pelo bootstrap' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.is_founder IS DISTINCT FROM OLD.is_founder AND NOT uon_founder_recovery_allowed() THEN
      RAISE EXCEPTION 'founder_protected: o indicador de conta fundadora é imutável' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.is_founder AND NEW.status <> 'active' AND NOT uon_founder_recovery_allowed() THEN
      RAISE EXCEPTION 'founder_protected: a conta fundadora não pode ser desativada' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.is_founder AND NOT uon_founder_recovery_allowed() THEN
      RAISE EXCEPTION 'founder_protected: a conta fundadora não pode ser excluída' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER users_protect_founder
BEFORE INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION uon_protect_founder_user();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION uon_protect_founder_role() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role = 'supreme_admin'
     AND EXISTS (SELECT 1 FROM users u WHERE u.id = OLD.user_id AND u.is_founder)
     AND NOT uon_founder_recovery_allowed() THEN
    RAISE EXCEPTION 'founder_protected: a conta fundadora não pode perder a função Supreme Admin' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER user_roles_protect_founder
BEFORE UPDATE OR DELETE ON user_roles
FOR EACH ROW EXECUTE FUNCTION uon_protect_founder_role();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION uon_protect_founder_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  touches_founder boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    touches_founder := EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.is_founder);
  ELSIF TG_OP = 'UPDATE' THEN
    -- Updating last_login_at is fine; re-pointing the identity is not.
    IF NEW.user_id = OLD.user_id AND NEW.provider = OLD.provider
       AND NEW.tenant_id = OLD.tenant_id AND NEW.subject = OLD.subject THEN
      RETURN NEW;
    END IF;
    touches_founder := EXISTS (SELECT 1 FROM users u WHERE u.id IN (OLD.user_id, NEW.user_id) AND u.is_founder);
  ELSE
    touches_founder := EXISTS (SELECT 1 FROM users u WHERE u.id = OLD.user_id AND u.is_founder);
  END IF;
  IF touches_founder AND NOT uon_founder_recovery_allowed() THEN
    RAISE EXCEPTION 'founder_protected: as identidades da conta fundadora só mudam pelo procedimento de recuperação' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER user_identities_protect_founder
BEFORE INSERT OR UPDATE OR DELETE ON user_identities
FOR EACH ROW EXECUTE FUNCTION uon_protect_founder_identity();
--> statement-breakpoint

-- ------------------------------------------------------------------ audit log

CREATE OR REPLACE FUNCTION uon_audit_hash(e audit_events, prev text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(
    coalesce(prev, '') || '|' || e.id::text || '|' || extract(epoch FROM e.occurred_at)::text || '|' ||
    coalesce(e.actor_user_id::text, '') || '|' || coalesce(e.actor_label, '') || '|' || e.action || '|' ||
    coalesce(e.resource_type, '') || '|' || coalesce(e.resource_id, '') || '|' || e.outcome::text || '|' ||
    coalesce(e.correlation_id, '') || '|' || coalesce(e.metadata::text, ''),
  'UTF8')), 'hex');
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION uon_audit_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  previous text;
BEGIN
  -- Serialise inserts so that every event points at its true predecessor.
  PERFORM pg_advisory_xact_lock(7243001);
  SELECT hash INTO previous FROM audit_events ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := previous;
  NEW.hash := uon_audit_hash(NEW, previous);
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER audit_events_chain
BEFORE INSERT ON audit_events
FOR EACH ROW EXECUTE FUNCTION uon_audit_chain();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION uon_audit_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_immutable: eventos de auditoria não podem ser alterados ou removidos' USING ERRCODE = 'P0001';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER audit_events_no_update
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION uon_audit_immutable();
--> statement-breakpoint

CREATE TRIGGER audit_events_no_truncate
BEFORE TRUNCATE ON audit_events
FOR EACH STATEMENT EXECUTE FUNCTION uon_audit_immutable();
--> statement-breakpoint

-- ------------------------------------------------------------------ updated_at

CREATE OR REPLACE FUNCTION uon_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['departments','teams','users','user_preferences','oauth_tokens','tickets',
    'conversations','user_presence','absence_schedules','system_settings','integration_status']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION uon_touch_updated_at()', t || '_touch', t);
  END LOOP;
END;
$$;
