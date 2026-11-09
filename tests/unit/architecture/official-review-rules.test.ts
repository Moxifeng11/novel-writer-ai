import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * 官方审核规则本地对齐（4.81.0）。
 *
 * 背景：4.80.0 的社区审核 Failed，本地 lint 却全绿——说明门禁与审核规则不是同一套。
 * 这里钉住两层：
 *   1. eslint.config.mjs 真正以 error 启用了审核 Error 规则与 HTML 注入规则；
 *   2. 源码不再出现这几类已清零的写法（防止换一种写法回流）。
 * 真正「规则是否命中」由 CI 的 `npm run lint` 保证；本测试防止配置被悄悄降级。
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCAN_DIRS = ['main.ts', 'ui', 'core', 'engine', 'services', 'shared', 'domains', 'utils'];
const SKIP_DIRS = new Set(['node_modules', 'docs', 'scripts', 'tests', '.git', 'coverage', 'dist', '.zcode', '.trae']);

function collect(dirRel: string): string[] {
    const abs = path.join(REPO_ROOT, dirRel);
    if (!fs.existsSync(abs)) return [];
    const stat = fs.statSync(abs);
    if (stat.isFile()) return abs.endsWith('.ts') && !abs.endsWith('.d.ts') ? [abs] : [];
    const out: string[] = [];
    for (const name of fs.readdirSync(abs)) {
        if (SKIP_DIRS.has(name)) continue;
        out.push(...collect(path.join(dirRel, name)));
    }
    return out;
}

const FILES = SCAN_DIRS.flatMap(collect);
function readAll(): Array<{ rel: string; text: string }> {
    return FILES.map((abs) => ({
        rel: path.relative(REPO_ROOT, abs).split(path.sep).join('/'),
        text: fs.readFileSync(abs, 'utf8'),
    }));
}

describe('eslint.config.mjs 官方审核规则', () => {
    it('类型感知 + 关键规则为 error', async () => {
        const mod = await import(pathToFileURL(path.join(REPO_ROOT, 'eslint.config.mjs')).href);
        const config = mod.default.find((item: { files?: string[] }) => item.files?.includes('**/*.ts'));
        expect(config).toBeTruthy();
        expect(config.languageOptions.parserOptions.projectService).toBe(true);
        for (const rule of [
            'obsidianmd/no-unsupported-api',
            'obsidianmd/no-plugin-as-component',
            'obsidianmd/no-static-styles-assignment',
            'obsidianmd/no-forbidden-elements',
            'no-unsanitized/property',
            'no-unsanitized/method',
        ]) {
            expect(config.rules[rule]).toBe('error');
        }
        expect(config.plugins['no-unsanitized']).toBeTruthy();
        expect(config.plugins['@microsoft/sdl']).toBeTruthy();
    }, 30_000);

    it('manifest.minAppVersion 与 1.4.4 声明一致（no-unsupported-api 的判定基准）', () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'manifest.json'), 'utf8'));
        expect(manifest.minAppVersion).toBe('1.4.4');
    });
});

describe('源码已清零的审核缺陷', () => {
    const sources = readAll();

    it('没有 revealLeaf / ensureSideLeaf / getFileByPath 越界调用', () => {
        for (const { rel, text } of sources) {
            expect(text, rel).not.toMatch(/(?:\.|\b)revealLeaf\s*\(/);
            expect(text, rel).not.toMatch(/(?:\.|\b)ensureSideLeaf\s*\(/);
            expect(text, rel).not.toMatch(/\.getFileByPath\s*\(/);
        }
    });

    it('没有 innerHTML / outerHTML / insertAdjacentHTML 赋值', () => {
        for (const { rel, text } of sources) {
            const code = text
                .split('\n')
                .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
                .join('\n');
            expect(code, rel).not.toMatch(/\.(?:inner|outer)HTML\s*(?:=|\+=)/);
            expect(code, rel).not.toMatch(/insertAdjacentHTML\s*\(/);
        }
    });

    it('MarkdownRenderer.render 不把 plugin 当 Component', () => {
        for (const { rel, text } of sources) {
            const calls = text.match(/MarkdownRenderer\.render\([\s\S]*?\);/g) ?? [];
            for (const call of calls) {
                expect(call, rel).not.toContain('this.plugin');
            }
        }
    });

    it('没有字面量内联样式赋值', () => {
        for (const { rel, text } of sources) {
            expect(text, rel).not.toMatch(/setAttribute\(\s*['"]style['"]\s*,/);
            // 带插值的模板是动态值（如 style.height = `${n}px`），不算静态赋值
            expect(text, rel).not.toMatch(
                /\.style\.[A-Za-z_$][\w$]*\s*=\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|-?\d|true\b|false\b)/,
            );
        }
    });
});
