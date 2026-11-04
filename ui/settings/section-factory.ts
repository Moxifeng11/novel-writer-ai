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
    create: (host: SettingsSectionHost) => SettingsSection;
}

/** 唯一设置页签表（顺序即界面顺序） */
export const SETTINGS_TAB_DEFINITIONS: ReadonlyArray<SettingsTabDefinition> = [
    { id: 'api', label: '🔌 API 配置', create: host => new ApiSection(host) },
    { id: 'cowrite', label: '🖥 协同写作', create: host => new CoWriteSection(host) },
    { id: 'writing', label: '✍️ 写作配置', create: host => new WritingSection(host) },
    { id: 'modes', label: '📚 创作模式', create: host => new ModeSection(host) },
    { id: 'recognition', label: '🎭 角色识别', create: host => new RecognitionSection(host) },
    { id: 'suggestions', label: '💡 建议设置', create: host => new SuggestionsSection(host) },
    { id: 'template', label: '📋 模板管理', create: host => new TemplateSection(host) },
    { id: 'fingerprint', label: '🔍 写作指纹库', create: host => new FingerprintSection(host) },
    { id: 'knowledge', label: '📚 写作知识库', create: host => new KnowledgeSection(host) },
    { id: 'deconstruction', label: '🧬 拆解引擎', create: host => new DeconstructionSection(host) },
    { id: 'foreshadow', label: '🔮 伏笔管理', create: host => new ForeshadowSection(host) },
    { id: 'rules', label: '📜 写作规则', create: host => new RulesSection(host) },
    { id: 'appearance', label: '🎨 外观设置', create: host => new AppearanceSection(host) },
    { id: 'layout', label: '🧩 工作台布局', create: host => new LayoutSection(host) },
    { id: 'projects', label: '🗂 项目库迁移', create: host => new ProjectLibrarySection(host) },
    { id: 'performance', label: '📈 性能监控', create: host => new PerformanceSection(host) },
    { id: 'agent', label: '🤖 Agent 后端', create: host => new AgentBackendSection(host) },
    { id: 'about', label: 'ℹ️ 关于', create: host => new AboutSection(host) },
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
