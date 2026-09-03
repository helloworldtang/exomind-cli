/** 版本更新提醒:每 24h 查一次 npm registry,有新版在命令尾部打一行 stderr 提示。

 *  设计约束:任何失败静默(网络/解析/状态写),绝不影响命令本身;
 *  EXOMIND_SKIP_UPDATE_CHECK=1 可关;超时 3s 兜底,不拖慢日常使用。 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { dim } from './format';
import { CACHE_DIR } from './config';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;

/** 语义化版本比较:<0 表示 current 旧于 latest;解析失败返回 0(不提醒)。 */
export function compareVersions(current: string, latest: string): number {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/, '')
      .split('.')
      .map(Number);
  const a = parse(current);
  const b = parse(latest);
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some(Number.isNaN)) return 0;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function statePath(): string {
  return path.join(CACHE_DIR, 'update-check.json');
}

/** 命令成功执行后调用:必要时查新版并提示(同版本 24h 内只查一次)。 */
export async function maybeNotifyUpdate(
  current: string,
  registry = 'https://registry.npmjs.org',
): Promise<void> {
  if (process.env.EXOMIND_SKIP_UPDATE_CHECK === '1') return;
  const file = statePath();
  try {
    const st = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (st.version === current && Date.now() - (st.ts ?? 0) < CHECK_INTERVAL_MS) return;
  } catch {
    /* 无状态文件 → 查 */
  }
  let latest = '';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const r = await fetch(`${registry}/exomind/latest`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (r.ok) latest = String((await r.json()).version || '');
  } catch {
    /* 网络失败静默,明天再查 */
  }
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: current, ts: Date.now(), latest }));
  } catch {
    /* 状态写失败不纠 */
  }
  if (latest && compareVersions(current, latest) < 0) {
    process.stderr.write(dim(`↗ 发现新版 v${latest}(当前 v${current}):npm i -g exomind 升级\n`));
  }
}
