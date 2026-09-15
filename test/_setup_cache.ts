/** 测试进程隔离缓存目录。
 *  必须放在使用它的测试文件的**首个 import 位置**——ESM 按声明顺序求值依赖,
 *  先于 config.ts 模块求值设置 EXOMIND_CACHE_DIR,才能把 CACHE_* 指到临时目录,
 *  否则 ingestWithRetry 等路径的缓存失效会误删用户真实 ~/.exomind/cache。 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const dir =
  process.env.EXOMIND_CACHE_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), 'exo-test-cache-'));
process.env.EXOMIND_CACHE_DIR = dir;
fs.mkdirSync(dir, { recursive: true });
