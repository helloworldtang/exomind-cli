#!/usr/bin/env node
// 发布前置自检 —— 把「发了才发现」的问题挡在上传之前。
//
// 与 leitu-framework 的 tools/cli/preflight.mjs 同源（同一份判据，改一处两边同步）。
// 必须**在构建之后**运行：bin 指向的是构建产物（dist/），没 build 过会被拦下。
//
// 四类问题，每类都对应一次真实翻车：
//   1. tag 与 package.json 版本不一致 → 发错版本，或 403（该版本已存在）
//   2. bin 值带 './' 前缀 / 指向不存在的文件 → npm 判 invalid 并**静默剥掉 bin**，
//      用户装了没有命令（`npm pack --dry-run` 看不出来，它只列文件不校验 manifest）
//   3. files 白名单漏了入口 → 包能发，装上跑不了
//   4. 该版本已在 registry → npm 403 "cannot publish over previously published versions"
//
// 用法：
//   node preflight.mjs                           # 本地 / CI 通用
//   node preflight.mjs --skip-registry           # 不联网
//   node preflight.mjs --allow-published         # dry run：已发布降级为提示
//   node preflight.mjs --tag-prefix=cli-v        # tag 前缀（默认 'v'）；同一仓库有多种发布产物时用
//                                                #   独立前缀区分，例如 leitu 的 npm CLI 走 'cli-v'
//                                                #   （该仓库的 'v*' 已被 Maven 发布占用）
//
// 环境变量 GITHUB_REF_NAME / GITHUB_EVENT_NAME 由 CI 提供；本地不设则跳过 tag 断言。

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// 包根 = 从脚本所在目录向上找到的第一个含 package.json 的目录。
// 本脚本可能躺在包根（tools/cli/preflight.mjs）也可能在子目录（scripts/preflight.mjs），
// 写死 `HERE/..` 会让其中一种情况读错 package.json。
const ROOT = (() => {
  let dir = HERE;
  for (let i = 0; i < 5; i += 1) {
    if (existsSync(resolve(dir, 'package.json'))) return dir;
    dir = resolve(dir, '..');
  }
  throw new Error(`从 ${HERE} 向上找不到 package.json`);
})();
const args = process.argv.slice(2);
const arg = (name, fallback) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
const skipRegistry = args.includes('--skip-registry');
const allowPublished = args.includes('--allow-published');
const tagPrefix = arg('--tag-prefix', 'v');
const ref = process.env.GITHUB_REF_NAME ?? '';
const eventName = process.env.GITHUB_EVENT_NAME ?? '';

const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const problems = [];
const notes = [];
const strip = (p) => String(p).replace(/^\.\//, '');

// 1. tag ↔ package.json 版本
if (ref.startsWith(tagPrefix)) {
  const implied = ref.slice(tagPrefix.length);
  if (implied !== pkg.version) {
    problems.push(`tag ${ref} 隐含版本 ${implied}，但 package.json 是 ${pkg.version}——先改 package.json 再打 tag`);
  } else {
    notes.push(`tag 与 package.json 版本一致：${pkg.version}`);
  }
} else if (eventName === 'push') {
  problems.push(`push 事件触发但 ref='${ref}' 不以 '${tagPrefix}' 开头——workflow 的 tag 过滤器和这里的前缀对不上`);
} else {
  notes.push(`ref='${ref || '-'}' 不是 ${tagPrefix}* tag——跳过版本一致性断言（dispatch / 本地运行属正常）`);
}

// 2. bin 字段有效性
// 多个命令名可以指向同一文件（exomind / emcli → dist/cli.js），
// 故「目标级」检查先去重，否则同一个问题会被逐名报一遍。
const binEntries = Object.entries(pkg.bin ?? {});
const targets = new Map(); // 目标路径 -> [命令名]
for (const [name, target] of binEntries) {
  const clean = strip(target);
  targets.set(clean, [...(targets.get(clean) ?? []), name]);
}

if (binEntries.length === 0) {
  problems.push('package.json 缺 bin 字段——装上不会有任何命令');
} else {
  notes.push(`包名 ${pkg.name}，命令名 ${[...targets.values()].flat().join(', ')}（两者可以不同）`);
  for (const [name, target] of binEntries) {
    if (typeof target !== 'string' || !target) {
      problems.push(`bin.${name} 不是有效路径`);
    } else if (target.startsWith('./')) {
      problems.push(`bin.${name}='${target}' 带 './' 前缀——npm 会判 invalid 并静默剥掉 bin`);
    }
  }
  for (const [clean, names] of targets) {
    if (!clean) continue;
    const abs = resolve(ROOT, clean);
    if (!existsSync(abs)) {
      const hint = clean.startsWith('dist/') ? '（要先 npm run build）' : '';
      problems.push(`入口 ${clean}（bin: ${names.join(', ')}）文件不存在${hint}`);
    } else if (!readFileSync(abs, 'utf8').startsWith('#!')) {
      notes.push(`入口 ${clean} 无 shebang——仍能跑（npm 用 node 调），但不保险`);
    }
  }
}

// 3. files 白名单（支持目录级条目，如 "dist"）
const files = pkg.files ?? [];
if (files.length === 0) {
  problems.push('package.json 缺 files 白名单——会把仓库垃圾一起发出去');
}
const covered = (p) =>
  files.some((f) => {
    const base = String(f).replace(/\/$/, '');
    return p === base || p.startsWith(`${base}/`);
  });
for (const clean of targets.keys()) {
  if (clean && !covered(clean)) problems.push(`files 未覆盖入口 ${clean}——装上没有命令`);
}

// 4. tarball 实际内容（走 npm 自己的打包逻辑，不是我们猜的）
try {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(out);
  const entry = (Array.isArray(parsed) ? parsed : [parsed])[0];
  const packed = new Set((entry.files ?? []).map((f) => f.path));
  for (const clean of targets.keys()) {
    if (clean && !packed.has(clean)) problems.push(`tarball 里没有 ${clean}——入口被 files 白名单挡掉了`);
  }
  notes.push(`tarball：${packed.size} 个文件 / ${(entry.size / 1024).toFixed(1)} kB`);
} catch (e) {
  problems.push(`npm pack --dry-run 失败：${String(e.message).split('\n')[0]}`);
}

// 5. registry 版本占用
if (skipRegistry) {
  notes.push('--skip-registry：未查 registry');
} else {
  const url = `https://registry.npmjs.org/${pkg.name}/${pkg.version}`;
  try {
    const res = await fetch(url);
    if (res.status === 200) {
      const line = `${pkg.name}@${pkg.version} 已存在于 registry——npm 会 403，先升版本号`;
      if (allowPublished) notes.push(`${line}（--allow-published：降级为提示）`);
      else problems.push(line);
    } else if (res.status === 404) {
      notes.push(`${pkg.name}@${pkg.version} 未被占用 ✅`);
    } else {
      notes.push(`registry 查询返回 ${res.status}——跳过占用检查`);
    }
  } catch (e) {
    notes.push(`registry 查询失败（${String(e.message)}）——跳过占用检查`);
  }
}

console.log(`发布前置自检：${pkg.name}@${pkg.version}（ref='${ref || '-'}'）`);
for (const n of notes) console.log(`  · ${n}`);
if (problems.length) {
  console.error('\n自检未通过：');
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log('\n自检通过 ✅');
