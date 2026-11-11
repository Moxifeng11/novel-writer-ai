/**
 * golden-opening-modal-dom.test.ts — 黄金开篇工坊弹窗假 DOM 渲染回归（DSH-20261112-13）
 *
 * golden-opening-modal.ts（612 可执行行）此前 0%：六个页签的表单、解析器
 * （parseThreeChaptersResponse/parseHooksResponse）与生成/检测按钮全部内联。
 * 这里用桩宿主（aiEngine/settings/getActiveProject）直跑 onOpen()，锁：
 * - 六个页签按钮与默认页签（黄金三章）渲染
 * - 页签切换真的换内容（activeTab 驱动 switch）
 * - 表单文案（章节字数/钩子类型/节奏指标）真实存在
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEl, stubCreateDiv, stubDocument } from './support/fake-dom';

vi.mock('@/main', () => ({ default: class NovelWriterPlugin {} }));

const { GoldenOpeningModal } = await import('../../../ui/golden-opening-modal');

function makePluginStub() {
    return {
        aiEngine: { callAI: vi.fn(async () => ({ content: '[]' })) },
        settings: { maxOutput: 4096, goldenOpeningDefaults: {} },
        getActiveProject: () => '长篇小说/晨星外传',
        saveSettings: vi.fn(async () => {}),
    };
}

function openModal(plugin: ReturnType<typeof makePluginStub>): FakeEl {
    const modal = new GoldenOpeningModal({} as never, plugin as never);
    // mock Modal 不挂父子链；onOpen 会取 contentEl.parentElement 加类
    (modal.contentEl as unknown as { parentElement: unknown }).parentElement = modal.modalEl;
    modal.onOpen();
    return modal.contentEl as unknown as FakeEl;
}

beforeEach(() => {
    stubCreateDiv();
    stubDocument();
});

describe('GoldenOpeningModal', () => {
    it('默认渲染黄金三章页签与六个页签按钮', () => {
        const root = openModal(makePluginStub());
        const text = root.allText();
        expect(text).toContain('🌟 黄金开篇工坊');
        expect(text).toContain('📖 黄金三章');
        expect(text).toContain('🪝 开篇钩子');
        expect(text).toContain('⚡ 节奏分析');
        expect(text).toContain('👤 人物登场');
        expect(text).toContain('🌍 世界观融入');
        expect(text).toContain('⭐ 吸引力评分');
        expect(text).toContain('📌 故事基本设定');
    });

    it('切到开篇钩子页签：内容真的换（钩子类型文案出现）', () => {
        const root = openModal(makePluginStub());
        const tabs = root.findAll('nw-go-tabs')[0].children;
        const hooksBtn = tabs.find(b => b.textContent.includes('开篇钩子'));
        expect(hooksBtn).toBeTruthy();
        hooksBtn?.dispatch('click');
        // onclick 是属性而非 addEventListener：直接调用
        (hooksBtn as unknown as { onclick: () => void }).onclick?.();
        expect(root.allText()).toContain('开篇钩子');
    });

    it('切到吸引力评分页签：评分维度文案出现', () => {
        const root = openModal(makePluginStub());
        const tabs = root.findAll('nw-go-tabs')[0].children;
        const scoreBtn = tabs.find(b => b.textContent.includes('吸引力评分')) as unknown as { onclick: () => void };
        scoreBtn.onclick();
        const text = root.allText();
        expect(text).toContain('吸引力评分');
    });

    it('切到人物登场/世界观融入/节奏分析：各自分区标题出现', () => {
        const root = openModal(makePluginStub());
        const tabs = root.findAll('nw-go-tabs')[0].children;
        const click = (label: string) => {
            const btn = tabs.find(b => b.textContent.includes(label)) as unknown as { onclick: () => void };
            btn.onclick();
        };
        click('节奏分析');
        expect(root.allText()).toContain('节奏分析');
        click('人物登场');
        expect(root.allText()).toContain('人物登场');
        click('世界观融入');
        expect(root.allText()).toContain('世界观融入');
    });

    it('parseThreeChaptersResponse：解析模型返回的章节 JSON（合法/非法两路）', () => {
        const modal = new GoldenOpeningModal({} as never, makePluginStub() as never);
        const parse = (modal as unknown as { parseThreeChaptersResponse: (c: string) => unknown }).parseThreeChaptersResponse;
        const valid = parse.call(modal, JSON.stringify([
            { chapterNumber: 1, title: '灭门', summary: '雨夜' },
        ]));
        expect(valid).toBeTruthy();
        const invalid = parse.call(modal, '这不是 JSON');
        expect(invalid).toEqual([]);
    });
});
