-- Cloud-owned metering (issue #10 / D6a): per-tenant usage meters, the input to billing (#6/D6b).
--
-- Usage is NOT retroactively collectible — a meter that starts late is empty for the gap forever — so
-- capture begins right after tenancy. Rows are pricing-model-neutral raw counts; the price model
-- (lease count / pool size / seats) is decided later and derived from these.
--
-- Two metrics, both keyed per tenant per UTC day:
--   'lease'     — accumulated count of granted leases (acquire successes) that day (a COUNTER: the
--                 rollup adds each flushed delta).
--   'pool_size' — the tenant's registered-resource count sampled that day (a GAUGE: the rollup sets
--                 the latest sampled value).
-- Cloud reserves V100+; upstream (reputation-pool persistence) owns V1-V99.

create table usage_meter (
    tenant_id    text not null,
    metric       text not null,
    period_start date not null,
    value        bigint not null,
    updated_at   timestamptz not null,
    primary key (tenant_id, metric, period_start)
);

create index usage_meter_tenant_metric_idx on usage_meter (tenant_id, metric, period_start);
