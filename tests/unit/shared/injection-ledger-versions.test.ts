import { describe, expect, it } from 'vitest';
import {
    buildInjectionLedger,
    formatInjectionLedger,
    type InjectionLedger,
} from '../../../shared/injection-ledger';

function build(vars: Record<string, string>, segments: any[] = [{ key: 'writingRules', label: '写作规则', source: '测试', influence: '决定' }]): InjectionLedger {
    return buildInjectionLedger(vars, { segments });
}

describe('injection-ledger — 版本归因字段（v4.23）', () => {
    const rulesMeta = JSON.stringify({
        id: 'builtin:3.6.0',
        version: '3.6.0',
        hash: 'a1b2c3d4',
        path: '元文件/00-系统模板/写作规则.md',
        warnings: ['版本号相同但内容不同'],
    });
    const voiceMeta = JSON.stringify({ id: 'voice.exemplar', version: '5.0.0' });

    it('从 _rulesMeta/_voiceMeta/_experimentGroup 读出规则、人味与实验组', () => {
        const ledger = build({
            writingRules: '规则正文',
            _rulesMeta: rulesMeta,
            _voiceMeta: voiceMeta,
            _experimentGroup: 'R1-G2',
        });
        expect(ledger.versions).toMatchObject({
            rulesId: 'builtin:3.6.0',
            rulesVersion: '3.6.0',
            rulesHash: 'a1b2c3d4',
            rulesPath: '元文件/00-系统模板/写作规则.md',
            voiceId: 'voice.exemplar',
            voiceVersion: '5.0.0',
            experimentGroup: 'R1-G2',
        });
        expect(ledger.versions?.warnings).toEqual(['版本号相同但内容不同']);
    });

    it('没有任何版本元数据时 versions 为 undefined（旧账本格式不变）', () => {
        const ledger = build({ writingRules: '规则正文' });
        expect(ledger.versions).toBeUndefined();
    });

    it('_rulesMeta 是坏 JSON 时静默忽略，不影响分段统计', () => {
        const ledger = build({ writingRules: '规则正文', _rulesMeta: '{not-json' });
        expect(ledger.versions).toBeUndefined();
        expect(ledger.entries).toHaveLength(1);
        expect(ledger.entries[0].chars).toBe(4);
    });

    it('空字符串分组不写入（避免账本里出现空实验组）', () => {
        const ledger = build({ writingRules: '规则正文', _experimentGroup: '   ' });
        expect(ledger.versions?.experimentGroup).toBeUndefined();
    });

    it('formatInjectionLedger 输出【版本】行与告警行', () => {
        const ledger = build({
            writingRules: '规则正文',
            _rulesMeta: rulesMeta,
            _voiceMeta: voiceMeta,
            _experimentGroup: 'R1-G2',
        });
        const text = formatInjectionLedger(ledger);
        expect(text).toContain('【版本】规则 builtin:3.6.0#a1b2c3d4 · 人味 voice.exemplar · 实验组 R1-G2');
        expect(text).toContain('⚠ 版本号相同但内容不同');
    });

    it('无版本时不输出【版本】行', () => {
        expect(formatInjectionLedger(build({ writingRules: '规则正文' }))).not.toContain('【版本】');
    });

    describe('上下文体检（v4.24）', () => {
        const hygiene = JSON.stringify({
            issues: [
                { type: 'duplicate', severity: 'high', blocks: ['worldView', 'settingLib'], message: '世界观与设定库内容重复 98%，保留前者' },
                { type: 'staleChapter', severity: 'high', blocks: ['infoPlan'], message: '「信息规划」引用的章节是第3章，与当前第4章不符' },
            ],
            dropped: ['settingLib'],
        });

        it('解析 _contextHygiene 并在账本行里显示重复与串章', () => {
            const ledger = build({ writingRules: '规则正文', _contextHygiene: hygiene });
            expect(ledger.hygiene?.issues).toHaveLength(2);
            expect(ledger.hygiene?.dropped).toEqual(['settingLib']);
            const text = formatInjectionLedger(ledger);
            expect(text).toContain('【上下文体检】1 处重复（已清空 settingLib） / 1 处疑似串章');
            expect(text).toContain('与当前第4章不符');
        });

        it('坏 JSON / 空 issues 不产生体检行', () => {
            expect(build({ writingRules: '规则正文', _contextHygiene: '{bad' }).hygiene).toBeUndefined();
            expect(build({ writingRules: '规则正文', _contextHygiene: '{"issues":[]}' }).hygiene).toBeUndefined();
        });
    });
});
