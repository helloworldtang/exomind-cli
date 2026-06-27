/** 输出: 人类可读(上色)与 --json 双模。picocolors 在非 TTY 自动不上色。 */
import pc from 'picocolors';

let JSON_MODE = false;

export function setJsonMode(v: boolean): void {
  JSON_MODE = v;
}

export function isJsonMode(): boolean {
  return JSON_MODE;
}

/** 进度提示到 stderr(不污染 stdout / JSON 输出)。 */
export function hint(msg: string): void {
  if (!isJsonMode()) process.stderr.write(msg + '\n');
}

/** 双模输出: json 模式打印 JSON,否则走 pretty。返回原始 data 便于测试。 */
export function output<T>(data: T, pretty: () => void): T {
  if (JSON_MODE) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    pretty();
  }
  return data;
}

export const green = pc.green;
export const red = pc.red;
export const yellow = pc.yellow;
export const cyan = pc.cyan;
export const dim = pc.dim;
export const bold = pc.bold;
export const gray = pc.gray;

export function ok(label: string): string {
  return pc.green(`✓ ${label}`);
}

export function fail(label: string): string {
  return pc.red(`✗ ${label}`);
}

/** 截断长文本 */
export function truncate(s: string, n: number): string {
  s = (s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** 键值行: label 用 dim */
export function kv(label: string, value: unknown): string {
  return `${pc.dim(label)} ${String(value)}`;
}

/** 打印标题分隔线 */
export function header(title: string): void {
  console.log(pc.bold(pc.cyan(`\n■ ${title}`)));
}

/** 简单列表项 */
export function bullet(text: string): string {
  return `  ${pc.gray('•')} ${text}`;
}
