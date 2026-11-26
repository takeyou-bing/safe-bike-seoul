// 빌드된 브라우저용 파일(.next/static)에 서버 전용 키 값이 들어갔는지 검사합니다.
// npm run build 직후 postbuild로 자동 실행되며(Vercel 배포 포함), 노출이 발견되면 빌드를 실패시킵니다.
// 직접 실행: npm run check:secrets
// 키 값은 출력하지 않고, 발견된 변수 이름과 파일만 표시합니다.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import nextEnv from "@next/env";

const root = process.cwd();
nextEnv.loadEnvConfig(root);

const staticDir = join(root, ".next", "static");
if (!existsSync(staticDir)) {
  console.error("✖ .next/static 이 없습니다. 먼저 `npm run build` 를 실행하세요.");
  process.exit(2);
}

// NEXT_PUBLIC_ 이 아닌, .env 계열 파일에 정의된 값 중 8자 이상인 것만 비밀로 간주
const envFiles = [".env", ".env.local", ".env.production", ".env.production.local"].filter((f) => existsSync(join(root, f)));
// Vercel 등 배포 환경에는 .env 파일이 없고 환경변수만 있으므로, 이 앱의 서버 전용 키 이름은 항상 검사
const secretNames = new Set(["KAKAO_REST_API_KEY", "SEOUL_API_KEY", "DATA_GO_KR_API_KEY"]);
for (const f of envFiles) {
  for (const line of readFileSync(join(root, f), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && !m[1].startsWith("NEXT_PUBLIC_")) secretNames.add(m[1]);
  }
}
const secrets = [...secretNames]
  .map((name) => ({ name, value: process.env[name]?.trim() ?? "" }))
  .filter((s) => s.value.length >= 8);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const leaks = [];
let files = 0;
for (const file of walk(staticDir)) {
  files++;
  const text = readFileSync(file, "utf8");
  for (const s of secrets) {
    if (text.includes(s.value) || text.includes(encodeURIComponent(s.value))) leaks.push(`${s.name} → ${file.slice(root.length + 1)}`);
  }
}

if (leaks.length) {
  console.error("✖ 브라우저 번들에서 서버 전용 키가 발견되었습니다:");
  for (const l of leaks) console.error("  - " + l);
  process.exit(1);
}
console.log(`✔ 서버 전용 키 ${secrets.length}개를 브라우저 파일 ${files}개에서 검사했습니다. 노출 없음.`);
