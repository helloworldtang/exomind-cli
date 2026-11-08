/** formatTrace: 检索链路 trace 的人类可读展示护栏。
 *  质量点:①有 degraded 用警示色(降级要显眼,不能混进普通 dim 行)②旧服务端
 *  无 trace 字段时静默不打印(向后兼容)。 */
import './_setup_cache';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

let m!: typeof import('../src/commands/trace');
before(async () => {
  m = await import('../src/commands/trace');
});

test('有 degraded 时输出含降级原因的行', () => {
  const out: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => out.push(String(a[0]));
  try {
    m.formatTrace({ legs: ['bm25'], degraded: ['graph_unavailable'] });
  } finally {
    console.log = orig;
  }
  assert.equal(out.length, 1);
  assert.match(out[0], /graph_unavailable/);
  assert.match(out[0], /bm25/);
});

test('旧服务端无 trace / 空态静默不打印', () => {
  const orig = console.log;
  let called = 0;
  console.log = () => called++;
  try {
    m.formatTrace(undefined);
    m.formatTrace({});
    m.formatTrace({ legs: [], degraded: [] });
  } finally {
    console.log = orig;
  }
  assert.equal(called, 0);
});
