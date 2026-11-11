/**
 * view-banners-dom.test.ts — 三段说明条的 DOM 渲染回归（阶段 D2 / DSH-20261112-07）
 *
 * 覆盖三个此前 0 覆盖的 ui/views 渲染器：
 *  - link-status.renderLinkStatus：四种总状态配色、环节图标、断点/已通/未知文案、降级列表截断
 *  - capability-banner.renderCapabilityBanner：阶段文案、指标、说明、主/次动作按钮
 *  - fingerprint-v2-detail.renderV2FeaturesSection：十二维顺序、「样本不足」标记、样本截断
 *
 * 判定逻辑已分别由 shared/link-status-compute、kb-panels-logic、buildV2FeatureRows 单测，
 * 这里只锁「渲染真的把这些判定落成 DOM」。
 */
import { describe, expect, it, vi } from 'vitest';
import { FakeEl } from './support/fake-dom';
import { renderLinkStatus } from '../../../ui/views/link-status';
import { renderCapabilityBanner } from '../../../ui/views/capability-banner';
import { renderV2FeaturesSection, V2_FEATURE_LABELS } from '../../../ui/views/fingerprint-v2-detail';
import type { LinkStatus } from '../../../shared/link-status-compute';
import type { V2Fingerprint, StyleFingerprintFeaturesV2 } from '../../../engine/style/style-dimensions-v2';

function status(overrides: Partial<LinkStatus> = {}): LinkStatus {
    return {
        title: '知识库',
        overall: 'ok',
        stages: [
            { name: '书籍', status: 'ok', detail: '12 本' },
            { name: '拆解', status: 'ok', detail: '9 本' },
        ],
        ...overrides,
    } as LinkStatus;
}

describe('renderLinkStatus', () => {
    it('ok：ready 配色 + 「通」+ 已通文案', () => {
        const root = new FakeEl('div');
        renderLinkStatus(root as unknown as HTMLElement, status());

        const banner = root.findAll('nw-capability-banner')[0];
        expect(banner.className).toContain('nw-is-ready');
        expect(root.allText()).toContain('知识库状态');
        expect(root.allText()).toContain('通');
        expect(root.allText()).toContain('链路已通');
    });

    it('warn / broken / unknown 各用对应配色与文案', () => {
        const cases: Array<[LinkStatus['overall'], string, string]> = [
            ['warn', 'nw-is-accumulating', '弱'],
            ['broken', 'nw-is-degraded', '断'],
            ['unknown', 'nw-is-empty', '未知'],
        ];
        for (const [overall, cls, text] of cases) {
            const root = new FakeEl('div');
            renderLinkStatus(root as unknown as HTMLElement, status({ overall, stages: [], breakpoint: undefined }));
            expect(root.findAll('nw-capability-banner')[0].className).toContain(cls);
            expect(root.allText()).toContain(text);
        }
    });

    it('有断点：阶段位显示「断在『环节』」，并给断点建议', () => {
        const root = new FakeEl('div');
        renderLinkStatus(root as unknown as HTMLElement, status({
            overall: 'broken',
            breakpoint: '向量化',
            stages: [
                { name: '书籍', status: 'ok', detail: '12 本' },
                { name: '向量化', status: 'broken', detail: '未配置模型' },
            ],
        }));

        expect(root.allText()).toContain('断在「向量化」');
        expect(root.allText()).toContain('断点：向量化 —— 未配置模型');
        // 环节行：emoji + 名称·详情 + title
        const metric = root.findAll('nw-capability-metric')[1];
        expect(metric.getAttribute('title')).toBe('向量化：未配置模型');
        expect(metric.children[0].textContent).toBe('❌');
        expect(metric.children[1].textContent).toBe('向量化 · 未配置模型');
    });

    it('unknown：提示「尚未产生可判定数据」；无降级时不出现降级行', () => {
        const root = new FakeEl('div');
        renderLinkStatus(root as unknown as HTMLElement, status({ overall: 'unknown', stages: [] }));

        expect(root.allText()).toContain('尚未产生可判定数据');
        expect(root.allText()).not.toContain('最近降级');
    });

    it('降级：最多列 3 条，超出用省略号', () => {
        const root = new FakeEl('div');
        renderLinkStatus(root as unknown as HTMLElement, status({
            degradations: ['向量检索回退关键词', '嵌入模型 404', '召回为空', '第四条不该出现'],
        }));

        const text = root.allText();
        expect(text).toContain('最近降级 4 次');
        // 拼接只取前 3 条 + 省略号，第四条本身不进入拼接串
        expect(text).toContain('…');
    });
});

describe('renderCapabilityBanner', () => {
    const metrics = [
        { label: '书籍', value: 12 },
        { label: '已拆解', value: '9' },
    ];

    it('阶段文案随 stage 变化，指标 value 转字符串', () => {
        const root = new FakeEl('div');
        renderCapabilityBanner(root as unknown as HTMLElement, {
            title: '知识库能力',
            stage: 'accumulating',
            metrics,
            notes: [],
        });

        expect(root.findAll('nw-capability-banner')[0].className).toContain('nw-is-accumulating');
        expect(root.allText()).toContain('知识库能力');
        expect(root.allText()).toContain('积累中');
        expect(root.allText()).toContain('12');
        expect(root.allText()).toContain('已拆解');
    });

    it('无 notes 不渲染说明区；有 notes 逐条渲染', () => {
        const bare = new FakeEl('div');
        renderCapabilityBanner(bare as unknown as HTMLElement, {
            title: 't', stage: 'empty', metrics: [], notes: [],
        });
        expect(bare.findAll('nw-capability-notes')).toHaveLength(0);

        const withNotes = new FakeEl('div');
        renderCapabilityBanner(withNotes as unknown as HTMLElement, {
            title: 't', stage: 'empty', metrics: [], notes: ['先配置嵌入模型', '再重向量化'],
        });
        const notes = withNotes.findAll('nw-capability-note');
        expect(notes.map(n => n.textContent)).toEqual(['先配置嵌入模型', '再重向量化']);
        expect(notes[0].textContent).toBe('先配置嵌入模型');
    });

    it('动作按钮：primary 用主按钮类，点击回调生效', () => {
        const onClick = vi.fn();
        const root = new FakeEl('div');
        renderCapabilityBanner(root as unknown as HTMLElement, {
            title: 't',
            stage: 'degraded',
            metrics: [],
            notes: [],
            actions: [
                { label: '去配置', onClick, primary: true },
                { label: '稍后', onClick: () => {} },
            ],
        });

        const buttons = root.findAll('nw-capability-actions')[0].children;
        expect(buttons[0].className).toContain('nw-btn-primary');
        expect(buttons[1].className).toContain('nw-btn-secondary');
        buttons[0].dispatch('click');
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});

describe('renderV2FeaturesSection', () => {
    function features(overrides: Partial<StyleFingerprintFeaturesV2> = {}): StyleFingerprintFeaturesV2 {
        const base: Record<string, unknown> = {};
        for (const { key } of V2_FEATURE_LABELS) {
            base[key] = { description: `${key} 描述`, status: 'complete', samples: ['样本一', '样本二', '样本三'] };
        }
        return { ...base, ...overrides } as unknown as StyleFingerprintFeaturesV2;
    }

    it('十二维按固定顺序渲染，样本最多 2 条', () => {
        const root = new FakeEl('div');
        renderV2FeaturesSection(root as unknown as HTMLElement, { features: features() } as unknown as V2Fingerprint);

        const section = root.findAll('nw-fingerprint-v2-section')[0];
        expect(root.allText()).toContain('十二维结构化特征');
        // 12 个维度块
        expect(section.findAll('nw-u-marginbottom-10px-2')).toHaveLength(12);
        expect(root.allText()).toContain('rhythm 描述');
        const sampleBlocks = section.findAll('nw-u-margintop-4px-2');
        expect(sampleBlocks[0].children.map(c => c.textContent)).toEqual(['「样本一」', '「样本二」']);
    });

    it('非 complete 维度标「样本不足」且空描述回落「样本未体现」', () => {
        const root = new FakeEl('div');
        const f = features({
            rhythm: { description: '', status: 'pending', samples: [] },
        } as unknown as Partial<StyleFingerprintFeaturesV2>);
        renderV2FeaturesSection(root as unknown as HTMLElement, { features: f } as unknown as V2Fingerprint);

        const text = root.allText();
        expect(text).toContain('样本不足');
        expect(text).toContain('样本未体现');
        // 只有 rhythm 这一维缺样本 → 只标记一次
        expect(root.findAll('nw-u-c-text-faint-2')).toHaveLength(1);
        // 无样本维度不渲染样本区
        const section = root.findAll('nw-fingerprint-v2-section')[0];
        expect(section.findAll('nw-u-margintop-4px-2').length).toBeLessThan(12);
    });
});
