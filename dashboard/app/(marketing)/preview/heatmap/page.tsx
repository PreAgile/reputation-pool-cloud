import { notFound } from "next/navigation";
import { CellHeatmap } from "@/components/cell-heatmap";
import { heatmapFixture, heatmapNoCellsFixture } from "@/test/heatmap-fixtures";

/**
 * Cell 히트맵(#124) 미리보기 — 목업 데이터로 격자를 그린다. 다른 preview 라우트와 같이 dev 에서만
 * 렌더하고 프로덕션 번들에는 노출하지 않는다. 실데이터 배선(#123 롤업)은 아직 범위 밖이라,
 * 지금은 이 경로가 격자를 눈으로 확인하는 유일한 자리다.
 */
export default function PreviewHeatmap() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-xl font-extrabold tracking-tight">Cell 히트맵 · 미리보기</h1>
      <p className="mb-6 mt-1 text-sm text-muted">
        행=리소스, 열=컨텍스트, 칸 색=state. 아래 데이터는 목업이며 실데이터는 아직 연결돼 있지 않습니다.
      </p>

      <CellHeatmap rows={heatmapFixture} />

      <h2 className="mb-1 mt-10 text-base font-extrabold tracking-tight">빈 상태 · 판정된 컨텍스트 없음</h2>
      <p className="mb-3 text-sm text-muted">리소스는 등록됐지만 아직 성공/실패 보고가 없을 때.</p>
      <CellHeatmap rows={heatmapNoCellsFixture} />

      <h2 className="mb-1 mt-10 text-base font-extrabold tracking-tight">빈 상태 · 리소스 없음</h2>
      <p className="mb-3 text-sm text-muted">풀이 비어 있을 때.</p>
      <CellHeatmap rows={[]} />
    </main>
  );
}
