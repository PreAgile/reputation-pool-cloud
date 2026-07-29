/**
 * 내보낸 한국어 문서의 `<html lang>` 을 보정한다.
 *
 * ## 왜 후처리인가
 * App Router 에서 `<html>` 을 렌더하는 것은 **루트 레이아웃 하나뿐**이고, 정적 내보내기에는 요청 시점이
 * 없으므로 경로에 따라 다른 `lang` 을 넣을 방법이 없다. 그래서 `/` 와 `/ko` 가 같은 `lang="en"` 으로
 * 나간다.
 *
 * 클라이언트 보정(`components/html-lang.tsx`)은 하이드레이션 **이후**에 걸린다. 그 전에 읽는 쪽 —
 * 스크린리더의 초기 음성 언어 선택, JS 를 돌리지 않는 크롤러 — 은 한국어 문서를 영어로 인식한다.
 * 접근성 문제가 실질적이라 초기 HTML 자체를 고친다.
 *
 * ## 왜 빌드를 두 번 돌리지 않나
 * 언어별로 `next build` 를 따로 돌리면 이 문제가 사라지지만, 빌드 시간이 두 배가 되고 산출물을 합치는
 * 단계가 새로 생긴다. 바꿔야 할 것이 문서당 속성 하나라 그 비용을 치를 값이 없다.
 *
 * ## 안전장치
 * 바꾼 문서가 하나도 없으면 **실패로 끝낸다.** 라우트 구조가 바뀌어 이 스크립트가 아무 일도 하지 않게
 * 되면 조용히 lang 이 틀린 채로 배포되는데, 그건 이 스크립트가 없는 것보다 나쁘다(있다고 믿게 된다).
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = "out";
/** `/ko` 아래로 나가는 문서들. 앞으로 `ko/…` 하위 페이지가 늘어도 접두사로 잡힌다. */
const KOREAN_PREFIX = "ko";

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(full);
    else if (entry.name.endsWith(".html")) yield full;
  }
}

function isKorean(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  return normalized === `${KOREAN_PREFIX}.html` || normalized.startsWith(`${KOREAN_PREFIX}/`);
}

const patched = [];
for await (const file of htmlFiles(OUT_DIR)) {
  const relative = path.relative(OUT_DIR, file);
  if (!isKorean(relative)) continue;

  const html = await readFile(file, "utf8");
  const next = html.replace(/<html([^>]*?)\slang="en"/, '<html$1 lang="ko"');
  if (next === html) {
    console.error(`postexport-lang: ${relative} 에서 lang="en" 을 찾지 못했다 — 루트 레이아웃이 바뀌었는지 확인한다`);
    process.exit(1);
  }
  await writeFile(file, next, "utf8");
  patched.push(relative);
}

if (patched.length === 0) {
  console.error(`postexport-lang: 보정한 문서가 없다 — '${KOREAN_PREFIX}' 경로 규칙이 바뀌었는지 확인한다`);
  process.exit(1);
}

console.log(`postexport-lang: lang="ko" 로 보정 (${patched.length}건) — ${patched.join(", ")}`);
