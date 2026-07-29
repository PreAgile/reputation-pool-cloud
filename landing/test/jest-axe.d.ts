/**
 * jest-axe 타입 shim — 패키지가 자체 d.ts 를 싣지 않아 최소 시그니처만 선언한다.
 * (matcher 는 쓰지 않고 axe() 결과의 violations 만 직접 검사하므로 jest 전역 타입에 의존하지 않는다.)
 */
declare module "jest-axe" {
  export interface AxeViolationNode {
    html: string;
    target: string[];
  }
  export interface AxeViolation {
    id: string;
    impact?: "minor" | "moderate" | "serious" | "critical" | null;
    description: string;
    help: string;
    nodes: AxeViolationNode[];
  }
  export interface AxeResults {
    violations: AxeViolation[];
  }
  export function axe(
    html: Element | Document,
    options?: Record<string, unknown>,
  ): Promise<AxeResults>;
}
