import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(ROOT, 'ui/full-writer/project-selector-controller.ts'), 'utf8');

describe('删除项目卡 — 二次确认', () => {
    it('不再要求手动输入项目名', () => {
        expect(source).not.toContain('请输入项目名确认');
        expect(source).not.toContain('项目名不匹配');
        expect(source).not.toContain('input.value.trim() !== projectName');
    });

    it('连续两次确认后才执行删除', () => {
        const calls = source.match(/OperationConfirmModal\.confirm\(/g) || [];
        expect(calls.length).toBeGreaterThanOrEqual(2);
        // i18n 第二期第18片：文案进资源，源码断言改键 + 读 zh 资源确认原文
        expect(source).toContain("t('fullwriter.selector.deleteTitle')");
        expect(source).toContain("t('fullwriter.selector.finalTitle')");
        expect(source).toContain("t('fullwriter.selector.deleteConfirm')");
        expect(source).toContain("t('fullwriter.selector.finalOk')");
        const zh = fs.readFileSync(path.join(ROOT, 'i18n/messages/zh-CN.ts'), 'utf8');
        expect(zh).toContain('⚠️ 删除项目');
        expect(zh).toContain('🚨 最终确认');
        expect(source).toContain('await deleteProject(this.app, projectName)');
    });
});
