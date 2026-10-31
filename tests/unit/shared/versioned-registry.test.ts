import { describe, expect, it } from 'vitest';
import {
    builtinId,
    detectDrift,
    extractVersion,
    hashContent,
    selectActive,
    type VersionedDoc,
} from '../../../shared/versioned-registry';

function doc(id: string, version: string, content: string, source: VersionedDoc['source'], extra: Partial<VersionedDoc> = {}): VersionedDoc {
    return { id, version, content, hash: hashContent(content), source, ...extra };
}

const NEW_RULES = '自然分段，一个自然段 2–6 句。';
const OLD_RULES = '一句一段，一段一个句号。';

describe('versioned-registry — 内容哈希', () => {
    it('同内容同哈希，不同内容不同哈希（版本号相同也能分辨）', () => {
        expect(hashContent(NEW_RULES)).toBe(hashContent(NEW_RULES));
        expect(hashContent(NEW_RULES)).not.toBe(hashContent(OLD_RULES));
    });

    it('空串与中文稳定', () => {
        expect(hashContent('')).toBe(hashContent(''));
        expect(hashContent('写作规则')).toMatch(/^[0-9a-f]{8}$/);
    });

    it('extractVersion 取第一个 semver，容忍前缀与后缀', () => {
        expect(extractVersion('version: "3.6.0-引导代禁止"')).toBe('3.6.0-引导代禁止');
        expect(extractVersion('v3.6.0 同步源')).toBe('3.6.0');
        expect(extractVersion('没有版本')).toBe('');
    });
});

describe('versioned-registry — 多版本只生效一个', () => {
    const builtinNew = doc(builtinId('3.6.0'), '3.6.0', NEW_RULES, 'builtin');
    const builtinOld = doc(builtinId('3.6.0-legacy'), '3.6.0-legacy', OLD_RULES, 'builtin');
    const vaultOld = doc('vault:写作规则@3.6.0', '3.6.0', OLD_RULES, 'vault', { path: '元文件/00-系统模板/写作规则.md' });

    it('精确 id 命中优先', () => {
        const result = selectActive([builtinNew, builtinOld, vaultOld], { activeId: builtinOld.id });
        expect(result.doc?.id).toBe(builtinOld.id);
        expect(result.fellBack).toBe(false);
    });

    it('只写版本号时按来源优先级挑选（vault > builtin）', () => {
        const result = selectActive([builtinNew, vaultOld], { activeId: '3.6.0' });
        expect(result.doc?.source).toBe('vault');
    });

    it('指定版本不存在时回退并告警', () => {
        const result = selectActive([builtinNew], { activeId: '9.9.9' });
        expect(result.doc?.id).toBe(builtinNew.id);
        expect(result.fellBack).toBe(true);
        expect(result.warnings.join()).toContain('9.9.9');
    });

    it('不指定时按 project > vault > builtin 回退', () => {
        const project = doc('project:写作规则@3.6.0', '3.6.0', OLD_RULES, 'project');
        expect(selectActive([builtinNew, vaultOld, project]).doc?.source).toBe('project');
        expect(selectActive([builtinNew, vaultOld]).doc?.source).toBe('vault');
    });

    it('applicableModes 过滤：剧本模式跳过只适用长篇的版本', () => {
        const longOnly = doc(builtinId('3.6.0'), '3.6.0', NEW_RULES, 'builtin', { applicableModes: ['long'] });
        const generic = doc(builtinId('3.6.0-short'), '3.6.0-short', NEW_RULES, 'builtin');
        const result = selectActive([longOnly, generic], { mode: 'script' });
        expect(result.doc?.id).toBe(generic.id);
    });

    it('没有任何可用版本时返回 null + 告警', () => {
        const result = selectActive([]);
        expect(result.doc).toBeNull();
        expect(result.warnings.length).toBeGreaterThan(0);
    });
});

describe('versioned-registry — 漂移检测（本次事故的形态）', () => {
    const expected = doc(builtinId('3.6.0'), '3.6.0', NEW_RULES, 'builtin');
    const sameVersionOldContent = doc('vault:写作规则', '3.6.0', OLD_RULES, 'vault', { path: '元文件/00-系统模板/写作规则.md' });

    it('版本号相同但内容不同 → 报警（旧实现会静默通过）', () => {
        const warnings = detectDrift(expected, sameVersionOldContent);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('版本号相同但内容不同');
        expect(warnings[0]).toContain('元文件/00-系统模板/写作规则.md');
    });

    it('版本号与哈希都一致 → 无告警', () => {
        expect(detectDrift(expected, { ...expected, source: 'vault' })).toEqual([]);
    });

    it('版本号不同 → 报版本不一致', () => {
        const other = doc('x', '2.0.0', NEW_RULES, 'vault');
        expect(detectDrift(expected, other)[0]).toContain('版本号不一致');
    });

    it('任一侧缺失不报错', () => {
        expect(detectDrift(null, expected)).toEqual([]);
        expect(detectDrift(expected, null)).toEqual([]);
    });
});
