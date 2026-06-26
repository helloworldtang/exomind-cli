/** 输入读取: stdin / 文件,跨平台。 */
import * as fs from 'node:fs';

/** 读取全部 stdin 直到 EOF。若无管道输入(交互 TTY)返回空串。 */
export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  let data = '';
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data;
}

/** 强制读取 stdin(用于显式 `-` 占位),阻塞至 EOF。 */
export async function readStdinForced(): Promise<string> {
  let data = '';
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data;
}

export function readFileText(file: string): string {
  return fs.readFileSync(file, 'utf-8');
}
