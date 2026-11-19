/**
 * gen-engine-msg-codes.mjs — 从 i18n 资源生成 engineMsg.* 键的编译期常量
 *
 * 背景（审计 B7 / C 清单 #12）：shared/ui-message.ts 的 code 约定是
 * 'engineMsg.<域>.<slug>' 字符串，生产端手写、资源表另写一份；拼错不会报错，
 * 只会永远显示 fallback 中文（双语能力静默失效），check:i18n 的静态校验也覆盖不到
 * （code 是运行时字符串）。
 *
 * 做法：把 zh-CN 资源里所有 engineMsg.* 键拍平成字面量常量表
 * shared/engine-msg-codes.ts，UiMessage.code 用它的联合类型 —— 拼错即编译错。
 * 资源增删键后跑 npm run gen:engine-msg 重新生成；--check 供 preflight 校验漂移。
 *
 * 资源文件是纯数据（只带 import type），用 TS 编译器降级成 CommonJS 后求值，
 * 与 scripts/check-i18n.mjs 的加载方式一致。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ZH_FILE = join(ROOT, 'i18n', 'messages', 'zh-CN.ts');
const OUT_FILE = join(ROOT, 'shared', 'engine-msg-codes.ts');
const PREFIX = 'engineMsg.';

/** 拍平成「点分键 → 文案」 */
function flatten(tree, prefix = '', out = {}) {
    for (const [key, value] of Object.entries(tree)) {
        const path = prefix ? prefix + '.' + key : key;
        if (typeof value === 'string') out[path] = value;
        else flatten(value, path, out);
    }
    return out;
}

function loadCatalog(file) {
    const source = readFileSync(file, 'utf8');
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
        fileName: file,
    });
    const module = { exports: {} };
    // eslint-disable-next-line no-new-func
    new Function('exports', 'module', outputText)(module.exports, module);
    const tree = Object.values(module.exports).find(value => value && typeof value === 'object');
    if (!tree) throw new Error('资源模块没有导出对象：' + file);
    return tree;
}

const HEADER = [
    '/**',
    ' * engine-msg-codes.ts — engineMsg.* 资源键的编译期常量表（自动生成，勿手改）',
    ' *',
    ' * 生成命令：npm run gen:engine-msg（数据源：i18n/messages/zh-CN.ts 的 engineMsg 子树）',
    ' * 漂移校验：node scripts/gen-engine-msg-codes.mjs --check（preflight 内置）',
    ' *',
    ' * 为什么存在（审计 B7 / C 清单 #12）：UiMessage.code 过去是裸 string，',
    ' * 拼错 resource 键不会报错、只会静默退回 fallback 中文，en 用户永远看到中文。',
    ' * 这里把键集合变成字面量联合类型后，拼错就是编译错。',
    ' */',
    'export const ENGINE_MSG_CODES = [',
].join('\n');

function render(codes) {
    const body = codes.map(code => "    '" + code + "',").join('\n');
    return HEADER + '\n' + body + '\n] as const;\n\n'
        + '/** 合法的 engineMsg.* 资源键 */\n'
        + 'export type EngineMsgCode = typeof ENGINE_MSG_CODES[number];\n';
}

const zh = flatten(loadCatalog(ZH_FILE));
const codes = Object.keys(zh).filter(key => key.startsWith(PREFIX)).sort();
const next = render(codes);

const check = process.argv.includes('--check');
const current = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, 'utf8') : '';
const relOut = relative(ROOT, OUT_FILE).split(sep).join('/');

if (check) {
    if (current !== next) {
        console.error('❌ ' + relOut + ' 与 i18n 资源漂移，请运行：npm run gen:engine-msg');
        process.exit(1);
    }
    console.log('✅ engine-msg-codes 与资源一致（' + codes.length + ' 个键）');
} else {
    writeFileSync(OUT_FILE, next, 'utf8');
    console.log('✅ 已生成 ' + relOut + '（' + codes.length + ' 个键）');
}
