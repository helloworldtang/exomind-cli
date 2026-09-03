import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions } from '../src/update-check';

describe('update-check: compareVersions', () => {
  test('数值比较,0.9.0 < 0.10.0(字符串比较会错)', () => {
    assert.ok(compareVersions('0.9.0', '0.10.0') < 0);
    assert.ok(compareVersions('0.10.0', '0.9.0') > 0);
  });
  test('跨数量级与相等', () => {
    assert.ok(compareVersions('1.0.0', '0.9.9') > 0);
    assert.ok(compareVersions('2.1.3', '2.1.3') === 0);
    assert.ok(compareVersions('v0.9.0', '0.10.0') < 0); // 前缀 v 容忍
  });
  test('非语义化输入返回 0(不提醒)', () => {
    assert.equal(compareVersions('latest', '0.10.0'), 0);
    assert.equal(compareVersions('0.10', '0.10.0'), 0);
  });
});
