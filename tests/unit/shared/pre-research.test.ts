import { describe, it, expect } from 'vitest';
import {
    buildPreResearchModeDoc,
    buildPreResearchReport,
    createDefaultPreResearch,
    preResearchDataPath,
    preResearchDir,
    readPreResearchData,
    writePreResearchFiles,
    type ScriptPreResearch,
    type ShortPreResearch,
} from '../../../shared/pre-research';

function memoryAdapter(initial: Record<string, string> = {}) {
    const files = new Map(Object.entries(initial));
    return {
        files,
        async exists(path: string) { return files.has(path); },
        async read(path: string) {
            if (!files.has(path)) throw new Error('not found');
            return files.get(path)!;
        },
        async write(path: string, content: string) { files.set(path, content); },
        async mkdir() { /* no-op */ },
    };
}

describe('前期调研 — 独立结构', () => {
    it('短篇调研写入独立目录，并生成报告与五维分类', async () => {
        const adapter = memoryAdapter();
        const data: ShortPreResearch = {
            ...(createDefaultPreResearch('short', '测试短篇') as ShortPreResearch),
            primaryCategory: '婚姻家庭',
            premise: '全职主妇发现丈夫转移财产，决定反击。',
            coreConflict: '家庭资源与尊严',
            emotionalPromise: '先抑后扬',
            reversals: '以为丈夫爱她→实际在转移财产',
            endingPayoff: '当众拿回财产并离婚',
            plotTags: '家庭关系 / 婆媳矛盾',
            characterCore: '隐忍儿媳 vs 婆婆',
            emotionCurve: '先抑后扬',
            background: '现代 / 家庭住宅',
        };

        await writePreResearchFiles(adapter as never, '测试短篇', data);

        expect(adapter.files.has(`${preResearchDir('测试短篇')}/调研数据.json`)).toBe(true);
        expect(adapter.files.has(`${preResearchDir('测试短篇')}/调研报告.md`)).toBe(true);
        expect(adapter.files.has(`${preResearchDir('测试短篇')}/五维分类.md`)).toBe(true);
        const report = adapter.files.get(`${preResearchDir('测试短篇')}/调研报告.md`)!;
        expect(report).toContain('短篇前期调研报告');
        expect(report).toContain('婚姻家庭');
        expect(report).toContain('先抑后扬');
        expect(report).not.toContain('16 步');
        expect(preResearchDataPath('测试短篇')).toContain('00-前期调研');
    });

    it('剧本调研生成商业钩子、集数与付费卡点', async () => {
        const adapter = memoryAdapter();
        const data: ScriptPreResearch = {
            ...(createDefaultPreResearch('script', '测试剧本') as ScriptPreResearch),
            genre: '都市逆袭',
            targetEpisodes: 60,
            targetWords: 60000,
            logline: '被当众羞辱的外卖员，真实身份是集团继承人。',
            hook3s: '主角被泼酒，反手亮出股权书。',
            coreConflict: '阶层压制与身份反转',
            payoff: '当众打脸、身份曝光',
            paywallEpisode: 12,
            characters: '主角、恶少、女主',
            scenes: '宴会厅、公司、出租屋',
        };

        await writePreResearchFiles(adapter as never, '测试剧本', data);

        expect(adapter.files.has(`${preResearchDir('测试剧本')}/剧本定位.md`)).toBe(true);
        const report = adapter.files.get(`${preResearchDir('测试剧本')}/调研报告.md`)!;
        expect(report).toContain('剧本前期调研报告');
        expect(report).toContain('都市逆袭');
        expect(report).toContain('付费卡点集数');
        expect(report).toContain('12');
    });

    it('调研数据可回读，旧文件缺失时返回 null', async () => {
        const adapter = memoryAdapter();
        const data = {
            ...(createDefaultPreResearch('short', '回读短篇') as ShortPreResearch),
            primaryCategory: '现言甜宠',
            premise: '重回高中，她决定不再错过。',
        };
        await writePreResearchFiles(adapter as never, '回读短篇', data);
        const parsed = await readPreResearchData(adapter as never, '回读短篇');
        expect(parsed?.mode).toBe('short');
        if (parsed?.mode === 'short') {
            expect(parsed.primaryCategory).toBe('现言甜宠');
            expect(parsed.premise).toContain('重回高中');
        }
        expect(await readPreResearchData(adapter as never, '不存在')).toBeNull();
    });

    it('模式文档使用节/集术语，不混入长篇章节流程', () => {
        const shortDoc = buildPreResearchModeDoc(createDefaultPreResearch('short', '短篇'));
        expect(shortDoc).toContain('短篇五维分类');
        expect(shortDoc).toContain('主分类');
        expect(shortDoc).not.toContain('11 步');

        const scriptDoc = buildPreResearchModeDoc(createDefaultPreResearch('script', '剧本'));
        expect(scriptDoc).toContain('剧本定位');
        expect(scriptDoc).toContain('付费卡点');
        expect(scriptDoc).not.toContain('分卷大纲');
    });
});
