/**
 * section-factory.ts — 设置分区唯一装配表
 *
 * 背景：`ui/settings-tab.ts` 与 `ui/mini-settings-modal.ts` 曾各自实现同一批
 * API/协同/写作/外观设置；字段校验与保存语义在两边漂移。这里把「tab → 分区类」
 * 的映射收敛成一份，两个宿主只负责外壳（设置页/弹窗）。
 */
import type { SettingsSection, SettingsSectionHost } from './section-base';
import { ApiSection } from './api-section';
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
    PromptsSection,
    RulesSection,
    AboutSection,
    RecognitionSection,
    SuggestionsSection,
} from './general-sections';
import { AgentBackendSection } from './agent-section';
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
 * 设置的一级分组（v4.96）：18 个 tab 收敛为 6 个功能域。
 *
 * 为什么：18 个平铺 tab 扫视成本高，且顺序无语义分组
 * （「Agent 后端」在最末、「模板管理」夹在建议设置与指纹库之间）。
 * 一级只留 6 个功能域，二级才是具体 tab。
 */
export const SETTINGS_GROUPS: ReadonlyArray<{ id: string; label: string; tabs: readonly string[] }> = [
    { id: 'connect', label: '🔌 连接与模型', tabs: ['api', 'agent'] },
    { id: 'writing', label: '✍️ 写作与协同', tabs: ['cowrite', 'writing', 'modes', 'suggestions'] },
    { id: 'rules', label: '📜 规则与一致性', tabs: ['rules', 'recognition', 'foreshadow'] },
    { id: 'knowledge', label: '📚 知识与拆解', tabs: ['knowledge', 'deconstruction', 'template', 'fingerprint'] },
    { id: 'ui', label: '🎨 界面与工作台', tabs: ['appearance', 'layout'] },
    { id: 'ops', label: '🗂 项目与运维', tabs: ['projects', 'performance', 'about'] },
];

/** 唯一设置页签表（顺序即界面顺序） */
export const SETTINGS_TAB_DEFINITIONS: ReadonlyArray<SettingsTabDefinition> = [
    { id: 'api', label: '🔌 API 配置', group: 'primary', create: host => new ApiSection(host) },
    { id: 'cowrite', label: '🖥 协同写作', group: 'primary', create: host => new CoWriteSection(host) },
    { id: 'writing', label: '✍️ 写作配置', group: 'primary', create: host => new WritingSection(host) },
    { id: 'modes', label: '🎯 创作模式', group: 'advanced', create: host => new ModeSection(host) },
    { id: 'recognition', label: '🎭 角色识别', group: 'advanced', create: host => new RecognitionSection(host) },
    { id: 'suggestions', label: '💡 建议设置', group: 'advanced', create: host => new SuggestionsSection(host) },
    { id: 'template', label: '📋 模板管理', group: 'advanced', create: host => new TemplateSection(host) },
    { id: 'fingerprint', label: '🔍 写作指纹库', group: 'advanced', create: host => new FingerprintSection(host) },
    { id: 'knowledge', label: '📚 写作知识库', group: 'primary', create: host => new KnowledgeSection(host) },
    { id: 'deconstruction', label: '🧬 拆解引擎', group: 'advanced', create: host => new DeconstructionSection(host) },
    { id: 'foreshadow', label: '🔮 伏笔管理', group: 'advanced', create: host => new ForeshadowSection(host) },
    { id: 'rules', label: '📜 写作规则', group: 'primary', create: host => new RulesSection(host) },
    { id: 'appearance', label: '🎨 外观设置', group: 'primary', create: host => new AppearanceSection(host) },
    { id: 'layout', label: '🧩 工作台布局', group: 'advanced', create: host => new LayoutSection(host) },
    { id: 'projects', label: '🗂 项目库迁移', group: 'advanced', create: host => new ProjectLibrarySection(host) },
    { id: 'performance', label: '📈 性能监控', group: 'advanced', create: host => new PerformanceSection(host) },
    { id: 'agent', label: '🤖 Agent 后端', group: 'advanced', create: host => new AgentBackendSection(host) },
    { id: 'about', label: 'ℹ️ 关于', group: 'primary', create: host => new AboutSection(host) },
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
