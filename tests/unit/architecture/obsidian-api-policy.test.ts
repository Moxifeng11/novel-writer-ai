import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Obsidian API 用法门禁（v4.76.0）的自测：**故意违规必须报错**。
 *
 * 背景：`check:any` / `check:bundle` / `check:inline-styles` 都查不到这类缺陷——
 * 硬编码 `.obsidian/plugins/...`、弃用 API、移动端 fetch、document 级监听、console 直写。
 * 脊梁是「棘轮」：违规数只允许下降，换个文件继续违规也要失败。
 * 这里用临时夹具目录跑真实脚本，钉住：命中、退出码、允许清单与基线棘轮。
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-obsidian-api.mjs');

interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
}

function makeFixture(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-obsidian-api-'));
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(dir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
    }
    return dir;
}

function run(root: string, extra: string[] = []): RunResult {
    const result = spawnSync(process.execPath, [SCRIPT, '--root', root, ...extra], {
        encoding: 'utf8',
        timeout: 20_000,
    });
    return {
        code: result.status ?? -1,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
    };
}

const fixtures: string[] = [];
function fixture(files: Record<string, string>): string {
    const dir = makeFixture(files);
    fixtures.push(dir);
    return dir;
}

afterAll(() => {
    for (const dir of fixtures) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('check:obsidian-api 门禁', () => {
    it('合规代码通过（含注释里提到 API 名的干扰项）', () => {
        const root = fixture({
            'ui/clean.ts': [
                '// 历史实现用 fetch 与 MarkdownRenderer.renderMarkdown，已迁移',
                "import { requestUrl } from 'obsidian';",
                'export async function load(url: string) {',
                '    // 说明：不得硬编码 .obsidian/plugins/novel-writer-ai 路径',
                '    return requestUrl({ url, throw: false });',
                '}',
            ].join('\n'),
        });
        const result = run(root);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('门禁通过');
    });

    it('硬编码插件路径必须报错', () => {
        const root = fixture({
            'services/bad.ts': "export const p = '.obsidian/plugins/novel-writer-ai/data/x.json';\n",
        });
        const result = run(root);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('plugin-path-hardcoded');
    });

    it('弃用 API / 越界 API 必须报错', () => {
        const root = fixture({
            'ui/bad.ts': [
                "import { MarkdownRenderer } from 'obsidian';",
                'export function render(el: HTMLElement) {',
                '    return MarkdownRenderer.renderMarkdown(\'# x\', el, \'\', null);',
                '}',
            ].join('\n'),
        });
        const result = run(root);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('deprecated-api');
    });

    it('非流式 fetch 与 console / document 监听必须报错', () => {
        const root = fixture({
            'services/bad.ts': [
                'export async function go(url: string) {',
                '    console.warn(url);',
                '    document.addEventListener(\'click\', () => {});',
                "    return await fetch(url);",
                '}',
            ].join('\n'),
        });
        const result = run(root);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('direct-fetch');
        expect(result.stderr).toContain('global-document-listener');
        expect(result.stderr).toContain('console-direct');
    });

    it('绕过写法也必须报错（registerDomEvent(document) / 强转 isMobile）', () => {
        const root = fixture({
            'ui/bypass.ts': [
                "import type { App } from 'obsidian';",
                'export function bind(host: { registerDomEvent(el: unknown, type: string, cb: () => void): void }, app: App) {',
                "    host.registerDomEvent(document, 'click', () => {});",
                '    return (app as unknown as { isMobile?: boolean }).isMobile === true;',
                '}',
            ].join('\n'),
        });
        const result = run(root);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('global-document-listener');
        expect(result.stderr).toContain('deprecated-api');
    });

    it('动态 <style> 与字面量内联样式必须报错，动态值不误报', () => {
        const root = fixture({
            'ui/bad.ts': [
                'export function inject(el: HTMLElement) {',
                "    const style = document.createElement('style');",
                "    style.textContent = 'color: red';",
                "    el.style.color = 'red';",
                "    el.style.cssText = 'color: red';",
                "    el.style.setProperty('color', 'red');",
                "    el.setAttribute('style', 'color: red');",
                '}',
            ].join('\n'),
            'ui/good.ts': [
                'export function apply(el: HTMLElement, width: number, offset: number) {',
                "    el.style.width = width + 'px';",
                '    el.style.transform = `translateX(${offset}px)`;',
                "    el.style.setProperty('--nw-x', String(offset));",
                "    el.style.setProperty('--nw-y', offset + 'px');",
                '}',
            ].join('\n'),
        });
        const result = run(root);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('style-element');
        expect(result.stderr).toContain('static-style-assignment');

        // 只统计 bad.ts 的 4 处字面量赋值；good.ts 的动态值不得计入
        const json = run(root, ['--json']);
        const report = JSON.parse(json.stdout);
        expect(report.rules['style-element'].count).toBe(1);
        expect(report.rules['static-style-assignment'].count).toBe(4);
        expect(Object.keys(report.rules['static-style-assignment'].files)).toEqual(['ui/bad.ts']);
    });

    it('utils 目录纳入扫描；同行静态+动态只报静态片段', () => {
        const root = fixture({
            'ui/mixed.ts': [
                'export function mixed(el: HTMLElement, w: number) {',
                "    el.style.color = 'red'; const x = `${w}px`;",
                '    el.style.width = `${w}px`;',
                '}',
            ].join('\n'),
            'utils/bad.ts': [
                'export function inject(el: HTMLElement) {',
                "    el.createEl('style');",
                '}',
            ].join('\n'),
        });
        const result = run(root);
        expect(result.code).toBe(1);
        expect(result.stderr).toContain('style-element');
        expect(result.stderr).toContain('static-style-assignment');

        const report = JSON.parse(run(root, ['--json']).stdout);
        expect(report.rules['style-element'].count).toBe(1);
        // 只报 mixed.ts 的 'red'；动态 width 不报
        expect(report.rules['static-style-assignment'].count).toBe(1);
        expect(report.rules['static-style-assignment'].files).toEqual({ 'ui/mixed.ts': 1 });
        expect(report.rules['style-element'].files).toEqual({ 'utils/bad.ts': 1 });
    });

    it('单源文件（shared/paths.ts）属于合法例外，不被误报', () => {
        const root = fixture({
            'shared/paths.ts': "const DEFAULT_PLUGIN_ROOT_DIR = '.obsidian/plugins/novel-writer-ai';\nexport const d = DEFAULT_PLUGIN_ROOT_DIR;\n",
        });
        const result = run(root);
        expect(result.code).toBe(0);
    });

    it('棘轮：已有 1 处可建基线，再加 1 处必须失败', () => {
        const root = fixture({
            'services/bad.ts': "console.warn('a');\n",
        });
        const baseline = path.join(root, '.obsidian-api-baseline.json');

        const build = run(root, ['--update-baseline', '--note', '测试基线']);
        expect(build.code).toBe(0);
        expect(fs.existsSync(baseline)).toBe(true);

        // 基线内不改 → 仍通过
        expect(run(root).code).toBe(0);

        // 新增一处（换文件也一样）→ 必须失败
        fs.writeFileSync(path.join(root, 'services/other.ts'), "console.error('b');\n", 'utf8');
        const after = run(root);
        expect(after.code).toBe(1);
        expect(after.stderr).toContain('console-direct');
        expect(after.stderr).toContain('新增文件');
    });
});
