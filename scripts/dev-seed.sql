-- dev-seed.sql — 로컬 데모용 목 데이터 시드 (운영 반입 금지, Flyway 마이그레이션 아님).
--
-- 무엇을 채우나
--   * registered_resource / cell / cell_outcome / blocklist_entry  → 오버뷰·리소스 상세(인메모리 풀)
--   * score_sample                                                 → 리소스 상세 "평판 곡선"(시계열)
--   * audit_event                                                  → 감사 타임라인·이벤트 피드
--
-- 왜 재시작이 필요한가
--   오버뷰/상세는 DB 를 직접 읽지 않고 registry.poolFor(tenant).snapshot() (인메모리 풀)에서 나온다.
--   풀은 기동 시 PostgresResourceStore.load() 로 이 테이블들에서 복원되고, 이후 30초마다 체크포인트가
--   인메모리 상태로 pool_id 행 전체를 DELETE 후 재삽입한다. 따라서 셀/차단 시드를 화면에 띄우려면
--   "백엔드 정지 → 이 스크립트 실행 → 백엔드 기동(복원)" 순서여야 한다(정지 시 최종 체크포인트가
--   빈 인메모리 상태로 덮어쓰기 때문에 반드시 정지 후 시드).
--   score_sample 과 audit_event 는 read-model 이 테이블을 직접 읽으므로 재시작 없이 즉시 반영된다.
--
-- 스코프: tenant_id / pool_id = 'default' (admin JWT 의 tenant claim). 시각 컬럼 규약:
--   score_sample.sampled_at        = timestamptz
--   cell.updated_at / cooldown_until, blocklist_entry.until, audit_event.occurred_at/until = epoch NANOS(bigint)
--
-- 실행:  docker exec -i reputation-pool-db psql -U reputation_pool -d reputation_pool < scripts/dev-seed.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. 시드 초기화 (재현 가능하도록 default 스코프만 비우고 다시 채운다; dev 전용)
-- ---------------------------------------------------------------------------
DELETE FROM cell_outcome        WHERE pool_id = 'default';
DELETE FROM cell                WHERE pool_id = 'default';
DELETE FROM blocklist_entry     WHERE pool_id = 'default';
DELETE FROM registered_resource WHERE pool_id = 'default';
DELETE FROM score_sample        WHERE tenant_id = 'default';
DELETE FROM audit_event;  -- dev 데모 트레일: 통째로 교체

-- snapshot_meta 마커가 있어야 load() 가 "저장된 적 있음"으로 보고 셀을 복원한다.
INSERT INTO snapshot_meta (pool_id, saved_at) VALUES ('default', now())
    ON CONFLICT (pool_id) DO UPDATE SET saved_at = EXCLUDED.saved_at;

-- ---------------------------------------------------------------------------
-- 1. 리소스·셀 카탈로그 (kind, value, context, state, 현재 score)
--    상태 골고루: HEALTHY 9 · RECOVERING 5 · COOLING 7  (셀 21 / 리소스 15)
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE seed_cell (kind text, val text, ctx text, state text, cur double precision) ON COMMIT DROP;
INSERT INTO seed_cell VALUES
    -- PROXY
    ('PROXY','proxy-kr-seoul-01','login',   'HEALTHY',    0.94),
    ('PROXY','proxy-kr-seoul-01','checkout','HEALTHY',    0.91),
    ('PROXY','proxy-kr-seoul-02','login',   'RECOVERING', 0.63),
    ('PROXY','proxy-kr-busan-03','login',   'COOLING',    0.34),
    ('PROXY','proxy-kr-busan-03','search',  'COOLING',    0.41),
    ('PROXY','proxy-us-ashburn-01','checkout','HEALTHY',  0.88),
    ('PROXY','proxy-us-ashburn-01','search', 'HEALTHY',   0.90),
    ('PROXY','proxy-us-ashburn-02','login',  'HEALTHY',   0.86),
    ('PROXY','proxy-jp-tokyo-01','search',   'COOLING',   0.28),
    ('PROXY','proxy-jp-tokyo-01','login',    'RECOVERING',0.55),
    ('PROXY','proxy-sg-singapore-01','login','COOLING',   0.18),  -- 임시 차단 대상
    ('PROXY','proxy-de-frankfurt-01','checkout','HEALTHY',0.92),
    -- ACCOUNT
    ('ACCOUNT','account-buyer-8842','checkout','HEALTHY', 0.95),
    ('ACCOUNT','account-buyer-8842','login',   'HEALTHY', 0.93),
    ('ACCOUNT','account-buyer-1099','login',   'RECOVERING',0.58),
    ('ACCOUNT','account-seller-3310','checkout','COOLING',0.37),
    ('ACCOUNT','account-bot-6621','login',     'COOLING', 0.12),  -- 영구 차단 대상
    -- SESSION
    ('SESSION','session-web-4a1f','browse',  'HEALTHY',   0.90),
    ('SESSION','session-mobile-7c2e','browse','RECOVERING',0.66),
    ('SESSION','session-mobile-7c2e','login', 'RECOVERING',0.70),
    ('SESSION','session-api-9b33','api',      'COOLING',  0.33);

-- ---------------------------------------------------------------------------
-- 2. registered_resource (리소스 15종)
-- ---------------------------------------------------------------------------
INSERT INTO registered_resource (pool_id, resource_kind, resource_value)
SELECT DISTINCT 'default', kind, val FROM seed_cell;

-- ---------------------------------------------------------------------------
-- 3. cell (셀 상태·score·연속 스트릭·냉각 해제 시각·갱신 시각)
--    COOLING 만 cooldown_until 을 미래로(냉각 진행 중), 나머지는 EPOCH(0 = 냉각 아님).
-- ---------------------------------------------------------------------------
INSERT INTO cell (pool_id, resource_kind, resource_value, context, score,
                  consecutive_failures, consecutive_successes, state, cooldown_until, updated_at)
SELECT
    'default', kind, val, ctx, cur,
    CASE state WHEN 'COOLING' THEN 8 ELSE 0 END,
    CASE state WHEN 'HEALTHY' THEN 12 WHEN 'RECOVERING' THEN 7 ELSE 0 END,
    state,
    CASE WHEN state = 'COOLING'
         THEN (extract(epoch FROM now() + interval '45 minutes') * 1e9)::bigint
         ELSE 0 END,
    (extract(epoch FROM now() - interval '2 minutes') * 1e9)::bigint
FROM seed_cell;

-- ---------------------------------------------------------------------------
-- 4. cell_outcome (셀별 최근 판정 창 12건 → 오버뷰 스파크라인·상세 평가표본)
--    HEALTHY: 전부 성공 / RECOVERING: 앞 5 실패 후 성공 / COOLING: 앞 4 성공 후 실패
-- ---------------------------------------------------------------------------
INSERT INTO cell_outcome (pool_id, resource_kind, resource_value, context, ordinal, success, failure_type, latency_ns)
SELECT
    'default', s.kind, s.val, s.ctx, w.ord, w.succ,
    CASE WHEN w.succ THEN NULL
         ELSE (ARRAY['BLOCKED','TIMEOUT','CONNECTION_RESET','TLS_HANDSHAKE'])[1 + (w.ord % 4)] END,
    (40000000 + w.ord * 3500000)::bigint  -- ~40~78ms
FROM seed_cell s
CROSS JOIN LATERAL (
    SELECT ord,
           CASE s.state
               WHEN 'HEALTHY'    THEN true
               WHEN 'RECOVERING' THEN ord >= 5   -- 앞 5 실패, 뒤 7 성공
               WHEN 'COOLING'    THEN ord < 4     -- 앞 4 성공, 뒤 8 실패
           END AS succ
    FROM generate_series(0, 11) AS ord
) AS w;

-- ---------------------------------------------------------------------------
-- 5. blocklist_entry (차단 2종: 임시 = until 미래 nanos / 영구 = until NULL)
-- ---------------------------------------------------------------------------
INSERT INTO blocklist_entry (pool_id, resource_kind, resource_value, until) VALUES
    ('default','PROXY','proxy-sg-singapore-01', (extract(epoch FROM now() + interval '45 minutes') * 1e9)::bigint),
    ('default','ACCOUNT','account-bot-6621', NULL);

-- ---------------------------------------------------------------------------
-- 6. score_sample (평판 곡선 시계열)
--    최근 24h 는 20분 간격(조밀), 26h~30일 구간은 3시간 간격(성긴 이력) → 24h/7d/30d 뷰 모두 채워짐.
--    곡선 모양은 상태별로: HEALTHY=고점 완만 / COOLING=최근 8h 하강 / RECOVERING=최근 8h 상승.
--    가장 최근 점(m=0)은 셀의 현재 score(cur)에 수렴. 노이즈는 sin() 기반(재현 가능, random 미사용).
-- ---------------------------------------------------------------------------
INSERT INTO score_sample (tenant_id, resource_kind, resource_value, context, sampled_at, score)
SELECT
    'default', s.kind, s.val, s.ctx,
    now() - (g.m * interval '1 minute'),
    GREATEST(0.05, LEAST(0.99,
        CASE s.state
            WHEN 'HEALTHY'    THEN s.cur - 0.02 + 0.03 * sin(g.m / 110.0)
            WHEN 'COOLING'    THEN s.cur + (0.80 - s.cur) * LEAST(1.0, g.m / 480.0) + 0.015 * sin(g.m * 0.05)
            WHEN 'RECOVERING' THEN s.cur - (s.cur - 0.30) * LEAST(1.0, g.m / 480.0) + 0.015 * sin(g.m * 0.05)
        END))
FROM seed_cell s
CROSS JOIN LATERAL (
    SELECT m FROM generate_series(0, 1440, 20) AS m        -- 최근 24h @ 20분
    UNION
    SELECT m FROM generate_series(1560, 43200, 180) AS m   -- 26h~30일 @ 3시간
) AS g;

-- ---------------------------------------------------------------------------
-- 7. audit_event (감사 트레일)
--    occurred_at 오름차순으로 INSERT 하여 seq 가 시간순으로 증가 → /events(seq DESC)가 최신순으로 보인다.
--    A) HEALTHY 리소스의 주기적 임대/반납(정상 트래픽)  B) 상태 전이 사연(냉각/회복/차단/해제)
-- ---------------------------------------------------------------------------
INSERT INTO audit_event (event_type, resource_kind, resource_value, context, occurred_at, until, cause)
SELECT event_type, resource_kind, resource_value, context, occurred_at, until, cause
FROM (
    -- A) 정상 임대/반납: HEALTHY 셀마다 3/9/15/21시간 전 LEASED + 4분 뒤 LEASE_RELEASED
    SELECT 'RESOURCE_LEASED' AS event_type, s.kind AS resource_kind, s.val AS resource_value, s.ctx AS context,
           (extract(epoch FROM now() - (h * interval '1 hour')) * 1e9)::bigint AS occurred_at,
           (extract(epoch FROM now() - (h * interval '1 hour') + interval '5 minutes') * 1e9)::bigint AS until,
           NULL::text AS cause
    FROM seed_cell s CROSS JOIN generate_series(3, 21, 6) AS h
    WHERE s.state = 'HEALTHY'
    UNION ALL
    SELECT 'LEASE_RELEASED', s.kind, s.val, s.ctx,
           (extract(epoch FROM now() - (h * interval '1 hour') + interval '4 minutes') * 1e9)::bigint,
           NULL, NULL
    FROM seed_cell s CROSS JOIN generate_series(3, 21, 6) AS h
    WHERE s.state = 'HEALTHY'

    -- B) 냉각: COOLING 셀마다 최근(1~5h 전) RESOURCE_COOLED (cause = FailureType, until = 냉각 해제 예정)
    UNION ALL
    SELECT 'RESOURCE_COOLED', s.kind, s.val, s.ctx,
           (extract(epoch FROM now() - ((1 + (row_number() OVER (ORDER BY s.val, s.ctx)) % 5) * interval '1 hour')) * 1e9)::bigint,
           (extract(epoch FROM now() + interval '45 minutes') * 1e9)::bigint,
           (ARRAY['BLOCKED','TIMEOUT','CONNECTION_RESET','TLS_HANDSHAKE'])[1 + (row_number() OVER (ORDER BY s.val, s.ctx))::int % 4]
    FROM seed_cell s WHERE s.state = 'COOLING'

    -- B) 회복: RECOVERING 셀마다 과거(10~13h 전) COOLED → 최근(1~3h 전) RESOURCE_RECOVERED
    UNION ALL
    SELECT 'RESOURCE_COOLED', s.kind, s.val, s.ctx,
           (extract(epoch FROM now() - ((10 + (row_number() OVER (ORDER BY s.val, s.ctx)) % 4) * interval '1 hour')) * 1e9)::bigint,
           (extract(epoch FROM now() - (9 * interval '1 hour')) * 1e9)::bigint,
           (ARRAY['TIMEOUT','SLOW','CONNECTION_RESET'])[1 + (row_number() OVER (ORDER BY s.val, s.ctx))::int % 3]
    FROM seed_cell s WHERE s.state = 'RECOVERING'
    UNION ALL
    SELECT 'RESOURCE_RECOVERED', s.kind, s.val, s.ctx,
           (extract(epoch FROM now() - ((1 + (row_number() OVER (ORDER BY s.val, s.ctx)) % 3) * interval '1 hour')) * 1e9)::bigint,
           NULL, NULL
    FROM seed_cell s WHERE s.state = 'RECOVERING'

    -- B) 차단 사연 (명시적)
    UNION ALL
    SELECT * FROM (VALUES
        -- singapore-01: 3h 전 냉각 → 40분 전 임시 차단(45분 후 해제)
        ('RESOURCE_COOLED','PROXY','proxy-sg-singapore-01','login',
            (extract(epoch FROM now() - interval '3 hours') * 1e9)::bigint,
            (extract(epoch FROM now() - interval '2 hours') * 1e9)::bigint, 'BLOCKED'),
        ('RESOURCE_BLOCKLISTED','PROXY','proxy-sg-singapore-01',NULL,
            (extract(epoch FROM now() - interval '40 minutes') * 1e9)::bigint,
            (extract(epoch FROM now() + interval '45 minutes') * 1e9)::bigint, NULL),
        -- bot-6621: 2h 전 영구 차단(until NULL)
        ('RESOURCE_BLOCKLISTED','ACCOUNT','account-bot-6621',NULL,
            (extract(epoch FROM now() - interval '2 hours') * 1e9)::bigint, NULL, NULL),
        -- seoul-02(회복 중) 사연: 20h 전 차단 → 14h 전 해제
        ('RESOURCE_BLOCKLISTED','PROXY','proxy-kr-seoul-02',NULL,
            (extract(epoch FROM now() - interval '20 hours') * 1e9)::bigint,
            (extract(epoch FROM now() - interval '14 hours') * 1e9)::bigint, NULL),
        ('RESOURCE_UNBLOCKED','PROXY','proxy-kr-seoul-02',NULL,
            (extract(epoch FROM now() - interval '14 hours') * 1e9)::bigint, NULL, NULL)
    ) AS v(event_type, resource_kind, resource_value, context, occurred_at, until, cause)
) AS all_events
ORDER BY occurred_at;

-- ---------------------------------------------------------------------------
-- 6. usage_meter — 대시보드 /usage 의 일별 임대 미터 (최근 30일, backdate)
--    /usage 는 이 테이블을 UsageMeterReader 가 JDBC 로 직독하므로(오버뷰/상세와 달리
--    인메모리 풀 경유 아님) 이 INSERT 는 백엔드 재시작 없이 즉시 반영된다.
--    metric='lease' 를 일자별로 채운다. metric='pool_size' 는 러닝 백엔드의 롤업이
--    유지하므로 손대지 않는다(없을 때만 위 registered_resource 수로 보강).
--    값 설계(결정적·재현 가능): 완만한 우상향 추세 + 주말 저조 + 소폭 노이즈.
-- ---------------------------------------------------------------------------
DELETE FROM usage_meter WHERE tenant_id = 'default' AND metric = 'lease';

INSERT INTO usage_meter (tenant_id, metric, period_start, value, updated_at)
SELECT
    'default',
    'lease',
    (CURRENT_DATE - (29 - d)) AS period_start,
    GREATEST(1, ROUND(
        (35 + d * 4.5)                                   -- 30일에 걸친 완만한 우상향
        * CASE WHEN EXTRACT(dow FROM (CURRENT_DATE - (29 - d))) IN (0, 6)
               THEN 0.55 ELSE 1.0 END                    -- 주말(일/토) 저조
        + (((d * 7) % 13) - 6)                            -- ±6 결정적 노이즈
    ))::bigint AS value,
    now()
FROM generate_series(0, 29) AS d;

-- pool_size 미터가 아직 없으면(백엔드 롤업 이전 상태) 리소스 수로 1건 보강.
INSERT INTO usage_meter (tenant_id, metric, period_start, value, updated_at)
SELECT 'default', 'pool_size', CURRENT_DATE,
       (SELECT count(*) FROM registered_resource WHERE pool_id = 'default'), now()
WHERE NOT EXISTS (
    SELECT 1 FROM usage_meter WHERE tenant_id = 'default' AND metric = 'pool_size'
);

COMMIT;
