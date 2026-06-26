import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { output, setJsonMode } from '../src/format';

function capture(fn: () => void): string[] {
  const logs: string[] = [];
  const orig = console.log;
  console.log = (s: string) => logs.push(s);
  try {
    fn();
  } finally {
    console.log = orig;
  }
  return logs;
}

describe('format.output', () => {
  test('json 模式输出 JSON', () => {
    setJsonMode(true);
    const logs = capture(() => output({ a: 1, b: 'x' }, () => console.log('pretty')));
    setJsonMode(false);
    assert.equal(logs.length, 1);
    const parsed = JSON.parse(logs[0]);
    assert.equal(parsed.a, 1);
    assert.equal(parsed.b, 'x');
  });

  test('默认模式走 pretty', () => {
    setJsonMode(false);
    let called = false;
    capture(() => output({ a: 1 }, () => { called = true; console.log('rendered'); }));
    assert.ok(called);
  });
});
