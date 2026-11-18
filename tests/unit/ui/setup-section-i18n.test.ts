/**
 * setup-section-i18n.test.ts — 设置页「首启与自检」分区双语（缺口⑦ 第二期第11片）
 *
 * 该分区渲染的清单项 label/detail/fix 来自 SetupReadinessService，
 * 这里用真实服务 + 桩依赖走通整条链：zh 保持原文、en 全英文且不出现键名回退，
 * en 下允许的 CJK 只剩 vault 数据（模板根目录「元文件」、模式目录、项目名）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, Vault } from 'obsidian';
import { FakeEl, stubCreateDiv, stubDocument } from './support/fake-dom';
import { setLocale } from '../../../i18n';
import { SetupReadinessService } from '../../../services/setup-readiness-service';
import { TEMPLATE_SCAFFOLD_FILES } from '../../../shared/template-scaffold-assets.generated';
import { TEMPLATE_ROOT } from '../../../shared/template-scaffold';
import type { SettingsSectionHost } from '../../../ui/settings/section-base';

// vi.mock 会被提升到所有 import 之上，所以这里可以静态 import（也让 check:view-tests 认得这个文件）
import { SetupSection } from '../../../ui/settings/setup-section';

/** 与 services/setup-readiness.test.ts 同款「配置齐全」环境（项目放根级、模式目录不建 → folders warn） */
function makeService(): SetupReadinessService {
    const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
    const app = new App();
    app.vault = vault;
    for (const rel of Object.keys(TEMPLATE_SCAFFOLD_FILES)) vault._seedFile(`${TEMPLATE_ROOT}/${rel}`, 'x');
    vault._seedFile('测试书/作品信息.md', '# 作品');
    return new SetupReadinessService(app, {
        hasApiKey: () => true,
        currentModel: () => 'deepseek-flash',
        activeProject: () => '测试书',
        indexEntryCount: async () => 12,
        workerMode: async () => 'worker' as const,
    });
}

/** 桩宿主：runSetupReadiness 直连真实服务，其余只带分区真正读取的最小字段 */
function makeHost(service: SetupReadinessService): SettingsSectionHost {
    const plugin = {
        settings: { templateScaffoldOnStartup: true },
        runSetupReadiness: async () => service.check(),
        ensureTemplatesNow: async () => ({ created: 0, skipped: 0, failed: 0 }),
        createExampleProjectNow: async () => ({ created: false, repaired: 0, project: '长篇小说/示例书' }),
        writeUsageGuideNow: async () => ({ path: '写作知识库/插件使用约定.md' }),
        getWorkbenchContext: () => null,
        getActiveProject: () => '测试书',
        openOnboarding: () => undefined,
        saveSettings: async () => undefined,
    };
    return {
        app: {} as never,
        plugin: plugin as never,
        refresh: () => undefined,
        reopen: () => undefined,
    };
}

/** FakeEl 的 textContent 不聚合子节点，这里手动收集 */
function collectText(el: FakeEl): string {
    return [el.textContent, ...el.children.map(collectText)].join('\n');
}

async function renderText(): Promise<string> {
    const section = new SetupSection(makeHost(makeService()));
    const container = new FakeEl('div');
    await section.render(container as unknown as HTMLElement);
    return collectText(container);
}

/** en 下允许出现的 CJK：模板根目录名 + 三个模式目录 + 项目名（vault 数据，不译） */
const EN_CJK_WHITELIST = new Set('元文件长篇小说短篇小说剧本测试书');

beforeEach(() => {
    setLocale('zh-CN');
    stubCreateDiv();
    stubDocument();
});

afterEach(() => {
    setLocale('zh-CN');
    vi.unstubAllGlobals();
});

describe('SetupSection 双语（缺口⑦ 第二期第11片）', () => {
    it('中文默认：标题 / 摘要 / 清单项 / 按钮', async () => {
        const text = await renderText();
        expect(text).toContain('🚀 首启与自检');
        expect(text).toContain('✅ 可以开始写作（ok 6 / warn 3 / missing 0）');
        expect(text).toContain('✅ AI 供应商 API Key：');
        expect(text).toContain('已配置至少一个供应商的 API Key');
        expect(text).toContain('「元文件」模板树');
        expect(text).toContain('56 个模板文件齐全');
        expect(text).toContain('缺少目录：长篇小说、短篇小说、剧本');
        expect(text).toContain('测试书：12 条索引条目');
        expect(text).toContain('打开作品后可检查是否有中断的结算');
        expect(text).toContain('启动时自动生成「元文件」模板');
        // 按钮文案走 mock Setting 的游离 buttonEl，FakeEl 收集不到；键解析由 check:i18n 兜底
        expect(text).toContain('📌 目录 / 标签 / 属性约定');
    });

    it('en-US：全部界面文案英文化，且不回退成键名', async () => {
        setLocale('en-US');
        const text = await renderText();
        expect(text).toContain('🚀 First run & readiness');
        expect(text).toContain('✅ Ready to write (ok 6 / warn 3 / missing 0)');
        expect(text).toContain('✅ AI provider API key: ');
        expect(text).toContain('At least one provider API key is configured');
        expect(text).toContain('Template tree "元文件"');
        expect(text).toContain('All 56 template files present');
        expect(text).toContain('Missing folders: 长篇小说, 短篇小说, 剧本');
        expect(text).toContain('测试书: 12 index entries');
        expect(text).toContain('Open a work to check for interrupted settlements');
        expect(text).toContain('First-run guide');
        // 按钮文案走 mock Setting 的游离 buttonEl，FakeEl 收集不到；键解析由 check:i18n 兜底
        expect(text).toContain('📌 Folder / tag / property conventions');
        expect(text).not.toContain('settings.setup.');
    });

    it('en-US：CJK 只剩 vault 数据（白名单字符集）', async () => {
        setLocale('en-US');
        const text = await renderText();
        const cjk = text.match(/[\u4e00-\u9fff]/g) ?? [];
        for (const char of cjk) {
            expect(EN_CJK_WHITELIST.has(char), `en 渲染出现白名单外中文：${char}（上下文：${text.slice(Math.max(0, text.indexOf(char) - 20), text.indexOf(char) + 20)}）`).toBe(true);
        }
    });

    it('service 清单项随语言切换（locked 态修复建议）', async () => {
        const vault = new Vault() as Vault & { _seedFile(path: string, content: string): unknown };
        const app = new App();
        app.vault = vault;
        const service = new SetupReadinessService(app, {
            hasApiKey: () => false,
            secretsLocked: () => true,
            currentModel: () => '',
            activeProject: () => '',
            indexEntryCount: async () => 0,
        });
        setLocale('zh-CN');
        const zhProvider = (await service.check()).items.find(item => item.id === 'provider');
        expect(zhProvider?.detail).toContain('口令未解锁');
        expect(zhProvider?.fix).toContain('解锁');
        setLocale('en-US');
        const enProvider = (await service.check()).items.find(item => item.id === 'provider');
        expect(enProvider?.detail).toBe('Keys are saved encrypted but the current passphrase has not unlocked them (AI calls will all fail)');
        expect(enProvider?.fix).not.toMatch(/[\u4e00-\u9fff]/);
        expect(enProvider?.fix).not.toContain('settings.setup.');
        setLocale('zh-CN');
    });
});
