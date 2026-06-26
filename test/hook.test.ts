import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesExperience, matchesResearch, matchEntities, isSecretWord, hasTechTerm } from '../src/hook';

describe('hook: isSecretWord', () => {
  test('匹配存档/jdit 及尾部标点', () => {
    assert.equal(isSecretWord('存档'), true);
    assert.equal(isSecretWord('jdit'), true);
    assert.equal(isSecretWord('JDIT'), true);
    assert.equal(isSecretWord('存档!'), true);
    assert.equal(isSecretWord(' 存档 '), true);
  });
  test('非暗号', () => {
    assert.equal(isSecretWord('继续'), false);
    assert.equal(isSecretWord('存档一下'), false);
    assert.equal(isSecretWord('请把这段存档起来'), false);
  });
});

describe('hook: matchesExperience', () => {
  test('踩坑+根因+性能数据 触发', () => {
    const msg = '这轮关键经验:踩坑了。根因分析发现是连接池配置问题,性能数据从100ms优化到30ms,是最佳实践。';
    assert.equal(matchesExperience(msg), true);
  });
  test('过短不触发', () => {
    assert.equal(matchesExperience('踩坑'), false);
  });
  test('英文 best practice 触发', () => {
    assert.equal(matchesExperience('This is a best practice we discovered this session for sure yes.'), true);
  });
});

describe('hook: matchesResearch', () => {
  test('四阶段结构化调研 触发', () => {
    const msg = [
      '调研业界在连接池预热方面的最佳实践,这是一次完整的对比分析。',
      '问题:当前服务冷启动时存在响应延迟断链,首请求超时率明显升高,gap 在于此。',
      '分析:根因分析显示,由于连接池未预热且初始化串行,导致首批请求排队等待。',
      '关键模式:核心在于连接池预热 + 并行初始化,本质是用空间换时间的取舍。',
      '方案:落地实施预热钩子,改进方向是异步预热,解决方案已验证,优化空间明确。',
    ].join('\n');
    assert.ok(msg.length >= 100);
    assert.equal(matchesResearch(msg), true);
  });
  test('过短不触发', () => {
    assert.equal(matchesResearch('调研'), false);
  });
});

describe('hook: matchEntities', () => {
  test('子串匹配 + 排除未命中', () => {
    const hits = matchEntities('Redis 与 Memcached 的对比', ['Redis', 'Memcached', 'Kafka']);
    assert.ok(hits.includes('Redis'));
    assert.ok(hits.includes('Memcached'));
    assert.ok(!hits.includes('Kafka'));
  });
  test('较长名称优先', () => {
    const hits = matchEntities('Spring Data Redis 很好用', ['Redis', 'Spring Data Redis']);
    assert.equal(hits[0], 'Spring Data Redis');
  });
  test('短于 2 字符的候选忽略', () => {
    const hits = matchEntities('a 出现了', ['a', 'Redis']);
    assert.deepEqual(hits, []);
  });
});

describe('hook: hasTechTerm', () => {
  test('代码/路径/驼峰', () => {
    assert.equal(hasTechTerm('用了 `useState`'), true);
    assert.equal(hasTechTerm('文件 config.yaml'), true);
    assert.equal(hasTechTerm('myComponent'), true);
  });
});
