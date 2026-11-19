-- Account security: password reset, e-mail verification, two-factor login,
-- and a per-user token version so a password change logs out every session.

ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;

-- Users created before this migration count as verified.
UPDATE users SET email_verified_at = nova_now() WHERE email IS NOT NULL;

-- One-time links sent by e-mail. Only a SHA-256 hash of the token is stored.
CREATE TABLE auth_tokens (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL DEFAULT nova_company_id() REFERENCES companies(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('password_reset','email_verify')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user ON auth_tokens (user_id, purpose);

ALTER TABLE auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON auth_tokens
  USING (nova_is_system() OR company_id = nova_company_id())
  WITH CHECK (nova_is_system() OR company_id = nova_company_id());
