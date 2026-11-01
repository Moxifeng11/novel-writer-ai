/**
 * wizard-checker.ts — 向导步骤完整性检测 (v3.4.9 从 full-writer-view.ts 提取)
 *
 * 功能: 6 种项目设定文件的完整性校验 + 自动名称填充 + 文件夹重命名
 *
 * 提取自 full-writer-view.ts:
 *   - restoreWizardStepStatus (L4577)
 *   - checkWorldviewComplete (L4633)
 *   - autoFillWorldviewNames (L4750)
 *   - renameProjectFolder (L4845)
 *   - checkSettingLibComplete (L4877)
 *   - checkWritingStyleComplete (L4924)
 *   - checkEntitiesComplete (L4980)
 *   - checkOutlineComplete (L5024)
 *   - checkChaptersComplete (L5083)
 */

import { App, TFile, Notice } from 'obsidian';
import { findChapterFile, findBodyFileV4, CHAPTER_FILE_TYPES } from '../engine/chapter-utils';
import { extractWorldviewMeta } from './utils/worldview-utils';
import { findWritingStyleFile } from './writing-style-paths';
import {
    pjWorldview, pjSettingLib, pjOutlineDir,
    pjVolumeOutlineFile, pjCharsDir, pjLocsDir, pjFactionsDir, pjItemsDir,
} from '../shared/paths';
import {
    NOTICE_INFO, NOTICE_ERROR, CHAPTER_SPOT_CHECK_MAX,
} from '../shared/thresholds';
import { WV_SECTIONS } from '../shared/format-constants';
import { entityDir } from '../shared/entity-reader';

// WizardTab/WizardStep 接口由 full-writer/wizard-types 统一定义，避免重复（v6.0 去重）
import { WizardTab, WizardStep } from './full-writer/wizard-types';
import { createLogger } from '../shared/logger';

const log = createLogger('WizardChecker');
export type { WizardTab, WizardStep };

export class WizardChecker {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * 恢复向导步骤状态——逐步骤检测文件完整性，更新 status 字段
     * @param tab 向导标签页
     * @param skipAutoAdvance 是否跳过自动前进（用户显式操作时）
     */
    async restoreWizardStepStatus(tab: WizardTab, skipAutoAdvance = false): Promise<void> {
        const checks: Record<string, () => Promise<boolean>> = {
            'worldview': () => this.checkWorldviewComplete(tab.project),
            'setting_lib': () => this.checkSettingLibComplete(tab.project),
            'writing_style': () => this.checkWritingStyleComplete(tab.project),
            'entities': () => this.checkEntitiesComplete(tab.project),
            'outline': () => this.checkOutlineComplete(tab.project),
            'chapters': () => this.checkChaptersComplete(tab.project),
        };

        for (const step of tab.steps) {
            if (step.id === 'fanfic' || step.id === 'complete') continue;
            if (step.id in checks) {
                try {
                    const isComplete = await checks[step.id]();
                    log.warn('[Wizard:restoreStatus] step=', step.id, 'isComplete=', isComplete, 'currentStatus=', step.status);
                    if (isComplete) {
                        if (step.status === 'complete_with_warnings' || step.status === 'retry' || step.status === 'executing') {
                            step.status = 'done';
                            if (step.subSteps) {
                                step.subSteps.forEach(s => { s.status = 'done'; });
                            }
                        }
                    } else {
                        if (step.status === 'done') {
                            step.status = 'complete_with_warnings';
                        } else if (step.status === 'executing') {
                            step.status = 'retry';
                        }
                    }
                } catch (e) {
                    log.error('[Wizard:restoreStatus] check异常:', step.id, e);
                }
            }
        }

        if (!skipAutoAdvance
            && (tab.steps[tab.currentStepIdx]?.status === 'done' || tab.steps[tab.currentStepIdx]?.status === 'complete_with_warnings')
            && tab.currentStepIdx < tab.steps.length - 1) {
            const nextIdx = tab.steps.findIndex((s, i) => i > tab.currentStepIdx && s.status !== 'done' && s.status !== 'complete_with_warnings' && s.status !== 'skipped');
            log.warn('[Wizard:autoAdvance] 当前步骤=', tab.steps[tab.currentStepIdx]?.id, 'status=', tab.steps[tab.currentStepIdx]?.status, 'nextIdx=', nextIdx);
            if (nextIdx !== -1) {
                tab.currentStepIdx = nextIdx;
                log.warn('[Wizard:autoAdvance] → 跳转到', tab.steps[nextIdx]?.id);
            } else {
                tab.currentStepIdx = tab.steps.length - 1;
                log.warn('[Wizard:autoAdvance] → 所有完成，跳到最后一页');
            }
        }
    }

    /**
     * 检测世界观设定是否完整（9模块 + frontmatter 字段级校验）
     */
    async checkWorldviewComplete(project: string): Promise<boolean> {
        const filePath = pjWorldview(project);
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
            log.warn('[checkWorldviewComplete] ❌ 文件不存在:', filePath);
            return false;
        }

        const content = await this.app.vault.read(file);
        if (content.trim().length === 0) {
            log.warn('[checkWorldviewComplete] ❌ 文件为空:', filePath);
            return false;
        }

        const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        let fmNamesComplete = false;
        if (fmMatch) {
            const fm = fmMatch[1];
            const extractFieldVal = (fieldName: string): string => {
                const m = fm.match(new RegExp(`^${fieldName}:\\s*(.+)$`, 'm'));
                if (!m) return '';
                return m[1].trim().replace(/^["']+|["']+$/g, '');
            };
            const worldName = extractFieldVal('世界名称');
            const projName = extractFieldVal('项目名称');
            const nameValid = (s: string): boolean => !!s && s !== '—' && s !== '-' && !/^\{\{.+\}\}$/.test(s);
            fmNamesComplete = nameValid(worldName) || nameValid(projName);
            log.info('[checkWorldviewComplete] fm 名称:', { worldName, projName, fmNamesComplete });
        } else {
            log.warn('[checkWorldviewComplete] ⚠️ 无 frontmatter');
        }

        const modules = WV_SECTIONS.map(s => `## ${s}`);
        const templateHints = [
            '{{Name}}', '（由AI生成）',
        ];

        for (const modTitle of modules) {
            const normalizedContent = content.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ');
            if (!normalizedContent.includes(modTitle)) {
                log.warn('[checkWorldviewComplete] ❌ 缺失模块标题:', modTitle);
                return false;
            }
            const escapedTitle = modTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const modRegex = new RegExp(escapedTitle + '[\\s\\S]*?(?=\\n## |$)', '');
            const modMatch = normalizedContent.match(modRegex);
            if (!modMatch) {
                log.warn('[checkWorldviewComplete] ❌ 无法提取模块内容:', modTitle);
                return false;
            }
            const modContent = modMatch[0];
            const realLines = modContent.split('\n').filter(l => {
                const t = l.trim();
                return t && !t.startsWith('<!--') && !t.startsWith('##') && !/^-\s*\*\*.+?\*\*\s*：\s*$/.test(t);
            });
            const hitHints = templateHints.filter(h => modContent.includes(h));
            const hasRealContent = hitHints.length === 0 && realLines.length >= 2;
            
            // 历史大事记 特殊检测：使用 ### 子标题输出，至少有 1 个有效子标题即算通过
            const moduleName = modTitle.replace(/^## /, '');
            const isHistoryModule = moduleName === '历史大事记';
            const historySubs = ['### 远古', '### 近代', '### 近期'];
            const historyOk = isHistoryModule && historySubs.some(sub => modContent.includes(sub));
            
            if (!hasRealContent && !historyOk) {
                log.warn('[checkWorldviewComplete] ❌ 模块:', modTitle,
                    `| 实线=${realLines.length} | 命中提示=${JSON.stringify(hitHints)}`);
                const rawLines = modContent.split('\n');
                for (let i = 0; i < rawLines.length; i++) {
                    const l = rawLines[i];
                    for (const h of hitHints) {
                        if (l.includes(h)) {
                            log.warn(`[checkWorldviewComplete]    → L${i}: "${l.trim().slice(0, 80)}" 命中 "${h}"`);
                        }
                    }
                }
                return false;
            }
            log.info('[checkWorldviewComplete] ✅ 模块通过:', modTitle, `${realLines.length} 行`);
        }

        if (!fmNamesComplete) {
            log.info('[checkWorldviewComplete] ✏️ 触发自动填充名称');
            await this.autoFillWorldviewNames(project, file, content);
        }

        log.info('[checkWorldviewComplete] ✅ 全部通过');
        return true;
    }

    /**
     * 自动填充世界名称和项目名称到世界观总览.md frontmatter
     */
    async autoFillWorldviewNames(project: string, file: TFile, content: string): Promise<void> {
        let fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        let body = content;
        if (!fmMatch) {
            const basicFm = `tags: [世界观]\n世界名称: ""\n项目名称: "${project}"`;
            body = content.replace(/^---\s*(\n[\s\S]*?)\n---\s*/, '').trim();
            const newContent = `---\n${basicFm}\n---\n\n${body}`;
            await this.app.vault.modify(file, newContent);
            fmMatch = newContent.match(/^---\s*\n([\s\S]*?)\n---/);
            if (!fmMatch) return;
            body = newContent.slice(fmMatch[0].length);
        } else {
            body = content.slice(fmMatch[0].length);
        }
        let fm = fmMatch[1];

        const extractFieldVal = (fieldName: string): string => {
            const m = fm.match(new RegExp(`^${fieldName}:\\s*(.+)$`, 'm'));
            if (!m) return '';
            return m[1].trim().replace(/^["']+|["']+$/g, '');
        };
        const isValid = (s: string) => s && s !== '—' && s !== '-' && !/^\{\{.+\}\}$/.test(s);

        let worldName = extractFieldVal('世界名称');
        let projName = extractFieldVal('项目名称');
        const folderName = project.replace(/^.*\//, '');

        if (!isValid(worldName)) {
            const patterns = [
                /\*\*世界名称\*\*[：:]\s*(.+)/,
                /^世界名称[：:]\s*(.+)/m,
                /「(.+?)」世界/,
                /这个世界(?:被)?称为[「"']?(.+?)[」"']/,
                /名为[「"']?([^「"'\n]{2,8})[「"']?(?:的)?世界/,
                /^#\s*.{0,4}世界[：:]\s*(.+)/m,
                /##\s*世界层级体系[\s\S]{0,500}?核心[「"']?([^「"'\n]{2,6})[「"']?/,
            ];
            for (const pat of patterns) {
                const m2 = body.match(pat);
                if (m2 && m2[1].trim() && m2[1].trim().length >= 2) {
                    worldName = m2[1].trim().replace(/^["'「]|["'」]$/g, '');
                    break;
                }
            }
            if (!isValid(worldName)) {
                const powerMatch = body.match(/修炼体系名称[：:]\s*(.+)/);
                if (powerMatch && powerMatch[1].trim()) {
                    const powerName = powerMatch[1].trim().replace(/["']/g, '');
                    const shortName = powerName.replace(/[之道法术]$/, '').trim();
                    if (shortName.length >= 2 && shortName.length <= 6) {
                        worldName = shortName + '界';
                    }
                }
            }
            if (!isValid(worldName)) {
                worldName = folderName;
            }
        }

        if (!isValid(projName)) {
            projName = folderName;
        }

        const writes: string[] = [];
        if (!isValid(extractFieldVal('世界名称'))) {
            if (fm.includes('世界名称:')) {
                fm = fm.replace(/^世界名称:\s*.+$/m, `世界名称: "${worldName}"`);
            } else {
                fm += `\n世界名称: "${worldName}"`;
            }
            writes.push(`世界名称="${worldName}"`);
        }
        if (!isValid(extractFieldVal('项目名称'))) {
            if (fm.includes('项目名称:')) {
                fm = fm.replace(/^项目名称:\s*.+$/m, `项目名称: "${projName}"`);
            } else {
                fm += `\n项目名称: "${projName}"`;
            }
            writes.push(`项目名称="${projName}"`);
        }
        if (writes.length === 0) return;

        const newContent = `---\n${fm}\n---${body}`;
        await this.app.vault.modify(file, newContent);
        new Notice(`📝 世界观名称已自动填充：${writes.join('，')}`, NOTICE_INFO);
        log.info('[小说工坊] 自动填充世界观名称:', { 世界名称: worldName, 项目名称: projName, writes });

        if (writes.includes(`项目名称="${projName}"`) && projName !== folderName) {
            await this.renameProjectFolder(project, projName);
        }
    }

    /**
     * 重命名项目文件夹
     */
    async renameProjectFolder(oldPath: string, newName: string): Promise<void> {
        try {
            const parent = oldPath.replace(/\/[^/]+$/, '');
            const newPath = parent ? `${parent}/${newName}` : newName;
            const existing = this.app.vault.getAbstractFileByPath(newPath);
            if (existing) {
                log.warn('[小说工坊] 目标文件夹已存在，跳过重命名:', newPath);
                return;
            }
            const folder = this.app.vault.getAbstractFileByPath(oldPath);
            if (!folder) {
                log.warn('[小说工坊] 源文件夹不存在，跳过重命名:', oldPath);
                return;
            }
            await this.app.fileManager.renameFile(folder, newPath);
            new Notice(`📁 项目文件夹已重命名: ${oldPath.replace(/^.*\//, '')} → ${newName}`, NOTICE_ERROR);
            log.info('[小说工坊] 项目文件夹已重命名:', oldPath, '→', newPath);
        } catch (e) {
            log.error('[小说工坊] 项目文件夹重命名失败:', e);
            new Notice(`⚠️ 项目文件夹重命名失败: ${e instanceof Error ? e.message : '未知错误'}`, NOTICE_ERROR);
        }
    }

    /**
     * 检测设定库是否完整
     */
    async checkSettingLibComplete(project: string): Promise<boolean> {
        const filePath = pjSettingLib(project);
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return false;

        const content = await this.app.vault.read(file);
        if (content.trim().length === 0) return false;
        if (!content.includes('设定库')) return false;

        const sections: Array<{title: string; hasSub: boolean; sub?: string; hasTable?: boolean;}> = [
            { title: '## 一、世界观底层规则', hasSub: true, sub: '### 物理法则' },
            { title: '## 二、核心设定', hasSub: true, sub: '### 力量体系详情' },
            { title: '## 三、力量体系详情', hasSub: false, hasTable: true },
            { title: '## 四、科技水平', hasSub: false },
            { title: '## 五、势力分布', hasSub: false, hasTable: true },
            { title: '## 六、地理/区域', hasSub: false, hasTable: true },
            { title: '## 七、关键历史事件', hasSub: false },
            { title: '## 八、当前故事阶段', hasSub: false },
        ];

        let missingSections: string[] = [];
        for (const sec of sections) {
            if (!content.includes(sec.title) && !content.includes('## ' + sec.title.replace('## ', '').replace(/^[一二三四五六七八]、/, ''))) {
                missingSections.push(sec.title.replace('## ', ''));
                continue;
            }
        }
        if (missingSections.length > 0) {
            // 与 validateSettingLibOutput 同一口径：缺模块就是「不完整」。
            // 旧实现只 warn 仍返回 true，导致「下一步」校验失败置 complete_with_warnings，
            // 紧接着 restoreWizardStepStatus 又把状态翻回 done —— 用户被永久卡在这一步
            // （complete_with_warnings 才会渲染「跳过此步骤」按钮）。
            log.warn(`[checkSettingLibComplete] 设定库缺少 ${missingSections.length} 个模块: ${missingSections.join(', ')}`);
            return false;
        }
        if (content.includes('> ⚠️ 填充完此文件后删除本行')) return false;
        return true;
    }

    /**
     * 检测文笔风格是否完整
     */
    async checkWritingStyleComplete(project: string): Promise<boolean> {
        // v4.1: 通过候选路径解析真实文件（兼容 文笔风格.md / 文笔风格模板.md / 旧根目录），
        // 避免因命名差异（元文件复制来的「文笔风格模板.md」）导致永远判定未完成、按钮不渲染。
        const wsFile = await findWritingStyleFile(this.app, project, { allowPlaceholder: true });
        if (!(wsFile instanceof TFile)) return false;

        const wsContent = await this.app.vault.read(wsFile);

        let fmSource: string | undefined;
        try {
            const fmMatch = wsContent.match(/^---\n([\s\S]*?)\n---/);
            if (fmMatch) {
                const sm = fmMatch[1].match(/^source:\s*(.+)$/m);
                if (sm) fmSource = sm[1].trim();
            }
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            log.warn('[wizard-checker] 读取 frontmatter 失败:', errMsg);
        }
        const isUserModified = fmSource === 'manual' || fmSource === 'ai-generated';
        if (isUserModified) {
            log.warn('[checkWritingStyleComplete] source字段匹配:', fmSource, '→ 已完成');
            return true;
        }

        if (wsContent.trim().length === 0) return false;
        if (!wsContent.includes('template_version: 2')) return false;

        const combatMatch = wsContent.match(/### 战斗\/冲突场景样本[\s\S]*?```[\s\S]*?```/);
        if (!combatMatch) return false;

        const dailyMatch = wsContent.match(/### 日常\/对话场景样本[\s\S]*?```[\s\S]*?```/);
        if (!dailyMatch) return false;

        if (!wsContent.includes('## 一、叙事视角')) return false;
        const povMatch = wsContent.match(/- 视角：\s*(.+)/);
        if (!povMatch || !povMatch[1].trim() || povMatch[1].includes('<!-- -->')) return false;

        if (!wsContent.includes('## 二、文笔特征')) return false;
        const styleMatch = wsContent.match(/- 总体风格：\s*(.+)/);
        if (!styleMatch || !styleMatch[1].trim() || styleMatch[1].includes('<!-- -->')) return false;

        if (wsContent.includes('> ⚠️ 填充完此文件后删除本行')) return false;
        if ((wsContent.match(/<!-- -->/g) || []).length > 3) return false;

        return true;
    }

    /**
     * 检测实体生成是否完整
     */
    async checkEntitiesComplete(project: string): Promise<boolean> {
        const entityDirs = [
            { name: '人物', dir: entityDir(project, 'characters'), templateName: '人物模板.md' },
            { name: '地点', dir: entityDir(project, 'locations'), templateName: '地点模板.md' },
            { name: '势力', dir: entityDir(project, 'factions'), templateName: '势力模板.md' },
            { name: '物品功法', dir: entityDir(project, 'items'), templateName: '物品功法模板.md' },
        ];
        const adapter = this.app.vault.adapter;

        for (const { name, dir, templateName } of entityDirs) {
            if (!await adapter.exists(dir)) {
                log.info(`[checkEntitiesComplete] ${name}目录不存在: ${dir}`);
                return false;
            }
            const dirList = await adapter.list(dir);
            const mdFiles = dirList.files.filter(f => f.endsWith('.md') && !f.endsWith(templateName));
            if (mdFiles.length === 0) {
                log.info(`[checkEntitiesComplete] ${name}目录无有效文件（排除模板 ${templateName}）`);
                return false;
            }
            const checkFile = this.app.vault.getAbstractFileByPath(mdFiles[0]);
            if (!(checkFile instanceof TFile)) continue;

            const content = await this.app.vault.read(checkFile);
            if (content.trim().length === 0) return false;

            const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
            if (!fmMatch) return false;

            const body = content.replace(/^---\s*\n[\s\S]*?\n---/, '').trim();
            if (body.includes('（待AI生成）') || body.includes('{{')) return false;
        }

        return true;
    }

    /**
     * 检测全书规划是否完整
     */
    async checkOutlineComplete(project: string): Promise<boolean> {
        const filePath = pjVolumeOutlineFile(project, 1);
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return false;

        const content = await this.app.vault.read(file);
        // v6.2: 去掉字数否决门槛，改为结构检查优先
        const bodyAfterFM = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trim();
        const hasContentQuick = bodyAfterFM.length > 50 && !bodyAfterFM.includes('{{');
        if (!hasContentQuick) return false;

        const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        const fm = fmMatch ? fmMatch[1] : '';
        const body = fmMatch ? content.slice(fmMatch[0].length) : content;

        const hasTotalWordsInFm = /总字数目标\s*[:：]\s*\d+/.test(fm);
        const hasTotalWordsInBody = /\*\*?\s*总字数目标\s*\*\*?\s*[:：]\s*\d+/.test(body)
            || /总字数目标\s*[:：]\s*\d+/.test(body);
        if (!hasTotalWordsInFm && !hasTotalWordsInBody) return false;

        const volMatches = content.match(/###\s*第\d+卷/g);
        if (!volMatches || volMatches.length === 0) return false;

        for (const volMarker of volMatches) {
            const volIdx = content.indexOf(volMarker);
            const nextVolIdx = content.indexOf('### 第', volIdx + 10);
            const volContent = nextVolIdx === -1 ? content.slice(volIdx) : content.slice(volIdx, nextVolIdx);

            const tableRows = volContent.split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l.trim()));
            if (tableRows.length === 0) return false;

            if (!volContent.includes('**章节范围**：') && !volContent.includes('章节范围：')) return false;
        }

        if (content.includes('{{卷名}}') || content.includes('{{冲突}}')) return false;

        return true;
    }

    /**
     * 检测批量建章是否完整
     */
    async checkChaptersComplete(project: string): Promise<boolean> {
        const baseDir = pjOutlineDir(project);
        const adapter = this.app.vault.adapter;
        if (!(await adapter.exists(baseDir))) return false;

        // v6.0: 改用 vault.getFiles() 读取文件列表，避免 adapter.list() 缓存导致的假阳性
        const allFiles = this.app.vault.getFiles();
        const stepRoot = `${baseDir}/步骤结果`;
        const chapterDirs: { volN: number; chapN: number; folder: string }[] = [];

        // 从文件路径中提取 步骤结果/第N卷/第M章 目录
        for (const file of allFiles) {
            const rel = file.path.startsWith(stepRoot) ? file.path.slice(stepRoot.length) : null;
            if (!rel) continue;
            const m = rel.match(/^\/第(\d+)卷\/第(\d+)章\//);
            if (!m) continue;
            const volN = parseInt(m[1], 10);
            const chapN = parseInt(m[2], 10);
            const folder = `${stepRoot}/第${volN}卷/第${chapN}章`;
            if (!chapterDirs.some(d => d.volN === volN && d.chapN === chapN)) {
                chapterDirs.push({ volN, chapN, folder });
            }
        }

        if (chapterDirs.length === 0) return false;

        const checkDirs = chapterDirs.slice(0, Math.min(CHAPTER_SPOT_CHECK_MAX, chapterDirs.length));
        const isUsefulStepFile = async (file: TFile | null): Promise<boolean> => {
            if (!file) return false;
            const content = await this.app.vault.read(file);
            const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*/, '').trim();
            if (body.length < 80) return false;
            if (body.includes('{{') || body.includes('待填写') || body.includes('待生成')) return false;
            if (/^#\s*第\d+章\s*(信息规划|大纲摘要)\s*$/m.test(body) && body.split(/\r?\n/).length < 8) return false;
            return true;
        };
        let validCount = 0;
        for (const { volN, chapN, folder } of checkDirs) {
            // 宽松检测：有正文/大纲/信息规划任其一即视为章节存在
            // v4.0：正文在 正文/第N卷/，大纲与信息规划在 步骤结果/第N卷/第M章/。
            const hasBody = !!findBodyFileV4(this.app, project, volN, chapN);
            const hasOutline = await isUsefulStepFile(findChapterFile(allFiles, folder, CHAPTER_FILE_TYPES.outline) ?? null);
            const hasInfo = await isUsefulStepFile(findChapterFile(allFiles, folder, CHAPTER_FILE_TYPES.infoPlan) ?? null);
            if (hasBody || hasOutline || hasInfo) validCount++;
        }
        log.info(`[WizardChecker] checkChaptersComplete: ${validCount}/${checkDirs.length} 章节有效`);
        return validCount > 0;
    }
}
