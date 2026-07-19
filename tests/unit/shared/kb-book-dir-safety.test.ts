import { describe, it, expect } from 'vitest';
import {
    kbBookDir,
    kbBookBasicInfoFile,
    kbBookStyleFingerprintFile,
} from '../../../shared/paths';

describe('kbBookDir 路径安全过滤', () => {
    it('正常书名不受影响', () => {
        expect(kbBookDir('我的小说')).toBe('写作知识库/我的小说');
    });

    it('过滤斜杠 /', () => {
        const result = kbBookDir('书/名/含/斜杠');
        expect(result).toBe('写作知识库/书_名_含_斜杠');
        expect(result).not.toContain('/我的小说');
    });

    it('过滤反斜杠 \\', () => {
        const result = kbBookDir('书\\名\\含\\反斜杠');
        expect(result).toBe('写作知识库/书_名_含_反斜杠');
        expect(result).not.toContain('\\');
    });

    it('过滤冒号 :', () => {
        const result = kbBookDir('书名:含冒号');
        expect(result).toBe('写作知识库/书名_含冒号');
        expect(result).not.toContain(':');
    });

    it('过滤星号 *', () => {
        const result = kbBookDir('书名*含星号');
        expect(result).toBe('写作知识库/书名_含星号');
        expect(result).not.toContain('*');
    });

    it('过滤问号 ?', () => {
        const result = kbBookDir('书名?含问号');
        expect(result).toBe('写作知识库/书名_含问号');
        expect(result).not.toContain('?');
    });

    it('过滤双引号 "', () => {
        const result = kbBookDir('书名"含引号');
        expect(result).toBe('写作知识库/书名_含引号');
        expect(result).not.toContain('"');
    });

    it('过滤小于号 <', () => {
        const result = kbBookDir('书名<含小于');
        expect(result).toBe('写作知识库/书名_含小于');
        expect(result).not.toContain('<');
    });

    it('过滤大于号 >', () => {
        const result = kbBookDir('书名>含大于');
        expect(result).toBe('写作知识库/书名_含大于');
        expect(result).not.toContain('>');
    });

    it('过滤竖线 |', () => {
        const result = kbBookDir('书名|含竖线');
        expect(result).toBe('写作知识库/书名_含竖线');
        expect(result).not.toContain('|');
    });

    it('混合特殊字符全部过滤', () => {
        const result = kbBookDir('混/合:特*殊?字"符<测>试|');
        expect(result).toBe('写作知识库/混_合_特_殊_字_符_测_试_');
    });

    it('自定义 baseDir 也生效', () => {
        const result = kbBookDir('书/名', '我的知识库');
        expect(result).toBe('我的知识库/书_名');
    });
});

describe('依赖 kbBookDir 的函数也受保护', () => {
    it('kbBookBasicInfoFile 路径安全', () => {
        const result = kbBookBasicInfoFile('测/试:书*名');
        expect(result).toContain('测_试_书_名');
        expect(result).toContain('基本信息.md');
    });

    it('kbBookStyleFingerprintFile 路径安全', () => {
        const result = kbBookStyleFingerprintFile('测/试:书*名');
        expect(result).toContain('测_试_书_名');
        expect(result).toContain('风格指纹.json');
    });
});
