#!/usr/bin/env bash
# reputation-pool-cloud 컨테이너 이미지 정리 — 배포마다 쌓이는 오래된 sha 이미지를 지운다.
#
# ## 왜 필요한가
# pull-deploy 는 배포할 때마다 새 `sha-<7자리>` 이미지를 GHCR 에서 받는다(app ~600MB, dashboard
# ~420MB). Docker 는 이전 이미지를 자동으로 지우지 않아 **무한 누적**된다(실측 20+개 ~10GB). score_sample
# (7일 롤링)·백업(7일)·컨테이너 로그(30MB 로테이션)와 달리 이미지에는 자동정리가 없어서 디스크가
# 서서히 찬다 — 이 스크립트가 그 자동정리를 담당한다.
#
# ## 무엇을 지우고 무엇을 남기나
#   남긴다: (1) 지금 **실행 중인** 이미지, (2) 컴포넌트별 **최근 KEEP(기본 3)개** — 롤백 여지.
#   지운다: 그 밖의 오래된 reputation-pool-cloud app/dashboard 이미지 + dangling(태그 없는) 레이어.
# repo prefix 로 스코프를 좁혀 postgres/caddy/grafana/prometheus 등 다른 이미지는 절대 건드리지 않는다.
#
# best-effort: docker 를 못 쓰거나 rmi 가 실패해도 0 으로 끝나 배포 흐름(pull-deploy)을 막지 않는다.
#
#   ./scripts/prune-images.sh            # KEEP=3
#   IMAGE_KEEP=5 ./scripts/prune-images.sh
set -uo pipefail

KEEP="${IMAGE_KEEP:-3}"
REPO_PREFIX="ghcr.io/preagile/reputation-pool-cloud"

# docker 그룹이 이 셸에 반영돼 있지 않으면 sudo 로 넘긴다 — pull-deploy.sh / bootstrap.sh 와 같은 판정.
if docker info > /dev/null 2>&1; then
	DOCKER=(docker)
elif sudo -n docker info > /dev/null 2>&1; then
	DOCKER=(sudo docker)
else
	echo "prune-images: docker 를 쓸 수 없다 — 정리를 건너뛴다(배포에는 영향 없음)" >&2
	exit 0
fi

# 실행 중인 이미지는 무조건 보존한다(정지 없이 rmi 하면 실패하지만, 명시적으로 걸러 안전하게 남긴다).
in_use="$("${DOCKER[@]}" ps --format '{{.Image}}' 2>/dev/null | sort -u)"

removed=0
for comp in app dashboard; do
	repo="$REPO_PREFIX/$comp"
	kept=0
	# 생성 시각 내림차순(최신 먼저)으로 태그 참조를 나열한다. CreatedAt 이 ISO 유사 문자열이라
	# 문자열 역정렬이 곧 시각 역정렬이다.
	while IFS= read -r ref; do
		[ -n "$ref" ] || continue
		# 실행 중이면 건너뛴다(보존).
		if grep -qxF "$ref" <<< "$in_use"; then
			continue
		fi
		kept=$((kept + 1))
		# 실행 중이 아닌 것 중 최근 KEEP 개는 롤백 여지로 남긴다.
		if [ "$kept" -le "$KEEP" ]; then
			continue
		fi
		if "${DOCKER[@]}" rmi "$ref" > /dev/null 2>&1; then
			removed=$((removed + 1))
		fi
	done < <("${DOCKER[@]}" images "$repo" --format '{{.CreatedAt}}\t{{.Repository}}:{{.Tag}}' 2>/dev/null \
		| sort -r | cut -f2-)
done

# 태그 없는(dangling) 레이어도 정리한다 — 새 이미지가 같은 태그를 덮으면 이전 레이어가 여기 남는다.
"${DOCKER[@]}" image prune -f > /dev/null 2>&1 || true

echo "prune-images: reputation-pool-cloud 이미지 ${removed}개 삭제 (실행 중 + 컴포넌트별 최근 ${KEEP}개 보존)"
