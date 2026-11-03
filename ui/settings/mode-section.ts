/**
 * mode-section.ts — 设置页「创作模式与路径」分区
 *
 * 三个创作模式（长篇 / 短篇 / 剧本）共用同一套设置宿主，但项目根目录、
 * 内容结构与单元规格不同。这里把每类项目的路径与默认规格集中展示，
 * 避免用户在三处（写作配置/项目库/模板）来回猜。
 */
import { Setting } from 'obsidian';
import { SettingsSection } from './section-base';
import {
    CREATION_MODE_SPECS,
    MODE_LIBRARY_ROOTS,
    type CreationMode,
} from '@/shared/creation-mode';
import { SHORT_CONTENT_ROOT, SCRIPT_CONTENT_ROOT } from '@/shared/mode-content';

/** 模式内容结构说明（展示用，不参与解析）。 */
const MODE_CONTENT_LAYOUT: Record<CreationMode, string> = {
    long: '03-大纲与章节/正文/第N卷 · 步骤结果 · 11 步流水线',
    short: `${SHORT_CONTENT_ROOT}/03-正文 · 02-分节大纲 · 04-质检`,
    script: `${SCRIPT_CONTENT_ROOT}/03-剧本 · 02-分集大纲 · 04-分镜`,
};

/** 每个模式的补充提示。 */
const MODE_HINT: Record<CreationMode, string> = {
    long: '写作规则与正文模板（V1–V4）在此模式生效；章节结算与实体图谱走完整流水线。',
    short: '使用「单元写作」工作台；写作规则 + 短篇附录生效，不跑 11 步流水线。',
    script: '使用「单元写作」工作台；写作规则 + 剧本附录生效，输出场景标题/动作行/台词。',
};

/**
 * 创作模式与路径设置分区：三类项目的根目录、内容结构与单元规格总览。
 */
export class ModeSection extends SettingsSection {
    /**
     * 渲染该设置分区。
     *
     * @param container - 容器元素
     */
    render(container: HTMLElement): void {
        const section = container.createEl('section');
        section.createEl('h3', { text: '📚 创作模式与路径', cls: 'nw-u-margintop-0' });
        section.createEl('p', {
            text: '三个模式共用同一套设置；这里集中展示各自的根目录、内容结构与单元规格，所有设置项仍保留在原分区。',
            cls: 'setting-item-description',
        });

        for (const mode of ['long', 'short', 'script'] as CreationMode[]) {
            const spec = CREATION_MODE_SPECS[mode];
            const card = section.createDiv();
            card.createEl('h4', { text: `${spec.icon} ${spec.label}`, cls: 'nw-u-margintop-16px' });
            card.createEl('p', { text: spec.description, cls: 'setting-item-description' });

            new Setting(card)
                .setName('项目库根目录')
                .setDesc(`项目 ID 形如「${MODE_LIBRARY_ROOTS[mode]}/书名」；改目录结构前先备份。`)
                .addText((text) => text.setValue(MODE_LIBRARY_ROOTS[mode]).setDisabled(true));

            new Setting(card)
                .setName('内容结构')
                .setDesc(MODE_CONTENT_LAYOUT[mode])
                .addText((text) => text.setValue(spec.unitPlural).setDisabled(true));

            new Setting(card)
                .setName('单元规格')
                .setDesc(`每个${spec.unitLabel}默认 ${spec.targetWords.default} 字；全书 ${spec.targetUnits.min}–${spec.targetUnits.max} ${spec.unitPlural}。`)
                .addText((text) => text
                    .setValue(`${spec.targetWords.min}–${spec.targetWords.max} 字/${spec.unitLabel}`)
                    .setDisabled(true));

            card.createEl('p', { text: MODE_HINT[mode], cls: 'setting-item-description' });
        }

        section.createEl('p', {
            text: '提示：写作规则唯一来源是「元文件/00-系统模板/写作规则.md」；模式附录由插件按项目自动拼接，无需手动选择。',
            cls: 'nw-u-c-text-muted-2 nw-u-fs-12px',
        });
    }
}
