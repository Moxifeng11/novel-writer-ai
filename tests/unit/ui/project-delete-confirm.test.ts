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
        expect(source).toContain("title: '⚠️ 删除项目'");
        expect(source).toContain("title: '🚨 最终确认'");
        expect(source).toContain("confirmText: '继续删除'");
        expect(source).toContain("confirmText: '确认删除'");
        expect(source).toContain('await deleteProject(this.app, projectName)');
    });
});
