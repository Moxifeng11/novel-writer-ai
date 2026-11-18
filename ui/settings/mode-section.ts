/**
 * mode-section.ts — 设置页「创作模式与路径」分区
 *
 * 三个创作模式（长篇 / 短篇 / 剧本）共用同一套设置宿主，但项目根目录、
 * 内容结构与单元规格不同。这里把每类项目的路径与默认规格集中展示，
 * 避免用户在三处（写作配置/项目库/模板）来回猜。
 */
import { Setting } from 'obsidian';
import { t } from '@/i18n';
import { SettingsSection } from './section-base';
import {
    CREATION_MODE_SPECS,
    MODE_LIBRARY_ROOTS,
    type CreationMode,
} from '@/shared/creation-mode';
import { WRITING_RULES_PATH_TEMPLATE } from '@/shared/format-constants';
import { SHORT_CONTENT_ROOT, SCRIPT_CONTENT_ROOT } from '@/shared/mode-content';

/** 模式内容结构说明（展示用，不参与解析）。值为真实 vault 路径结构，属数据不译。 */
const MODE_CONTENT_LAYOUT: Record<CreationMode, string> = {
    long: '03-大纲与章节/正文/第N卷 · 步骤结果 · 11 步流水线',
    short: `${SHORT_CONTENT_ROOT}/03-正文 · 02-分节大纲 · 04-质检`,
    script: `${SCRIPT_CONTENT_ROOT}/03-剧本 · 02-分集大纲 · 04-分镜`,
};

/** 每个模式的补充提示（i18n 第二期第13片：文案进资源，渲染时求值）。 */
const MODE_HINT_KEYS: Record<CreationMode, string> = {
    long: 'settings.mode.hintLong',
    short: 'settings.mode.hintShort',
    script: 'settings.mode.hintScript',
};

/** 共享常量 CREATION_MODE_SPECS 的展示字段不改（引擎/提示词/其他视图共用），UI 按键求值。 */
const MODE_SPEC_KEYS: Record<CreationMode, { labelKey: string; descKey: string; unitKey: string; pluralKey: string }> = {
    long: {
        labelKey: 'settings.mode.spec.long.label',
        descKey: 'settings.mode.spec.long.description',
        unitKey: 'settings.mode.spec.long.unitLabel',
        pluralKey: 'settings.mode.spec.long.unitPlural',
    },
    short: {
        labelKey: 'settings.mode.spec.short.label',
        descKey: 'settings.mode.spec.short.description',
        unitKey: 'settings.mode.spec.short.unitLabel',
        pluralKey: 'settings.mode.spec.short.unitPlural',
    },
    script: {
        labelKey: 'settings.mode.spec.script.label',
        descKey: 'settings.mode.spec.script.description',
        unitKey: 'settings.mode.spec.script.unitLabel',
        pluralKey: 'settings.mode.spec.script.unitPlural',
    },
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
        section.createEl('h3', { text: t('settings.mode.title'), cls: 'nw-u-margintop-0' });
        section.createEl('p', {
            text: t('settings.mode.intro'),
            cls: 'setting-item-description',
        });

        for (const mode of ['long', 'short', 'script'] as CreationMode[]) {
            const spec = CREATION_MODE_SPECS[mode];
            const specKeys = MODE_SPEC_KEYS[mode];
            const card = section.createDiv();
            card.createEl('h4', { text: `${spec.icon} ${t(specKeys.labelKey)}`, cls: 'nw-u-margintop-16px' });
            card.createEl('p', { text: t(specKeys.descKey), cls: 'setting-item-description' });

            new Setting(card)
                .setName(t('settings.mode.libraryRootName'))
                .setDesc(t('settings.mode.libraryRootDesc', { root: MODE_LIBRARY_ROOTS[mode] }))
                .addText((text) => text.setValue(MODE_LIBRARY_ROOTS[mode]).setDisabled(true));

            new Setting(card)
                .setName(t('settings.mode.contentName'))
                .setDesc(MODE_CONTENT_LAYOUT[mode])
                .addText((text) => text.setValue(t(specKeys.pluralKey)).setDisabled(true));

            new Setting(card)
                .setName(t('settings.mode.unitSpecName'))
                .setDesc(t('settings.mode.unitSpecDesc', {
                    unit: t(specKeys.unitKey),
                    words: spec.targetWords.default,
                    min: spec.targetUnits.min,
                    max: spec.targetUnits.max,
                    plural: t(specKeys.pluralKey),
                }))
                .addText((text) => text
                    .setValue(t('settings.mode.unitSpecValue', {
                        min: spec.targetWords.min,
                        max: spec.targetWords.max,
                        unit: t(specKeys.unitKey),
                    }))
                    .setDisabled(true));

            card.createEl('p', { text: t(MODE_HINT_KEYS[mode]), cls: 'setting-item-description' });
        }

        section.createEl('p', {
            text: t('settings.mode.footer', { path: WRITING_RULES_PATH_TEMPLATE }),
            cls: 'nw-u-c-text-muted nw-u-fs-12px',
        });
    }
}
