import { describe, expect, it } from 'vitest';
import { sanitizeProjectName, suggestProjectName, validateProjectName } from '../../../shared/project-name';

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