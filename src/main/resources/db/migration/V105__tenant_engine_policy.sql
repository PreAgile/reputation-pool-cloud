-- Cloud-owned schema (issue #179): per-tenant reputation-engine policy.
--
-- Until now every tenant on an instance ran one global set of knobs (reputation-pool.engine.* and
-- reputation-pool.lease-ttl), even though those values are decided by a tenant's workload, not by the
-- platform: "cool after 2 failures" is right for a high-volume datacenter-proxy tenant and an
-- over-diagnosis for a thin residential-proxy one. Cloud reserves V100+; upstream owns V1-V99.
--
-- Append-only. A revision is never updated, only superseded by a higher one for the same tenant, so
-- the table *is* the change history (who -> when -> what) that a mutable single row would destroy on
-- every write. It also removes lost updates by construction: the only write is an INSERT, and the
-- (tenant_id, revision) primary key decides a race between two writers instead of letting one silently
-- overwrite the other. Reads take the highest revision, which that same primary key already serves.
--
-- No policy row is the normal state and means "run the instance-wide defaults" — the behaviour every
-- tenant had before this table existed. It is also required during onboarding, where the pool is built
-- before the tenant row is inserted.
--
-- No plan/tier column, deliberately (issue #179, decision 5). Plan-based ceilings change how an upper
-- bound is *derived*, and that derivation lives in one place in the application
-- (EnginePolicyCeiling.from); introducing tiers later changes that function, not this table.

create table tenant_engine_policy (
    tenant_id             text not null references tenant (id),
    revision              integer not null,
    window_size           integer not null,
    cool_after            integer not null,
    recover_after         integer not null,
    -- Duration as whole milliseconds rather than an interval: it is bound through plain JDBC like every
    -- other column here, and lease TTLs are seconds-scale, so no precision is lost.
    lease_ttl_millis      bigint not null,
    cooldown_max_exponent integer not null,
    exploration_floor     double precision not null,
    -- The admin subject from the validated token, never a request field.
    changed_by            text not null,
    changed_at            timestamptz not null,
    primary key (tenant_id, revision),
    -- The application rejects these ranges before writing (EnginePolicy's constructor, which mirrors the
    -- upstream engine constructors). These CHECKs make the database the last line of defence, the same
    -- posture V104 took for tenant.status: a stray write must not be able to store a policy that would
    -- crash the next pool build. Only the structural lower bounds are here — the per-instance upper
    -- ceiling is configuration, so it belongs in the application, not baked into the schema.
    constraint tenant_engine_policy_revision_check check (revision >= 1),
    constraint tenant_engine_policy_window_size_check check (window_size >= 1),
    constraint tenant_engine_policy_cool_after_check check (cool_after >= 1),
    constraint tenant_engine_policy_recover_after_check check (recover_after >= 1),
    constraint tenant_engine_policy_lease_ttl_check check (lease_ttl_millis > 0),
    -- [0, 21] is upstream's AdaptiveCooldownPolicy.MAX_ALLOWED_EXPONENT: above it the computed cooldown
    -- overflows Duration's nanosecond range.
    constraint tenant_engine_policy_cooldown_max_exponent_check check (cooldown_max_exponent between 0 and 21),
    -- Upper-bounded as well as positive because NaN compares greater than every number in PostgreSQL, so
    -- "> 0" alone would admit it; "< Infinity" is false for both NaN and Infinity, which is what the
    -- upstream strategy means by "finite and positive".
    constraint tenant_engine_policy_exploration_floor_check
        check (exploration_floor > 0 and exploration_floor < 'Infinity'::double precision)
);
