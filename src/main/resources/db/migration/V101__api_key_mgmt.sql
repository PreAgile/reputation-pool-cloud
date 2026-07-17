-- Cloud-owned schema (issue #11): columns the REST control plane needs to MANAGE API keys, on top of
-- the minimal V100 auth mapping. V100 keys a row only by its SHA-256 hash — enough to resolve a key to
-- a tenant, but not enough to list keys safely or address one for revocation:
--
--   * id     — a stable, non-secret public handle for a key. The hash is derived from the raw token
--              (which is shown once and never stored), so it cannot be an API-facing identifier without
--              leaking key material into URLs/logs. DELETE /api/tenants/{id}/api-keys/{keyId} addresses
--              this id, never the hash.
--   * prefix — the leading, non-secret slice of the raw token, captured at issue time purely for
--              display (masked listings show "<prefix>…"). The full token is unrecoverable from the
--              hash, so without this column a listing could show nothing recognizable at all.
--
-- Same Flyway history as V100/upstream V1-V99; cloud stays in the reserved V100+ range.

-- gen_random_uuid() is built into PostgreSQL 13+ core (no pgcrypto extension needed). Existing rows
-- (e.g. the bootstrap seed key) get a generated id; the control plane sets its own id explicitly on
-- issue so it can return it in the create response.
alter table api_key add column id uuid not null default gen_random_uuid();

-- Non-secret display prefix; null for pre-existing rows (the seed key is not managed via REST).
alter table api_key add column prefix text;

-- The id is the public handle for revocation lookups, so it must be unique and indexed.
create unique index api_key_id_idx on api_key (id);
