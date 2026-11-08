/**
 * paths-sanitize.test.ts — F5（技术审计）：路径穿越防护
 *
 * 验证 sanitizeName 与 pj*File / kbBookDir 收口后，
 * `..` 段、绝对路径、非法字符均无法逃出预期目录。
 */
import { describe, it, expect } from 'vitest';
import {
    sanitizeName,
    pjCharFile,
    pjLocFile,
    pjFactionFile,
    pjItemFile,
    pjFanficFile,
    kbBookDir,
    kbBookSourceFile,
} from '../../../shared/paths';


describe('sanitizeName（F5 路径穿越防护）', () => {
    it('`..` 段被剥离去路径语义：`../evil` → `_evil`', () => {
        expect(sanitizeName('../evil')).toBe('_evil');
    });

    it('多级穿越 `../../evil` 不产生可逃逸路径段', () => {
        const result = sanitizeName('../../evil');
        expect(result).toBe('_.._evil');
        expect(result.split('/')).toHaveLength(1); // 无任何路径分隔
    });

    it('纯 `..` / `.` / 空白 净化为占位名，调用方恒拿到可用段', () => {
        expect(sanitizeName('..')).toBe('未命名');
        expect(sanitizeName('.')).toBe('未命名');
        expect(sanitizeName('   ')).toBe('未命名');
        expect(sanitizeName('')).toBe('未命名');
    });

    it('Windows 绝对路径与非法字符被替换', () => {
        expect(sanitizeName('C:\\evil')).toBe('C__evil');
        expect(sanitizeName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
    });

    it('正常中文名与 emoji 不受影响', () => {
        expect(sanitizeName('林晚舟')).toBe('林晚舟');
        expect(sanitizeName(' 长夜未央 ')).toBe('长夜未央');
        expect(sanitizeName('剑来⚔️')).toBe('剑来⚔️');
    });

    it('控制字符被剥离', () => {
        expect(sanitizeName('bad\u0000name\u001f')).toBe('badname');
    });
});

describe('pj*File 系列（F5 收口验证）', () => {
    const traversalName = '../../../etc/passwd';

    it('pjCharFile 不含路径穿越段', () => {
        const path = pjCharFile('proj', traversalName);
        expect(path).not.toMatch(/\.\.\//);
        expect(path.startsWith('proj/')).toBe(true);
    });

    it('pjLocFile / pjFactionFile / pjItemFile / pjFanficFile 同样收口', () => {
        for (const path of [
            pjLocFile('proj', traversalName),
            pjFactionFile('proj', traversalName),
            pjItemFile('proj', traversalName),
            pjFanficFile('proj', traversalName),
        ]) {
            expect(path).not.toMatch(/\.\.\//);
            expect(path.startsWith('proj/')).toBe(true);
        }
    });

    it('正常名称行为不变（回归）', () => {
        expect(pjCharFile('proj', '苏澄')).toBe('proj/01-世界架构/人物/苏澄.md');
    });
});

describe('kbBookDir（F5 补 `..` 过滤）', () => {
    it('书名穿越段被剥离，目录恒在知识库下', () => {
        const dir = kbBookDir('../../evil');
        expect(dir.startsWith('写作知识库/')).toBe(true);
        expect(dir).not.toMatch(/\.\.\//);
    });

    it('正常书名行为不变（回归）', () => {
        expect(kbBookDir('诡秘之主')).toBe('写作知识库/诡秘之主');
        // 原有非法字符替换行为保留
        expect(kbBookDir('a:b')).toBe('写作知识库/a_b');
    });
});

describe('kbBookSourceFile — 源文本文件名净化（v4.79.0 安全审计）', () => {
    it('书名含路径分隔/.. 时不得逃出书目录', () => {
        const path = kbBookSourceFile('../../evil');
        expect(path).not.toContain('../');
        expect(path).toContain('写作知识库/');
        expect(path.endsWith('.txt')).toBe(true);
    });

    it('普通书名的目录与文件名一致', () => {
        const path = kbBookSourceFile('测试书');
        expect(path).toBe('写作知识库/测试书/测试书.txt');
    });

    it('反斜杠/冒号等非法字符被净化', () => {
        const path = kbBookSourceFile('a\\b:c');
        expect(path).not.toContain('\\');
        expect(path).toContain('a_b_c');
    });
});
