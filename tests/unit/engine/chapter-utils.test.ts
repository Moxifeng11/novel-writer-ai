import { describe, it, expect } from 'vitest';
import {
    getChapterFileName,
    isStandardChapterFileName,
    sanitizeFileSegment,
    CHAPTER_FILE_TYPES,
    BODY_FILE_TYPES,
    STEP_FILE_TYPES,
    isBodyType,
    isStepType,
    getStepFileName,
} from '../../../engine/chapter-utils';

describe('getChapterFileName', () => {
    it('生成标准章节文件名', () => {
        expect(getChapterFileName('第1章', '正文')).toBe('第1章_正文.md');
        expect(getChapterFileName('第10章', '大纲摘要')).toBe('第10章_大纲摘要.md');
    });
});

describe('isStandardChapterFileName', () => {
    it('精确匹配标准格式', () => {
        expect(isStandardChapterFileName('第1章_正文.md', '第1章', '正文')).toBe(true);
        expect(isStandardChapterFileName('第5章_大纲摘要.md', '第5章', '大纲摘要')).toBe(true);
    });

    it('带标题的格式也匹配', () => {
        expect(isStandardChapterFileName('第1章_棋手落子_正文.md', '第1章', '正文')).toBe(true);
        expect(isStandardChapterFileName('第3章_神秘来客_信息规划.md', '第3章', '信息规划')).toBe(true);
    });

    it('不匹配错误格式', () => {
        expect(isStandardChapterFileName('第1章正文.md', '第1章', '正文')).toBe(false);
        expect(isStandardChapterFileName('_正文.md', '第1章', '正文')).toBe(false);
        expect(isStandardChapterFileName('第1章_正文.txt', '第1章', '正文')).toBe(false);
    });

    it('章名含正则元字符时按字面量匹配', () => {
        // 未转义时 `(` 会被当作分组，导致误判
        expect(isStandardChapterFileName('第1章(修)_正文.md', '第1章(修)', '正文')).toBe(true);
        expect(isStandardChapterFileName('第1章a_正文.md', '第1章(修)', '正文')).toBe(false);
    });
});

describe('sanitizeFileSegment', () => {
    it('替换文件系统非法字符与路径分隔符', () => {
        expect(sanitizeFileSegment('棋手/落子')).toBe('棋手 落子');
        expect(sanitizeFileSegment('A:B*C?D"E<F>G|H\\I')).toBe('A B C D E F G H I');
    });

    it('路径穿越标题不保留任何分隔符（AI 标题进文件名的前置校验）', () => {
        expect(sanitizeFileSegment('../evil')).not.toContain('/');
        expect(sanitizeFileSegment('..\\evil')).not.toContain('\\');
        expect(sanitizeFileSegment('..')).not.toContain('/');
    });

    it('压缩空白并去首尾空格', () => {
        expect(sanitizeFileSegment('  棋手   落子  ')).toBe('棋手 落子');
    });

    it('空输入返回空串', () => {
        expect(sanitizeFileSegment('')).toBe('');
        expect(sanitizeFileSegment(undefined as unknown as string)).toBe('');
    });
});

describe('CHAPTER_FILE_TYPES', () => {
    it('包含所有必要的类型', () => {
        expect(CHAPTER_FILE_TYPES.body).toBe('正文');
        expect(CHAPTER_FILE_TYPES.outline).toBe('大纲摘要');
        expect(CHAPTER_FILE_TYPES.infoPlan).toBe('信息规划');
        expect(CHAPTER_FILE_TYPES.analysisReport).toBe('分析报告');
        expect(CHAPTER_FILE_TYPES.settlement).toBe('结算表');
    });

    it('值数量 ≥ 14', () => {
        expect(Object.keys(CHAPTER_FILE_TYPES).length).toBeGreaterThanOrEqual(14);
    });
});

describe('BODY_FILE_TYPES', () => {
    it('包含 body', () => {
        expect(BODY_FILE_TYPES).toContain('body');
    });
});

describe('STEP_FILE_TYPES', () => {
    it('包含步骤相关类型', () => {
        expect(STEP_FILE_TYPES).toBeDefined();
        expect(typeof STEP_FILE_TYPES).toBe('object');
    });
});

describe('isBodyType', () => {
    it('识别正文类型', () => {
        expect(isBodyType('body')).toBe(true);
    });

    it('非正文类型返回 false', () => {
        expect(isBodyType('outline')).toBe(false);
        expect(isBodyType('infoPlan')).toBe(false);
    });
});

describe('isStepType', () => {
    it('识别步骤类型（按中文名）', () => {
        expect(isStepType('信息规划')).toBe(true);
        expect(isStepType('大纲摘要')).toBe(true);
        expect(isStepType('分析报告')).toBe(true);
    });

    it('非步骤类型返回 false', () => {
        expect(isStepType('body')).toBe(false);
        expect(isStepType('unknown')).toBe(false);
        expect(isStepType('正文')).toBe(false);
    });
});

describe('getStepFileName', () => {
    it('返回步骤文件名（匹配元文件命名：第X章_类型.md）', () => {
        expect(getStepFileName('第1章', '信息规划')).toBe('第1章_信息规划.md');
        expect(getStepFileName('第10章', '大纲摘要')).toBe('第10章_大纲摘要.md');
    });
});
