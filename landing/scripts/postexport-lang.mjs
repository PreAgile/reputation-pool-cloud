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
 * ## 안전장치: "몇 건"이 아니라 "어느 문서"를 기대한다 (#143)
 * 처음에는 대상이 `ko.html` 한 건이었고, 스크립트는 "0 건이면 실패"로만 자신을 지켰다. 한국어 docs 가
 * 생기면서 대상이 7 건(`/ko` + docs 6 장)이 됐는데, "0 건 아님" 만 보는 검사는 라우트가 늘어도 1 건만
 * 고치고 **조용히 통과한다** — 한국어 문서가 `lang="en"` 으로 배포되고도 빌드는 초록색이다.
 *
 * 그래서 기대 목록을 숫자로 박지 않고 **`out/sitemap.xml` 에서 파생시킨다.** 사이트맵은 문서 IA 단일
 * 출처(`lib/docs-manifest.ts`)에서 생성되므로, 이 스크립트가 사이트맵을 읽으면 결과적으로 매니페스트를
 * 읽는 것과 같다(노드에서 TS 를 직접 import 하지 않고). 그리고 두 산출물을 **교차 검증**하게 된다:
 *   - 사이트맵에 있고 export 에 없다  → 라우트가 빠졌다
 *   - export 에 있고 사이트맵에 없다  → 색인 대상에서 빠졌다
 * 어느 쪽이든 조용히 넘어가면 안 되는 사고이므로 둘 다 실패로 끝낸다.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = "out";
const SITEMAP = path.join(OUT_DIR, "sitemap.xml");
/** `/ko` 아래로 나가는 문서들. 앞으로 `ko/…` 하위 페이지가 늘어도 접두사로 잡힌다. */
const KOREAN_PREFIX = "ko";

function fail(message) {
  console.error(`postexport-lang: ${message}`);
  process.exit(1);
}

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

/**
 * 사이트맵의 한국어 URL 을 export 산출물의 상대 경로로 옮긴다.
 * `trailingSlash: false` 이므로 `/ko` → `ko.html`, `/ko/docs/api` → `ko/docs/api.html` 이다.
 */
async function expectedKoreanFiles() {
  let xml;
  try {
    xml = await readFile(SITEMAP, "utf8");
  } catch {
    return fail(`${SITEMAP} 을 읽을 수 없다 — app/sitemap.ts 가 내보내지지 않았는지 확인한다`);
  }
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (locs.length === 0) fail(`${SITEMAP} 에 <loc> 가 없다 — 사이트맵 생성이 깨졌는지 확인한다`);

  const expected = new Set();
  for (const loc of locs) {
    const pathname = new URL(loc).pathname.replace(/\/+$/, "");
    const relative = pathname.replace(/^\//, "");
    if (relative === KOREAN_PREFIX || relative.startsWith(`${KOREAN_PREFIX}/`)) {
      expected.add(`${relative}.html`);
    }
  }
  if (expected.size === 0) {
    fail(`사이트맵에 '${KOREAN_PREFIX}' 경로가 없다 — 한국어 라우트가 사이트맵에서 빠졌는지 확인한다`);
  }
  return expected;
}

const expected = await expectedKoreanFiles();

const patched = new Set();
for await (const file of htmlFiles(OUT_DIR)) {
  const relative = path.relative(OUT_DIR, file).split(path.sep).join("/");
  if (!isKorean(relative)) continue;

  const html = await readFile(file, "utf8");
  const next = html.replace(/<html([^>]*?)\slang="en"/, '<html$1 lang="ko"');
  if (next === html) {
    fail(`${relative} 에서 lang="en" 을 찾지 못했다 — 루트 레이아웃이 바뀌었는지 확인한다`);
  }
  await writeFile(file, next, "utf8");
  patched.add(relative);
}

// 기대와 실제가 정확히 같아야 한다. 한쪽에만 있는 항목은 "라우트 누락" 또는 "색인 누락" 이고,
// 둘 다 배포 후에는 조용하다(페이지는 열리고 lang 만 틀리다).
const missing = [...expected].filter((f) => !patched.has(f)).sort();
const unexpected = [...patched].filter((f) => !expected.has(f)).sort();
if (missing.length > 0 || unexpected.length > 0) {
  if (missing.length > 0) {
    console.error(`postexport-lang: 사이트맵에 있으나 export 에 없다 (${missing.length}건) — ${missing.join(", ")}`);
  }
  if (unexpected.length > 0) {
    console.error(
      `postexport-lang: export 에 있으나 사이트맵에 없다 (${unexpected.length}건) — ${unexpected.join(", ")}`,
    );
  }
  fail(`기대 ${expected.size}건 · 실제 ${patched.size}건 — 한국어 라우트와 사이트맵이 어긋났다`);
}

console.log(
  `postexport-lang: lang="ko" 로 보정 (${patched.size}건, 사이트맵 기대치와 일치) — ${[...patched].sort().join(", ")}`,
);
