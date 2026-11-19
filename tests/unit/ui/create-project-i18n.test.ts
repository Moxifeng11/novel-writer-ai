/**
 * create-project-i18n.test.ts — 新建长篇小说项目弹窗双语（缺口⑦ 第二期第35片）
 *
 * 静态守住两件事：
 * 1) 弹窗与创建服务里不再出现写死的界面中文（text / placeholder / title / reason / Notice）；
 * 2) 代码里用到的 createProject.* 与 projectName.* 键在中英资源里都存在。
 *
 * 为什么不做 DOM 渲染断言：onOpen 里带 AI 按钮、设定库下拉与 StorySettingsEditor，
 * 渲染桩成本高且易碎；文案是否真的双语由实机截图验收（见 docs/modules/i18n.md）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasMessage, translate } from '../../../i18n';

const ROOT = resolve(process.cwd());
const MODAL = readFileSync(resolve(ROOT, 'ui/create-project-modal.ts'), 'utf8');
const SERVICE = readFileSync(resolve(ROOT, 'ui/services/project-create-service.ts'), 'utf8');

const CJK = /[\u4e00-\u9fff]/;

/** 去掉注释行后再扫，避免中文注释误报 */
function codeLines(source: string): Array<{ no: number; text: string }> {
    return source.split(/\r?\n/)
        .map((text, i) => ({ no: i + 1, text }))
        .filter(({ text }) => {
            const trimmed = text.trim();
            return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
        });
}

describe('新建项目弹窗双语（第二期第35片）', () => {
    it('弹窗里没有写死的界面中文（text / placeholder / title）', () => {
        const offenders = codeLines(MODAL)
            .filter(({ text }) => /(?:text|placeholder|title):\s*'/.test(text) && CJK.test(text))
            .map(({ no, text }) => no + ': ' + text.trim());
        expect(offenders).toEqual([]);
    });

    it('创建服务的用户可见文案走 t()（reason / warnings / Notice）', () => {
        const offenders = codeLines(SERVICE)
            .filter(({ text }) =>
                /reason:\s*'[^']*[\u4e00-\u9fff]/.test(text)
                || /warnings\.push\('[^']*[\u4e00-\u9fff]/.test(text)
                || /new Notice\(`[^`]*[\u4e00-\u9fff]/.test(text))
            .map(({ no, text }) => no + ': ' + text.trim());
        expect(offenders).toEqual([]);
    });

    it('代码用到的每个键在中英资源里都能解析', () => {
        const used = new Set<string>();
        for (const source of [MODAL, SERVICE]) {
            for (const m of source.matchAll(/\bt\('([^']+)'/g)) used.add(m[1]);
        }
        expect(used.size).toBeGreaterThan(40);
        const missing = [...used].filter(key => !hasMessage(key) || translate('en-US', key) === key);
        expect(missing).toEqual([]);
    });

    it('项目名校验的七条提示都在资源里', () => {
        const keys = ['empty', 'tooShort', 'tooLong', 'invalidChars', 'reservedDir', 'windowsReserved', 'duplicate']
            .map(k => 'projectName.' + k);
        expect(keys.filter(key => !hasMessage(key))).toEqual([]);
        expect(translate('en-US', 'projectName.duplicate', { name: '长夜' })).toContain('长夜');
    });
});
