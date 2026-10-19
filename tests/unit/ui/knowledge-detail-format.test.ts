import { describe, expect, it, vi } from 'vitest';
import { formatDetailNumber, normalizeDetailNumber } from '../../../ui/knowledge-detail-format';
import { openKnowledgeFolder } from '../../../ui/knowledge-folder-navigation';

describe('知识库详情字段格式化', () => {
    it('缺失或非数值字段显示数据缺失', () => {
        expect(formatDetailNumber(undefined, 1, '%')).toBe('数据缺失');
        expect(formatDetailNumber(null, 2)).toBe('数据缺失');
        expect(formatDetailNumber(Number.NaN, 1)).toBe('数据缺失');
        expect(normalizeDetailNumber(undefined)).toBe(0);
    });

    it('有效数值保留指定精度和后缀', () => {
        expect(formatDetailNumber(12.345, 1, '%')).toBe('12.3%');
        expect(normalizeDetailNumber(8)).toBe(8);
    });
});

describe('知识库目录导航', () => {
    it('目录存在时使用公共 Workspace API 打开文件浏览器标签', async () => {
        const setViewState = vi.fn().mockResolvedValue(undefined);
        const getLeaf = vi.fn().mockReturnValue({ setViewState });
        const app = {
            vault: { getAbstractFileByPath: vi.fn().mockReturnValue({ path: '写作知识库' }) },
            workspace: { getLeaf },
        };

        await expect(openKnowledgeFolder(app as never, '写作知识库')).resolves.toBe(true);
        expect(getLeaf).toHaveBeenCalledWith('tab');
        expect(setViewState).toHaveBeenCalledWith({ type: 'file-explorer', active: true });
    });

    it('目录不存在时不创建工作区标签', async () => {
        const getLeaf = vi.fn();
        const app = {
            vault: { getAbstractFileByPath: vi.fn().mockReturnValue(null) },
            workspace: { getLeaf },
        };

        await expect(openKnowledgeFolder(app as never, '缺失目录')).resolves.toBe(false);
        expect(getLeaf).not.toHaveBeenCalled();
    });
});
