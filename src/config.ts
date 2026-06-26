/** 配置与路径: 读写 ~/.exomind/config.json,向后兼容旧 install 的 key 文件。 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface Config {
  base_url: string;
  api_key: string;
}

export const DEFAULT_BASE_URL = 'https://d.youhuale.cn';

export const CONFIG_DIR = path.join(os.homedir(), '.exomind');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
export const CACHE_DIR = process.env.EXOMIND_CACHE_DIR
  ? path.resolve(process.env.EXOMIND_CACHE_DIR)
  : path.join(CONFIG_DIR, 'cache');
export const CACHE_KEYWORDS = path.join(CACHE_DIR, 'keywords.json');
export const CACHE_ENTITIES_DIR = path.join(CACHE_DIR, 'entities');
export const LEGACY_KEY_FILE = path.join(os.homedir(), '.claude', 'scripts', '.exomind-api-key');

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

export function loadConfig(): Config {
  const cfg = readJson<Partial<Config>>(CONFIG_FILE) ?? {};
  let api_key = cfg.api_key || process.env.EXOMIND_API_KEY || '';
  // 向后兼容: 老 install 写到 ~/.claude/scripts/.exomind-api-key
  if (!api_key) {
    try {
      api_key = fs.readFileSync(LEGACY_KEY_FILE, 'utf-8').trim();
    } catch {
      api_key = '';
    }
  }
  const base_url = cfg.base_url || process.env.EXOMIND_BASE_URL || DEFAULT_BASE_URL;
  return { base_url, api_key };
}

export function saveConfig(cfg: Config): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
  try {
    fs.chmodSync(CONFIG_FILE, 0o600);
  } catch {
    // Windows 无 POSIX 权限,忽略
  }
}

export interface ConfigOverrides {
  baseUrl?: string;
  apiKey?: string;
}

export function resolveConfig(overrides?: ConfigOverrides): Config {
  const base = loadConfig();
  return {
    base_url: overrides?.baseUrl || base.base_url,
    api_key: overrides?.apiKey || base.api_key,
  };
}
