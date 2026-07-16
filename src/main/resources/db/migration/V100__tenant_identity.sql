-- Cloud-owned schema (issue #9a): tenant identity + API-key -> tenant mapping.
--
-- Version-range reservation: this runs in the SAME Flyway location/history as the public
-- reputation-pool persistence jar (V1__snapshot, V2__audit, and any future upstream migration such
-- as the #9b pool_id change). Both sets share one flyway_schema_history, so versions must be
-- globally unique. Cloud reserves V100+; upstream owns V1-V99. That split keeps a later upstream
-- version bump from ever colliding with a cloud migration without a second Flyway instance.

create table tenant (
    id         text primary key,
    name       text not null,
    status     text not null default 'active',
    created_at timestamptz not null
);

-- API key -> tenant mapping. The raw key is never stored; only its SHA-256 digest, which doubles as
-- the lookup key. API keys are high-entropy random tokens, so a fast digest at rest is correct: a
-- password KDF (bcrypt/argon2) buys nothing against a 256-bit search and only slows every request.
create table api_key (
    key_hash   bytea primary key,
    tenant_id  text not null references tenant (id),
    label      text,
    created_at timestamptz not null,
    revoked_at timestamptz
);

create index api_key_tenant_idx on api_key (tenant_id);
