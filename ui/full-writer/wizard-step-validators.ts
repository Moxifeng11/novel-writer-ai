/**
 * 向导步骤内容完整性校验。
 *
 * 与「文件是否存在」不同：这里读取实际内容并做结构校验，
 * 用于阻止用户在内容不完整时直接进入下一步。
 */
import { App, TFile } from 'obsidian';
import {
    getSettingLibPath,
    getWorldviewPath,
    pjProjectMeta,
    pjVolumeOutlineDir,
    SUBDIR_BODY_ROOT,
    SUBDIR_OUTLINE_ROOT,
} from '@/shared/paths';
import {
    validateOutlineOutput,
    validateSettingLibOutput,
    validateWorldviewOutput,
    validateWritingStyleOutput,
} from '@/shared/template-validator';
import { isFanficSettingsContentValidEnough } from './fanfic-settings-utils';
import { findWritingStyleFile } from '@/ui/writing-style-paths';
import { parseProjectMeta } from '@/shared/fanfic-rules';
import { readMergedVolumeOutline } from '@/utils/helpers';
import { parseStorySettingsFromProjectMeta } from '@/shared/story-structure';

/**
 * WizardStepValidation 类型定义。
 */
export interface WizardStepValidation {
    valid: boolean;
    missingFields: string[];
}

const OK: WizardStepValidation = { valid: true, missingFields: [] };

async function readFileIfExists(app: App, path: string): Promise<string> {
    // 不能用 getAbstractFileByPath：`.project` 是点文件，Obsidian 不把它纳入索引，
    // 对任何真实项目都返回 null。向导的「故事结构」「同人」步骤正是读 `.project`，
    // 原实现导致这两个步骤永远判为未完成（用户无法通过向导）。
    // adapter 对普通文件与点文件都能读，统一走它。
    try {
        if (!(await app.vault.adapter.exists(path))) return '';
        return await app.vault.adapter.read(path);
    } catch {
        return '';
    }
}

async function validateChapters(app: App, project: string): Promise<WizardStepValidation> {
    const bodyFiles = app.vault.getFiles().filter(f =>
        f.path.startsWith(`${project}/${SUBDIR_BODY_ROOT}/`) &&
        /\/第\d+卷\/第\d+章[^/]*_正文\.md$/.test(f.path)
    );
    if (bodyFiles.length === 0) {
        return { valid: false, missingFields: ['尚未创建任何章节正文文件'] };
    }

    // 抽查最多 10 个章节，要求至少存在非空正文
    const sample = bodyFiles.slice(0, 10);
    let nonEmpty = 0;
    for (const file of sample) {
        try {
            const content = await app.vault.read(file);
            if (content.replace(/^---[\s\S]*?---/, '').trim().length > 0) nonEmpty++;
        } catch {
            // 单个文件读取失败不影响整体判定口径
        }
    }
    if (nonEmpty === 0) {
        return { valid: false, missingFields: ['章节正文文件均为空'] };
    }
    return OK;
}

/**
 * validateWizardStepContent 函数。
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param stepId - 步骤ID
  * @returns WizardStepValidation 实例
 */
export async function validateWizardStepContent(
    app: App,
    project: string,
    stepId: string
): Promise<WizardStepValidation> {
    switch (stepId) {
        case 'story_structure': {
            const meta = await readFileIfExists(app, pjProjectMeta(project));
            const settings = parseStorySettingsFromProjectMeta(meta);
            if (!settings) return { valid: false, missingFields: ['尚未配置故事结构与创作设定'] };
            return { valid: true, missingFields: [] };
        }
        case 'fanfic': {
            // 同人步骤的权威来源是 .project 记录的同人设定路径
            const meta = await readFileIfExists(app, pjProjectMeta(project));
            const path = parseProjectMeta(meta).fanficPath;
            if (!path) return { valid: false, missingFields: ['尚未保存同人设定（.project 未记录路径）'] };
            const content = await readFileIfExists(app, path);
            if (!content.trim()) return { valid: false, missingFields: ['同人设定文件不存在或为空'] };
            // 与保存侧同一口径：向导表单不收集时间线，严格口径（要求时间线真实数据）
            // 会让「保存成功 → 重启 → 步骤变为未完成」。
            const result = isFanficSettingsContentValidEnough(content);
            return { valid: result.valid, missingFields: result.missingFields };
        }
        case 'worldview': {
            const content = await readFileIfExists(app, getWorldviewPath(project));
            if (!content.trim()) return { valid: false, missingFields: ['世界观文件不存在或为空'] };
            const result = validateWorldviewOutput(content);
            return { valid: result.valid, missingFields: result.missingFields };
        }
        case 'setting_lib': {
            const content = await readFileIfExists(app, getSettingLibPath(project));
            if (!content.trim()) return { valid: false, missingFields: ['设定库文件不存在或为空'] };
            const result = validateSettingLibOutput(content);
            return { valid: result.valid, missingFields: result.missingFields };
        }
        case 'writing_style': {
            const file = await findWritingStyleFile(app, project);
            if (!(file instanceof TFile)) {
                return { valid: false, missingFields: ['文笔风格文件不存在或仍是占位模板'] };
            }
            try {
                const content = await app.vault.read(file);
                const result = validateWritingStyleOutput(content);
                return { valid: result.valid, missingFields: result.missingFields };
            } catch {
                return { valid: false, missingFields: ['文笔风格文件读取失败'] };
            }
        }
        case 'outline': {
            const hasVolumeFiles = app.vault.getFiles().some(f =>
                f.path.startsWith(`${pjVolumeOutlineDir(project)}/`) && f.name.endsWith('_分卷大纲.md')
            );
            const legacyPath = `${project}/${SUBDIR_OUTLINE_ROOT}/分卷大纲.md`;
            const content = hasVolumeFiles || app.vault.getAbstractFileByPath(legacyPath)
                ? await readMergedVolumeOutline(app, project)
                : '';
            if (!content.trim()) return { valid: false, missingFields: ['分卷大纲不存在或为空'] };
            const result = validateOutlineOutput(content);
            return { valid: result.valid, missingFields: result.missingFields };
        }
        case 'chapters':
            return validateChapters(app, project);
        default:
            return OK;
    }
}
