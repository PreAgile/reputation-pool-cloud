-- Cloud-owned hourly outcome rollup per context (issue #189): the input to the dashboard's per-context
-- success rate. Cloud reserves V100+; upstream owns V1-V99.
--
-- Why this table exists at all: score cannot answer "몇 % 성공하고 있나". The engine accumulates
-- +RECOVER_STEP on success and -penalty(failure kind) on failure and clamps to [-100, 100], and the
-- penalty differs per failure kind — so a score of 70 does not mean "70% success" and the ratio cannot be
-- inverted out of it. The audit trail cannot answer it either: every PoolEvent is a *transition*
-- (ResourceCooled/Recovered/Blocklisted/…), so an ordinary success and a failure that did not trip a
-- cooldown leave no row anywhere. Counting therefore has to happen where every report is visible — our own
-- gRPC boundary — which is what this table stores.
--
-- Grain: (tenant × context × resource kind × hour). Cell grain (tenant × resource × context × hour) was
-- rejected: 10k proxies × 20 contexts × 24h is ~4.8M rows a day, which is the same reason
-- score_rollup_hourly (V105) stops at the context. Adding only the resource *kind* keeps the cardinality
-- within a small constant factor of V105 (kind has three values) while making PROXY/ACCOUNT/SESSION
-- separable later without a backfill.
--
-- Failure counts are split per FailureType instead of one lumped total because the operationally useful
-- reading is not "성공률 62%" but "성공률 62%, 실패의 80%가 BLOCKED" — "the site refused us" and "the
-- transport was bad" call for completely different responses. One column per type (rather than a
-- failure_type key column) keeps a bucket to a single row, so the reader gets the whole breakdown without
-- a pivot and the flush is one upsert per bucket. A new FailureType upstream needs a migration, but it
-- also breaks the recorder's exhaustive switch at compile time, so it can never be silently dropped.
--
-- Every column is a counter, never a gauge: the flusher adds its accumulated delta
-- (count = count + EXCLUDED.count), the same additive upsert usage_meter's lease metric uses. A pre-divided
-- rate could not be merged with a later delta without its weight.
create table report_outcome_hourly (
    tenant_id              text not null,
    context                text not null,
    resource_kind          text not null,
    bucket_hour            timestamptz not null,
    success_count          bigint not null default 0,
    blocked_count          bigint not null default 0,
    timeout_count          bigint not null default 0,
    slow_count             bigint not null default 0,
    connection_reset_count bigint not null default 0,
    tls_handshake_count    bigint not null default 0,
    primary key (tenant_id, context, resource_kind, bucket_hour)
);

-- The read path (every context's series for one tenant over a time window) filters by tenant and ranges
-- over bucket_hour — the same access shape as score_rollup_hourly_lookup_idx.
create index report_outcome_hourly_lookup_idx
    on report_outcome_hourly (tenant_id, bucket_hour);
