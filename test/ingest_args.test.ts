import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIngestDir } from '../src/commands/ingest';

describe('resolveIngestDir(--dir 容错)', () => {
  test('文档写法: --dir <目录> → commander 给 string', () => {
    assert.equal(resolveIngestDir('/tmp/x', []), '/tmp/x');
  });

  test('landing 写法: ingest <目录> --dir → --dir 是 true,目录在位置参数', () => {
    assert.equal(resolveIngestDir(true, ['/tmp/x']), '/tmp/x');
    assert.equal(resolveIngestDir(true, ['/tmp/x', '多余参数']), '/tmp/x');
  });

  test('无目录 → 明确报错(两种用法都教),不是 commander 的 argument missing', () => {
    assert.throws(() => resolveIngestDir(true, []), /exomind ingest --dir <目录>/);
    assert.throws(() => resolveIngestDir(undefined, []), /两种写法/);
    assert.throws(() => resolveIngestDir(true, ['-']), /--dir 需要目录路径/);
  });
});
