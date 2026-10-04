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
  test('pre-release 不参与提醒(不把 rc/beta 推给日常用户)', () => {
    assert.equal(compareVersions('0.19.0', '0.20.0-rc.1'), 0, 'latest 是 rc → 不提醒');
    assert.equal(compareVersions('0.20.0-beta.3', '0.20.0'), 0, 'current 是 pre-release → 不提醒');
    // build metadata 忽略,核心版本照常比较
    assert.ok(compareVersions('0.19.0', '0.20.0+build.7') < 0);
  });
});
