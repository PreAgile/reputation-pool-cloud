-- Cloud-owned schema (issue #83): pin tenant.status to the lifecycle state machine.
--
-- V100 introduced tenant.status as free text defaulting to 'active'. The lifecycle (TenantStatus:
-- active/suspended/deleted) is enforced in the application, but a CHECK makes the database the last
-- line of defence so a stray write can never leave a tenant in an unknown state. Spellings are the
-- lowercase TenantStatus.toDb() values; existing rows are all 'active', so this constraint validates
-- against the current data without a backfill.
alter table tenant
    add constraint tenant_status_check check (status in ('active', 'suspended', 'deleted'));
