import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// 在导入 config 前,把 HOME 指向临时目录,避免污染真实 ~/.exomind
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'exomind-cfg-'));
process.env.HOME = TMP;
process.env.USERPROFILE = TMP;
delete process.env.EXOMIND_API_KEY;
delete process.env.EXOMIND_BASE_URL;

type CfgMod = typeof import('../src/config');
let mod!: CfgMod;

before(async () => {
  mod = await import('../src/config');
});

describe('config', () => {
  test('save → load 往返', () => {
    fs.rmSync(mod.CONFIG_FILE, { force: true });
    mod.saveConfig({ base_url: 'https://example.com', api_key: 'sk_test' });
    const cfg = mod.loadConfig();
    assert.equal(cfg.api_key, 'sk_test');
    assert.equal(cfg.base_url, 'https://example.com');
  });

  test('向后兼容: 读取 legacy ~/.claude/scripts/.exomind-api-key', () => {
    fs.rmSync(mod.CONFIG_FILE, { force: true });
    fs.mkdirSync(path.dirname(mod.LEGACY_KEY_FILE), { recursive: true });
    fs.writeFileSync(mod.LEGACY_KEY_FILE, 'sk_legacy\n');
    const cfg = mod.loadConfig();
    assert.equal(cfg.api_key, 'sk_legacy');
  });

  test('环境变量 EXOMIND_API_KEY 覆盖', () => {
    process.env.EXOMIND_API_KEY = 'sk_env';
    const cfg = mod.resolveConfig();
    assert.equal(cfg.api_key, 'sk_env');
    delete process.env.EXOMIND_API_KEY;
  });

  test('默认 base_url', () => {
    fs.rmSync(mod.CONFIG_FILE, { force: true });
    fs.rmSync(mod.LEGACY_KEY_FILE, { force: true });
    const cfg = mod.loadConfig();
    assert.equal(cfg.base_url, 'https://exomind-api.ai-as.cn');
  });

  test('保存的旧域名 youhuale.cn 自动迁移到默认域名并落盘', () => {
    fs.rmSync(mod.LEGACY_KEY_FILE, { force: true });
    mod.saveConfig({ base_url: 'https://youhuale.cn', api_key: 'sk_old' });
    const cfg = mod.loadConfig();
    assert.equal(cfg.base_url, 'https://exomind-api.ai-as.cn');
    assert.equal(cfg.api_key, 'sk_old'); // api_key 原样保留
    const persisted = JSON.parse(fs.readFileSync(mod.CONFIG_FILE, 'utf-8'));
    assert.equal(persisted.base_url, 'https://exomind-api.ai-as.cn'); // 已改写落盘
  });

  test('保存的旧子域 d.youhuale.cn 同样迁移', () => {
    mod.saveConfig({ base_url: 'https://d.youhuale.cn', api_key: 'sk_old2' });
    const cfg = mod.loadConfig();
    assert.equal(cfg.base_url, 'https://exomind-api.ai-as.cn');
  });

  test('env 显式指定旧域名不被改写落盘', () => {
    fs.rmSync(mod.CONFIG_FILE, { force: true });
    delete process.env.EXOMIND_API_KEY;
    process.env.EXOMIND_BASE_URL = 'https://youhuale.cn';
    const cfg = mod.loadConfig();
    assert.equal(cfg.base_url, 'https://youhuale.cn'); // 尊重用户显式覆盖
    assert.equal(fs.existsSync(mod.CONFIG_FILE), false); // 不落盘
    delete process.env.EXOMIND_BASE_URL;
  });

  test('命令行 override 优先级最高', () => {
    process.env.EXOMIND_API_KEY = 'sk_env';
    const cfg = mod.resolveConfig({ apiKey: 'sk_flag' });
    assert.equal(cfg.api_key, 'sk_flag');
    delete process.env.EXOMIND_API_KEY;
  });
});
