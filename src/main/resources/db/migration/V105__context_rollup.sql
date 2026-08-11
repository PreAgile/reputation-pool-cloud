-- Cloud-owned hourly reputation rollup per context (issue #10 follow-up): the input to the dashboard's
-- context view (컨텍스트별 평판 추이). Cloud reserves V100+; upstream owns V1-V99.
--
-- Why a rollup instead of querying score_sample directly: score_sample holds one row per
-- (tenant × resource × context) per sample tick, which is ~4GB for its 7-day retention window on the
-- production box. Aggregating it per context over a 30- or 90-day range is impossible — the raw rows
-- are purged long before that, and the scan would be unbounded even if they were not.
--
-- This table's cardinality is (tenant × context × hour) instead, so a full year of every context costs
-- a few thousand rows. That is what lets the dashboard offer 30d/90d windows on the context curve while
-- raw-sample retention stays at 7 days.
--
-- Sums, not averages: ScoreSampler upserts into the current hour's bucket on every tick, so the bucket
-- accumulates score_sum/sample_count and the reader divides. Storing a pre-divided average would make
-- the upsert lossy (an average cannot be merged with a new observation without its weight).
create table score_rollup_hourly (
    tenant_id    text not null,
    context      text not null,
    bucket_hour  timestamptz not null,
    score_sum    double precision not null,
    sample_count bigint not null,
    min_score    double precision not null,
    max_score    double precision not null,
    cells        integer not null,
    primary key (tenant_id, context, bucket_hour)
);

-- The read path (every context's series for one tenant over a time window) filters by tenant and
-- ranges over bucket_hour.
create index score_rollup_hourly_lookup_idx
    on score_rollup_hourly (tenant_id, bucket_hour);
