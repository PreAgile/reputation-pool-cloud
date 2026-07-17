-- Cloud-owned score time series (issue #12 / D5): periodic samples of every cell's reputation score,
-- the input to the dashboard's 24h reputation curve (화면2). Cloud reserves V100+; upstream owns V1-V99.
--
-- Cardinality warning: one row per (tenant × resource × context) per sample tick, so this table grows
-- the fastest of any cloud table. Two mechanisms keep it bounded: the sampler batch-inserts a whole
-- flush in one round trip, and a retention purge (reputation-pool.score.retention, default 7d) deletes
-- rows past the window, exactly as the audit trail's purgeOlderThan trims the ledger.
--
-- The score is sampled per (resource × context) cell, so it can be plotted as one curve per context.
-- sampled_at is part of the primary key: a re-sample at the same instant (a replayed flush) is
-- idempotent (last write wins) rather than a duplicate-key failure.

create table score_sample (
    tenant_id      text not null,
    resource_kind  text not null,
    resource_value text not null,
    context        text not null,
    sampled_at     timestamptz not null,
    score          double precision not null,
    primary key (tenant_id, resource_kind, resource_value, context, sampled_at)
);

-- The read path (score-history for one resource over a time window) filters by
-- (tenant, kind, value) and ranges over sampled_at, then splits into per-context series in memory.
create index score_sample_lookup_idx
    on score_sample (tenant_id, resource_kind, resource_value, sampled_at);
