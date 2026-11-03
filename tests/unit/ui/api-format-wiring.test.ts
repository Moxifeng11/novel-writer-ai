import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');

function read(rel: string): string {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('设置页 API 格式与模型获取的接线', () => {
    it('设置页是「左列表 + 右详情」两栏布局', () => {
        const source = read('ui/settings/api-section.ts');
        expect(source).toContain("cls: 'nw-api-layout'");
        expect(source).toContain("cls: 'nw-api-sidebar'");
        expect(source).toContain("cls: 'nw-api-detail'");
        // 供应商列表按预设/自定义分组
        expect(source).toContain("title: '预设供应商'");
        expect(source).toContain("title: '自定义供应商'");
    });

    it('详情区提供 Base URL、API 格式与密钥输入', () => {
        const source = read('ui/settings/api-section.ts');
        expect(source).toContain("renderField(container, 'Base URL'");
        expect(source).toContain("renderField(container, 'API 格式'");
        expect(source).toContain("renderField(container, 'API Key'");
        // 输入框必须用占满宽度的类，而不是旧版 Setting 内联的窄 input
        expect(source).toContain("cls: 'nw-api-text-input'");
        expect(source).toContain("cls: 'nw-api-select'");
    });

    it('模型列表支持从 URL 拉取与逐模型启停', () => {
        const source = read('ui/settings/api-section.ts');
        expect(source).toContain('从 URL 获取');
        expect(source).toContain('discoverModels(');
        expect(source).toContain('new ModelPickerModal(');
        expect(source).toContain('disabledModels');
    });

    it('连通性测试把当前格式传下去，避免格式选对但探测按 OpenAI 发', () => {
        const source = read('ui/settings/api-section.ts');
        expect(source).toMatch(/testProviderConnectivity\(\{[\s\S]*apiFormat: format/);
    });

    it('统一弹窗与设置页共用同一套两栏结构与类名', () => {
        const modal = read('ui/manage-providers-modal.ts');
        expect(modal).toContain("cls: 'nw-api-layout'");
        expect(modal).toContain("cls: 'nw-api-sidebar'");
        expect(modal).toContain("cls: 'nw-api-detail'");
        expect(modal).toContain('nw-api-text-input');
        expect(modal).toContain('从 URL 获取');
        expect(modal).toContain("API_FORMAT_OPTIONS");
    });

    it('候选弹窗用 nw-model-fetch-* 前缀，避开工作台 nw-model-picker-* 命名', () => {
        const modal = read('ui/model-picker-modal.ts');
        const popover = read('ui/model-picker-popover.ts');
        const css = read('styles.css');

        expect(modal).toContain('nw-model-fetch-');
        expect(modal).not.toMatch(/'nw-model-picker-/);
        expect(popover).toContain('nw-model-picker-row');
        expect(css).toContain('.nw-model-fetch-row');
        expect(css).toContain('.nw-model-picker-row');

        const fetchClasses = new Set([...css.matchAll(/\.(nw-model-fetch-[\w-]+)/g)].map(m => m[1]));
        const pickerClasses = new Set([...css.matchAll(/\.(nw-model-picker-[\w-]+)/g)].map(m => m[1]));
        expect(fetchClasses.size).toBeGreaterThan(0);
        expect(pickerClasses.size).toBeGreaterThan(0);
        for (const cls of fetchClasses) expect(pickerClasses.has(cls)).toBe(false);
    });

    it('新增状态类统一带 nw- 前缀（CSS 预算门禁要求）', () => {
        const css = read('styles.css');
        // 与 API 两栏相关的状态类必须自描述，不能用裸 is-xxx
        expect(css).toContain('.nw-api-sidebar-row-selected');
        expect(css).toContain('.nw-api-sidebar-dot-current');
        expect(css).toContain('.nw-api-model-row-disabled');
        expect(css).toContain('.nw-api-test-status-ok');
        // 不得残留裸状态类挂在 nw-api-* 选择器上
        expect(css).not.toMatch(/\.nw-api-[\w-]+\.is-/);
    });

    it('CustomProvider 声明了 apiFormat / disabledModels / modelMeta', () => {
        const main = read('main.ts');
        const manager = read('core/provider-manager.ts');
        expect(main).toMatch(/apiFormat\?: 'openai-chat' \| 'anthropic-messages' \| 'openai-responses'/);
        expect(main).toContain('disabledModels?: string[]');
        expect(main).toContain('modelMeta?: Record<string,');
        expect(manager).toMatch(/apiFormat: c\.apiFormat/);
    });

    it('AIApiClient 四条调用路径都按格式解析端点', () => {
        // 流式/非流式已拆到两个模块，四条调用路径合计仍必须按格式解析端点
        const source = read('engine/ai-api-client.ts') + read('engine/ai-api-stream.ts');
        expect(source).toContain('resolveApiFormat(endpoint)');
        expect((source.match(/resolveRequestEndpoint\(endpoint, apiFormat\)/g) ?? []).length).toBe(4);
        expect(source).toContain('buildAuthHeaders(apiFormat, apiKey)');
        expect(source).toContain('parseSseFrame(apiFormat, parsed)');
    });
});
