import { describe, expect, it } from 'vitest';
import {
    isSafeProjectFolderName,
    sanitizeProjectName,
    suggestProjectName,
    validateProjectName,
} from '../../../shared/project-name';

describe('project-name', () => {
    it('拒绝空名、纯标点、系统目录和保留名', () => {
        expect(validateProjectName('').valid).toBe(false);
        expect(validateProjectName('《》').valid).toBe(false);
        expect(validateProjectName('元文件').valid).toBe(false);
        expect(validateProjectName('CON').valid).toBe(false);
    });

    it('拒绝重复项目名', () => {
        const result = validateProjectName('长夜', ['长夜']);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('已存在');
    });

    it('净化 AI 书名中的标点', () => {
        expect(sanitizeProjectName('《长夜行》！')).toBe('长夜行');
        expect(suggestProjectName('《》')).toBe('');
    });

    it('合法中文/字母/数字/下划线/连字符通过', () => {
        expect(validateProjectName('长夜行-2').valid).toBe(true);
        expect(validateProjectName('Novel_01').valid).toBe(true);
    });
});

describe('isSafeProjectFolderName — rename 目标安全边界（S-8）', () => {
    it('拒绝穿越/分隔符/隐藏目录/盘符/保留名', () => {
        for (const bad of ['../../evil', 'a/b', 'a\\b', '..', '.obsidian', '.git', 'C:\\x', 'con', '元文件', 'bad\u0000name']) {
            expect(isSafeProjectFolderName(bad), bad).toBe(false);
        }
    });

    it('正常项目名（含空格/中文标点）仍可用于改名', () => {
        for (const good of ['长夜行-2', 'Novel_01', '长夜 未央', '《长夜行》', 'a b']) {
            expect(isSafeProjectFolderName(good), good).toBe(true);
        }
    });

    it('超长名称被拒绝（避免路径长度问题）', () => {
        expect(isSafeProjectFolderName('长'.repeat(41))).toBe(false);
    });
});