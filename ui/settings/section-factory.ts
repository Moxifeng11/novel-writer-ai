/**
 * section-factory.ts — 设置分区唯一装配表
 *
 * 背景：`ui/settings-tab.ts` 与 `ui/mini-settings-modal.ts` 曾各自实现同一批
 * API/协同/写作/外观设置；字段校验与保存语义在两边漂移。这里把「tab → 分区类」
 * 的映射收敛成一份，两个宿主只负责外壳（设置页/弹窗）。
 */
import { t } from '@/i18n';
import type { SettingsSection, SettingsSectionHost } from './section-base';
import { ApiSection } from './api-section';
import { SetupSection } from './setup-section';
import { KnowledgeSection } from './knowledge-section';
import { FingerprintSection } from './fingerprint-section';
import { DeconstructionSection } from './deconstruction-section';
import { ForeshadowSection } from './foreshadow-section';
import {
    CoWriteSection,
    WritingSection,
    TemplateSection,
    AppearanceSection,
    ProjectLibrarySection,
    LayoutSection,
} from './writing-sections';
import {
    PerformanceSection,
    RulesSection,
    AboutSection,
    RecognitionSection,
    SuggestionsSection,
} from './general-sections';
import { AgentBackendSection } from './agent-section';
import { McpSection } from './mcp-section';
import { ModeSection } from './mode-section';

/** 一个设置页签的装配描述 */
export interface SettingsTabDefinition {
    id: string;
    label: string;
    /** primary = 常用；advanced = 高级（默认折叠） */
    group: 'primary' | 'advanced';
    create: (host: SettingsSectionHost) => SettingsSection;
}

/**
 * 设置的一级分组（v4.96）：20 个 tab 收敛为 6 个功能域。
 *
 * 为什么：平铺 tab 扫视成本高，且顺序无语义分组
 * （「Agent 后端」在最末、「模板管理」夹在建议设置与指纹库之间）。
 * 一级只留 6 个功能域，二级才是具体 tab。
 */
/**
 * 一级分组建构器。
 *
 * `label` 写成 getter：设置页在语言切换后会整页重开，getter 保证每次读取
 * 都取到当前语言的文案；若在这里直接算成字符串，切换语言后分组名不会变。
 */
function group(id: string, labelKey: string, tabs: readonly string[]): { id: string; label: string; tabs: readonly string[] } {
    return {
        id,
        get label(): string { return t(labelKey); },
        tabs,
    };
}

/** 一级分组 → 二级 tab 归属（6 个功能域） */
export const SETTINGS_GROUPS: ReadonlyArray<{ id: string; label: string; tabs: readonly string[] }> = [
    group('connect', 'settings.group.connect', ['setup', 'api', 'agent', 'mcp']),
    group('writing', 'settings.group.writing', ['cowrite', 'writing', 'modes', 'suggestions']),
    group('rules', 'settings.group.rules', ['rules', 'recognition', 'foreshadow']),
    group('knowledge', 'settings.group.knowledge', ['knowledge', 'deconstruction', 'template', 'fingerprint']),
    group('ui', 'settings.group.ui', ['appearance', 'layout']),
    group('ops', 'settings.group.ops', ['projects', 'performance', 'about']),
];

/** 页签构造器：`label` 同样是 getter，理由见 `group()` */
function tab(
    id: string,
    labelKey: string,
    group: 'primary' | 'advanced',
    create: (host: SettingsSectionHost) => SettingsSection,
): SettingsTabDefinition {
    return {
        id,
        get label(): string { return t(labelKey); },
        group,
        create,
    };
}

/** 唯一设置页签表（顺序即界面顺序） */
export const SETTINGS_TAB_DEFINITIONS: ReadonlyArray<SettingsTabDefinition> = [
    tab('setup', 'settings.tab.setup', 'primary', host => new SetupSection(host)),
    tab('api', 'settings.tab.api', 'primary', host => new ApiSection(host)),
    tab('cowrite', 'settings.tab.cowrite', 'primary', host => new CoWriteSection(host)),
    tab('writing', 'settings.tab.writing', 'primary', host => new WritingSection(host)),
    tab('modes', 'settings.tab.modes', 'primary', host => new ModeSection(host)),
    tab('recognition', 'settings.tab.recognition', 'advanced', host => new RecognitionSection(host)),
    tab('suggestions', 'settings.tab.suggestions', 'advanced', host => new SuggestionsSection(host)),
    tab('template', 'settings.tab.template', 'advanced', host => new TemplateSection(host)),
    tab('fingerprint', 'settings.tab.fingerprint', 'advanced', host => new FingerprintSection(host)),
    tab('knowledge', 'settings.tab.knowledge', 'primary', host => new KnowledgeSection(host)),
    tab('deconstruction', 'settings.tab.deconstruction', 'advanced', host => new DeconstructionSection(host)),
    tab('foreshadow', 'settings.tab.foreshadow', 'primary', host => new ForeshadowSection(host)),
    tab('rules', 'settings.tab.rules', 'primary', host => new RulesSection(host)),
    tab('appearance', 'settings.tab.appearance', 'primary', host => new AppearanceSection(host)),
    tab('layout', 'settings.tab.layout', 'advanced', host => new LayoutSection(host)),
    tab('projects', 'settings.tab.projects', 'advanced', host => new ProjectLibrarySection(host)),
    tab('performance', 'settings.tab.performance', 'advanced', host => new PerformanceSection(host)),
    tab('agent', 'settings.tab.agent', 'primary', host => new AgentBackendSection(host)),
    tab('mcp', 'settings.tab.mcp', 'primary', host => new McpSection(host)),
    tab('about', 'settings.tab.about', 'primary', host => new AboutSection(host)),
];

/**
 * 按 id 创建分区实例。
 *
 * @param id - 页签 id
 * @param host - 宿主
 * @returns 分区或 null
 */
export function createSettingsSection(id: string, host: SettingsSectionHost): SettingsSection | null {
    const definition = SETTINGS_TAB_DEFINITIONS.find(item => item.id === id);
    return definition ? definition.create(host) : null;
}
