/**
 * 퀵스타트의 TypeScript 예제 본문. 페이지가 이 문자열을 그대로 렌더하고, 같은 디렉터리의
 * `typescript-example.test.ts` 가 **같은 문자열을 진짜 `tsc` 에 건다**.
 *
 * 왜 JSX 안에 인라인으로 두지 않는가: 인라인 스니펫은 아무도 컴파일하지 않는다. PR #130 리뷰에서
 * 드러난 실제 사고가 그것이다 — `loadPackageDefinition(...) as never` 로 캐스팅한 예제가 그 다음 줄의
 * 프로퍼티 접근에서 `TS2339` 를 냈고, 고객이 복사하면 실행 전에 컴파일부터 막혔다. 문자열을 한 곳에
 * 두고 계약 테스트가 컴파일러를 돌리면 예제가 썩는 순간 CI 가 빨개진다.
 *
 * 그래서 이 파일은 **문자열이지 모듈이 아니다**. 예제 코드 자체를 `.ts` 로 두고 `pnpm typecheck` 에
 * 맡기는 편이 더 간단해 보이지만, 그러면 페이지가 렌더할 소스 텍스트를 런타임에 읽어야 하고(Next
 * standalone 출력에 그 파일이 따라가지 않는다) 결국 사본이 둘로 갈린다.
 *
 * 예제 안에 백틱과 `${}` 를 쓰지 않는 이유도 같다 — 이 파일이 템플릿 리터럴이라 이스케이프가 필요해지고,
 * 이스케이프된 문자열은 "문서에 보이는 코드"와 "테스트가 컴파일하는 코드"가 미묘하게 달라질 여지를 만든다.
 */
export const TYPESCRIPT_WORKER_EXAMPLE = `import { credentials, loadPackageDefinition, Metadata, type ServiceClientConstructor } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";

// proto-loader hands back a plain object nested by proto package segment, typed only as GrpcObject.
// Declare the one path you use rather than casting the whole tree away — the cast is what makes a
// snippet like this stop compiling the moment you touch it.
interface AdvisorPackage {
  io: {
    github: {
      preagile: {
        reputationpool: { grpc: { v1: { ReputationAdvisor: ServiceClientConstructor } } };
      };
    };
  };
}

/** Your work. Replace this with the request you actually make through the leased resource. */
declare function useProxy(endpoint: string): Promise<void>;

const definition = loadSync("advisor.proto", { keepCase: false, defaults: true, longs: String });
const advisorPackage = loadPackageDefinition(definition) as unknown as AdvisorPackage;
const { ReputationAdvisor } = advisorPackage.io.github.preagile.reputationpool.grpc.v1;

// Loopback data plane: plaintext. Point this at a TLS-terminating endpoint and it becomes
// credentials.createSsl() — nothing else in this file changes.
const advisor = new ReputationAdvisor(process.env.RP_GRPC ?? "localhost:9093", credentials.createInsecure());

const auth = new Metadata();
auth.set("x-api-key", process.env.RP_API_KEY ?? "");

const call = <T>(method: string, request: unknown): Promise<T> =>
  new Promise((resolve, reject) => {
    advisor[method](request, auth, (error: Error | null, response: T) =>
      error === null ? resolve(response) : reject(error),
    );
  });

// google.protobuf.Duration accepts the "12.345s" JSON form.
const seconds = (ms: number): string => (ms / 1000).toFixed(3) + "s";

interface LeaseHandle {
  token: string;
  leasedAt: string;
  expiresAt: string;
}

export async function runOnce(): Promise<void> {
  const resource = { kind: "PROXY", value: "proxy-1.example.net:8080" };
  const context = { value: "checkout-us" };

  await call("Register", { resource }); // idempotent

  const acquired = await call<{ granted: boolean; lease?: LeaseHandle }>("Acquire", { context });
  if (!acquired.granted || acquired.lease === undefined) {
    return; // nothing eligible right now — back off and retry
  }
  const lease = acquired.lease;

  const startedAt = Date.now();
  try {
    await useProxy(resource.value);
    await call("Report", {
      resource,
      context,
      outcome: { success: { latency: seconds(Date.now() - startedAt) } },
    });
  } catch {
    await call("Report", {
      resource,
      context,
      outcome: { failure: { type: "TIMEOUT", latency: seconds(Date.now() - startedAt) } },
    });
  } finally {
    await call("Release", { lease: { resource, context, ...lease } });
  }
}
`;
