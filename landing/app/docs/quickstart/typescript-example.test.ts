import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TYPESCRIPT_WORKER_EXAMPLE } from "./typescript-example";

/**
 * 문서 예제 계약 테스트 (#130 리뷰 P2).
 *
 * 퀵스타트의 TypeScript 예제는 고객이 **그대로 복사해서 돌리는** 코드다. 그런데 스니펫은 문자열이라
 * `pnpm typecheck` 가 절대 보지 않는다 — 실제로 이 예제는 `as never` 캐스팅 때문에 첫 줄부터
 * `TS2339` 로 컴파일이 막힌 채 머지 직전까지 갔다. 눈으로 읽어서 잡을 수 있는 종류의 오류가 아니다.
 *
 * 그래서 여기서는 스니펫을 임시 파일로 쓰고 **진짜 컴파일러**를 돌린다. 타입 정의를 흉내 내거나 정규식으로
 * 검사하지 않는다 — 그러면 흉내가 틀렸을 때 통과하는 테스트가 되고, 그건 없느니만 못하다.
 *
 * 임시 디렉터리를 **이 앱 안에** 만드는 것이 핵심이다. tsc 의 모듈 해석은 파일 위치에서
 * 위로 올라가며 `node_modules` 를 찾으므로, `os.tmpdir()` 에 쓰면 `@grpc/grpc-js` 도 `@types/node` 도
 * 찾지 못해 "예제가 틀렸다"가 아니라 "환경이 틀렸다"로 실패한다. 이름을 점으로 시작하는 이유는 tsc 의
 * 와일드카드 include 가 점 디렉터리를 건너뛰기 때문 — 테스트가 중간에 죽어 디렉터리가 남더라도
 * `pnpm typecheck` 가 그 잔해를 주워 담지 않는다.
 */
describe("퀵스타트 TypeScript 예제 (#130)", () => {
  it(
    "문서에 실린 그대로 tsc --noEmit 을 통과한다 → 고객이 복사한 코드가 컴파일 단계에서 막히지 않는다",
    { timeout: 120_000 },
    () => {
      const appRoot = process.cwd();
      const workdir = mkdtempSync(path.join(appRoot, ".docs-example-typecheck-"));
      try {
        writeFileSync(path.join(workdir, "worker.ts"), TYPESCRIPT_WORKER_EXAMPLE, "utf8");
        // 대시보드 tsconfig 를 상속하지 않고 독립 설정을 쓴다: 검증하려는 것은 "이 프로젝트 안에서
        // 컴파일되는가"가 아니라 "평범한 strict TypeScript 프로젝트에 붙여 넣어도 컴파일되는가"다.
        writeFileSync(
          path.join(workdir, "tsconfig.json"),
          JSON.stringify({
            compilerOptions: {
              strict: true,
              target: "ES2022",
              module: "esnext",
              moduleResolution: "bundler",
              types: ["node"],
              skipLibCheck: true,
              noEmit: true,
            },
            files: ["worker.ts"],
          }),
          "utf8",
        );

        // `pnpm exec tsc` 가 아니라 노드로 컴파일러를 직접 실행한다 — 패키지 매니저를 한 겹 끼우면
        // PATH·corepack 상태에 따라 CI 에서만 다르게 실패한다.
        const compiler = path.join(appRoot, "node_modules", "typescript", "bin", "tsc");
        let diagnostics = "";
        try {
          execFileSync(process.execPath, [compiler, "--project", workdir], {
            encoding: "utf8",
            stdio: "pipe",
          });
        } catch (error) {
          // tsc 는 진단을 stdout 으로 낸다. 던져진 예외만 보고하면 "exit code 2" 로 끝나 어느 줄이
          // 왜 틀렸는지 알 수 없으므로, 실패 메시지에 진단 전문을 그대로 싣는다.
          const failure = error as { stdout?: string; stderr?: string };
          diagnostics = `${failure.stdout ?? ""}${failure.stderr ?? ""}`.trim() || String(error);
        }
        expect(diagnostics).toBe("");
      } finally {
        rmSync(workdir, { recursive: true, force: true });
      }
    },
  );
});
