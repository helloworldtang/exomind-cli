/** entity 命令:描述历史展示护栏。
 *  质量点:有 desc_history 时输出历史行(新→旧,含 cause);无历史时不输出该段
 *  (旧服务端/未替换过的实体,静默兼容)。 */
import './_setup_cache';
import { describe, test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { ApiClient } from '../src/api';

let entity!: typeof import('../src/commands/entity');
before(async () => {
  entity = (await import('../src/commands/entity')).default;
});

const origLog = console.log;
afterEach(() => {
  console.log = origLog;
});

function fakeClient(result: Record<string, unknown>) {
  return { get: async () => result } as unknown as ApiClient;
}

describe('entity 描述历史', () => {
  test('有历史:输出 cause 与时间行', async () => {
    const buf: string[] = [];
    console.log = (...a: unknown[]) => buf.push(a.map(String).join(' '));
    await entity(fakeClient({
      name: '西燕', type: 'dynasty', connections: 3,
      desc_history: [
        { ts: '2026-11-09T10:00:00', cause: 'human_edit', by: '1', desc: '旧描述' },
        { ts: '2026-11-08T09:00:00', cause: 'ingest_longer', desc: '更旧' },
      ],
    }), {}, ['西燕']);
    const out = buf.join('\n');
    assert.match(out, /描述历史 \(2/);
    assert.match(out, /human_edit/);
    assert.match(out, /ingest_longer/);
  });

  test('无历史/旧服务端:不输出历史段', async () => {
    const buf: string[] = [];
    console.log = (...a: unknown[]) => buf.push(a.map(String).join(' '));
    await entity(fakeClient({ name: 'X', type: 'tool', connections: 0, desc_history: [] }), {}, ['X']);
    await entity(fakeClient({ name: 'Y', type: 'tool', connections: 0 }), {}, ['Y']);
    assert.ok(!buf.join('\n').includes('描述历史'));
  });
});
