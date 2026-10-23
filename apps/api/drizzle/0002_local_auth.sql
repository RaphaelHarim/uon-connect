CREATE TYPE "public"."local_token_purpose" AS ENUM('invite', 'reset', 'mfa');--> statement-breakpoint
ALTER TYPE "public"."identity_provider" ADD VALUE 'local';--> statement-breakpoint
CREATE TABLE "local_auth_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "local_token_purpose" NOT NULL,
	"created_by" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"password_hash" text,
	"password_changed_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"totp_secret_enc" text,
	"totp_enabled_at" timestamp with time zone,
	"totp_last_step" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "mfa" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "local_auth_tokens" ADD CONSTRAINT "local_auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_auth_tokens" ADD CONSTRAINT "local_auth_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_credentials" ADD CONSTRAINT "local_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "local_auth_tokens_user_idx" ON "local_auth_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
-- ------------------------------------------------------------------ founder protection (local accounts)
-- The founder's local credential can only be created or removed by the bootstrap/recovery
-- procedure, and invitation/reset links for the founder can only be issued there too. This keeps
-- any other administrator (or the application role) from taking over the founder account by
-- resetting its password. The founder can still change their own password and 2FA (UPDATE).
CREATE OR REPLACE FUNCTION uon_protect_founder_local_credential() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  uid uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM users u WHERE u.id = uid AND u.is_founder) AND NOT uon_founder_recovery_allowed() THEN
    RAISE EXCEPTION 'founder_protected: a credencial local da conta fundadora só muda pelo procedimento de recuperação' USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER local_credentials_protect_founder
BEFORE INSERT OR DELETE ON local_credentials
FOR EACH ROW EXECUTE FUNCTION uon_protect_founder_local_credential();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION uon_protect_founder_local_token() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.purpose IN ('invite', 'reset')
     AND EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.is_founder)
     AND NOT uon_founder_recovery_allowed() THEN
    RAISE EXCEPTION 'founder_protected: links de senha da conta fundadora só são emitidos pelo procedimento de recuperação' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER local_auth_tokens_protect_founder
BEFORE INSERT ON local_auth_tokens
FOR EACH ROW EXECUTE FUNCTION uon_protect_founder_local_token();
--> statement-breakpoint
CREATE TRIGGER local_credentials_touch BEFORE UPDATE ON local_credentials FOR EACH ROW EXECUTE FUNCTION uon_touch_updated_at();
