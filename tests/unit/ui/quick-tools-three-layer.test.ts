import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 快捷工具三层契约：前端目录（tool-catalog） → 后端注册（command-registry）
 * → UI 执行分支（command-ui-executor）。
 *
 * 只做源码文本对账，不 import core/command-registry：该模块会拉起 main.js，
 * 在 vitest 中解析到构建产物后报 `Cannot find module 'obsidian'`。
 */

const ROOT = path.resolve(__dirname, '../../..');

function read(rel: string): string {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** CommandIds 常量表：KEY -> 命令 id 字面量 */
function extractCommandIdMap(): Map<string, string> {
    const src = read('shared/command-ids.ts');
    const map = new Map<string, string>();
    const re = /^\s*([A-Z][A-Z0-9_]*):\s*'([^']+)'/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) map.set(m[1], m[2]);
    return map;
}

/** tool-catalog 中所有按钮的 commandId */
function extractCatalogIds(): string[] {
    const src = read('ui/full-writer/tool-catalog.ts');
    const ids: string[] = [];
    const re = /commandId:\s*'([^']+)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) ids.push(m[1]);
    return ids;
}

/** command-registry 里交给 UI 执行器的 id（uiCommandIds 数组） */
function extractUiCommandKeys(): string[] {
    const src = read('core/command-registry.ts');
    const start = src.indexOf('const uiCommandIds: string[] = [');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('];', start);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    const keys: string[] = [];
    const re = /CommandIds\.([A-Z][A-Z0-9_]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block))) keys.push(m[1]);
    return keys;
}

/** command-registry 里留在 core 直接执行（r.register(CommandIds.X, ...)） */
function extractCoreRegisteredKeys(): string[] {
    const src = read('core/command-registry.ts');
    const keys: string[] = [];
    const re = /r\.register\(CommandIds\.([A-Z][A-Z0-9_]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) keys.push(m[1]);
    return keys;
}

/** command-ui-executor 的 switch 分支 */
function extractExecutorCaseKeys(): string[] {
    const src = read('ui/command-ui-executor.ts');
    const keys: string[] = [];
    const re = /case CommandIds\.([A-Z][A-Z0-9_]*):/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) keys.push(m[1]);
    return keys;
}

describe('快捷工具三层契约 — 目录 / 注册 / 执行分支', () => {
    const commandIdMap = extractCommandIdMap();
    const catalogIds = extractCatalogIds();
    const uiKeys = extractUiCommandKeys();
    const coreKeys = extractCoreRegisteredKeys();
    const executorKeys = extractExecutorCaseKeys();

    const toValues = (keys: string[]) => keys.map((k) => commandIdMap.get(k) ?? `MISSING:${k}`);

    it('目录中的每个 commandId 都有后端常量定义', () => {
        const known = new Set(commandIdMap.values());
        expect(catalogIds.filter((id) => !known.has(id))).toEqual([]);
    });

    it('目录中的每个 commandId 都有后端注册入口', () => {
        const registered = new Set([...toValues(uiKeys), ...toValues(coreKeys)]);
        expect(catalogIds.filter((id) => !registered.has(id))).toEqual([]);
    });

    it('交给 UI 执行器的命令都有 switch 分支', () => {
        const handled = new Set(executorKeys);
        expect(uiKeys.filter((k) => !handled.has(k))).toEqual([]);
    });

    it('executor 分支引用的常量都真实存在', () => {
        expect(executorKeys.filter((k) => !commandIdMap.has(k))).toEqual([]);
    });

    it('core 直接注册引用的常量都真实存在', () => {
        expect(coreKeys.filter((k) => !commandIdMap.has(k))).toEqual([]);
    });

    it('UI 列表与 core 注册不重复登记同一命令', () => {
        const overlap = uiKeys.filter((k) => coreKeys.includes(k));
        expect(overlap).toEqual([]);
    });

    it('tool-catalog 的每条高频工具都能命中执行分支或 core 注册', () => {
        const handledValues = new Set([
            ...toValues(executorKeys),
            ...toValues(coreKeys),
        ]);
        expect(catalogIds.filter((id) => !handledValues.has(id))).toEqual([]);
    });

    it('「项目与章节」入口走 openFullWriterHome（复用视图时也要有反馈）', () => {
        const src = read('ui/command-ui-executor.ts');
        const start = src.indexOf('case CommandIds.FULL_WRITER:');
        expect(start).toBeGreaterThan(-1);
        const block = src.slice(start, src.indexOf('case CommandIds.CO_WRITING:', start));
        expect(block).toContain('openFullWriterHome');
    });

    it('左侧 ribbon 主入口收敛到创作主页', () => {
        const src = read('main.ts');
        const start = src.indexOf("addRibbonIcon('home'");
        expect(start).toBeGreaterThan(-1);
        const block = src.slice(start, src.indexOf("addRibbonIcon('bot'", start));
        expect(block).toContain('openHomeView');
        expect(block).toContain('openJobCenter');
    });
});
