import { App, Notice, TFolder, TFile } from 'obsidian';
import { getChapterFile, CHAPTER_FILE_TYPES, normalizeChapterFiles, findBodyFileV4 } from '../../engine/chapter-utils';
import { ALL_FULL_STEPS, migrateStepIndex } from '../../engine/step-runner';
import { validateStepResult, isTemplateSkeleton, StepLevel } from '../../engine/step-validator';

/**
 * 管理章节步骤状态的恢复与维护。
 * 保存步骤完成状态、步骤结果和当前步骤索引。
 *
 * v6.0: 引入四级状态体系（empty / skeleton / partial / complete），
 * 只有 complete 级别才算 stepCompleted。
 */
export class ChapterStateManager {
    public stepCompleted: Set<string> = new Set();
    public stepResults: Record<string, string> = {};
    public stepLevels: Record<string, StepLevel> = {};
    public stepMissing: Record<string, string[]> = {};
    public currentStepIndex = 0;
    /** 标记哪些 stepKey 是在本会话中由 AI 生成（非从磁盘恢复） */
    public generatedThisSession: Set<string> = new Set();
    /** v3.4.7 P4: 标记正文已手动修改导致审查过期的步骤 */
    public staleSteps: Set<string> = new Set();

    constructor(private app: App) {}

    /** 重置所有步骤状态 */
    reset(): void {
        this.stepResults = {};
        this.stepCompleted = new Set();
        this.stepLevels = {};
        this.stepMissing = {};
        this.currentStepIndex = 0;
        this.generatedThisSession = new Set();
        this.staleSteps = new Set();
    }

    /**
     * v6.0: 统一更新步骤状态（走结构化校验）
     * 所有步骤完成标记都应走此方法，确保 stepLevels / stepMissing / stepCompleted 三者一致。
     *
     * @param stepKey 步骤 key
     * @param content 步骤内容（纯正文）
     * @param forceComplete 是否强制标记为 complete（如 step_status=generated 等历史兼容场景）
     */
    updateStepState(stepKey: string, content: string, forceComplete = false): void {
        const validation = validateStepResult(stepKey, content);
        let level: StepLevel = validation.level;
        let missing = validation.missing;

        if (forceComplete) {
            level = 'complete';
            missing = [];
        }

        this.stepLevels[stepKey] = level;
        this.stepMissing[stepKey] = missing;

        if (level === 'complete') {
            this.stepCompleted.add(stepKey);
        } else {
            this.stepCompleted.delete(stepKey);
        }

        if (level !== 'empty') {
            this.stepResults[stepKey] = content;
        }
    }

    /**
     * P2-5：对历史 logicalIndex 一次性升级到新的连续索引。
     * 调用方应在「从外部载入持久化的 currentStepIndex」时调用一次；
     * reset() 之后无需再调（已为 0）。
     */
    migrateLegacyStepIndex(): void {
        const before = this.currentStepIndex;
        const after = migrateStepIndex(before);
        if (after !== before) {
            console.warn(`[ChapterStateManager] P2-5 步骤索引迁移: ${before} → ${after}`);
            this.currentStepIndex = after;
        }
    }

    /**
     * 恢复已完成的步骤状态（从磁盘文件读取）
     *
     * 使用 getChapterFile（name.includes 模糊匹配）而非 getChapterFileName 精确路径，
     * 因为正文文件名可能包含标题（如"第1章_异变的黄昏_正文.md"），
     * 且 stepFileMap 中的英语 key 需转换为 CHAPTER_FILE_TYPES 的中文值。
     */
    async restoreChapterState(chapDir: string): Promise<void> {
        if (!chapDir) { console.warn('[ChapterStateManager] restoreChapterState: chapDir 为空，跳过'); return; }

        // 获取章节目录 TFolder
        const chapFolder = this.app.vault.getAbstractFileByPath(chapDir);
        if (!(chapFolder instanceof TFolder)) { console.warn('[ChapterStateManager] restoreChapterState: chapDir 不是文件夹', chapDir); return; }

        console.log('[ChapterStateManager] restoreChapterState: 开始恢复', chapDir);

        // 【规范化】将旧格式文件统一迁移为标准格式
        const chapterName = chapDir.split('/').pop() || '';
        await normalizeChapterFiles(this.app, chapFolder, chapterName);

        // v4.0: 正文文件已从步骤结果目录分离到 正文/第N卷/，需用 project/volN/chapN 经 findBodyFileV4 定位。
        // 从 chapDir（项目/03-大纲与章节/步骤结果/第N卷/第M章）解析三要素。
        const { project: bodyProject, volN: bodyVolN, chapN: bodyChapN } = this.parseChapDir(chapDir);
        const resolveBodyFile = (): TFile | null => {
            if (bodyProject && bodyVolN > 0 && bodyChapN > 0) {
                return findBodyFileV4(this.app, bodyProject, bodyVolN, bodyChapN) || null;
            }
            // 兜底：旧结构正文仍在步骤目录内时，沿用 getChapterFile
            return getChapterFile(chapFolder, CHAPTER_FILE_TYPES.body);
        };

        // stepKey -> CHAPTER_FILE_TYPES key 的映射
        // 只有持久化到磁盘的类型才需要恢复
        const stepFileMap: Record<string, keyof typeof CHAPTER_FILE_TYPES> = {
            'infoPlan': 'infoPlan',
            'outline': 'outline',
            'bodyGeneration': 'body',
            'continuityCheck': 'continuityReview',
            'analysisReport': 'analysisReport',
            'selfCheck': 'selfCheck',
            'fix': 'fix',
            'finalFix': 'finalFix',
            'plotDistill': 'plotDistill',
            'qualityControl': 'qualityControl',
            'emotionPlan': 'emotionPlan',       // V2
            'sceneExpand': 'sceneExpand',       // V2
            'characterSoul': 'characterSoul',   // V2
        };

        for (const [stepKey, fileTypeKey] of Object.entries(stepFileMap)) {
            const chineseType = CHAPTER_FILE_TYPES[fileTypeKey];
            // v4.0: 正文走分离目录定位；其余步骤文件仍在步骤结果目录内。
            const file = stepKey === 'bodyGeneration'
                ? resolveBodyFile()
                : getChapterFile(chapFolder, chineseType);
            if (!file) continue;

            let content = '';
            try {
                content = await this.app.vault.read(file);
            } catch (e) {
                console.warn(`[ChapterStateManager] 跳过无法读取的文件: ${file.path}`, e instanceof Error ? e.message : e);
                continue;  // 单文件损坏不中断整个循环
            }
            const pureBody = content.replace(/^---[\s\S]*?---/, '').trim();

            // v4.0: 优先读 step_status 字段（新状态机），fallback 旧 source/字节逻辑
            let stepStatus: string | undefined;
            let fmSource: string | undefined;
            let fmData: Record<string, any> = {};
            try {
                const fileCache = this.app.metadataCache.getFileCache(file);
                stepStatus = fileCache?.frontmatter?.['step_status'];
                fmSource = fileCache?.frontmatter?.['source'];
                fmData = fileCache?.frontmatter || {};
                if (!stepStatus) {
                    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
                    if (fmMatch) {
                        const sm = fmMatch[1].match(/^step_status:\s*(.+)$/m);
                        if (sm) stepStatus = sm[1].trim();
                        if (!fmSource) { const sm2 = fmMatch[1].match(/^source:\s*(.+)$/m); if (sm2) fmSource = sm2[1].trim(); }
                    }
                }
            } catch (e) {
                console.warn('[ChapterState] 状态读取失败:', e);
                new Notice('ChapterState：数据读取异常，部分功能可能受限');
            }

            console.warn('[ChapterStateManager] restoreChapterState 步骤检查:', stepKey, '文件=', file.name, '长度=', pureBody.length, 'source=', fmSource);

            // v6.0: 模板骨架检测
            const isTmplSkeleton = isTemplateSkeleton(pureBody, stepKey);

            // v6.0: 统一走结构化校验，记录 level 和 missing
            const validation = validateStepResult(stepKey, isTmplSkeleton ? '' : pureBody);
            let level: StepLevel = validation.level;
            let missing = validation.missing;

            // v4.0: step_status 字段优先（强制标记为 complete）
            if (stepStatus === 'generated' || stepStatus === 'reviewed') {
                level = 'complete';
                missing = [];
            }

            // v4.0: 正文 status 字段判断
            if (stepKey === 'bodyGeneration') {
                const bodyCache = this.app.metadataCache.getFileCache(file);
                let bodyStatus = bodyCache?.frontmatter?.['status'];
                console.warn('[ChapterStateManager] bodyGeneration: bodyPureLen=', pureBody.length, 'bodyStatus(cache)=', bodyCache?.frontmatter?.['status']);
                if (!bodyStatus) {
                    try {
                        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
                        if (fmMatch) { const sm = fmMatch[1].match(/^status:\s*(.+)$/m); if (sm) bodyStatus = sm[1].trim(); }
                    } catch (e) {
                        console.warn('[ChapterState] 状态读取失败:', e);
                        new Notice('ChapterState：数据读取异常，部分功能可能受限');
                    }
                }
                if (bodyStatus === 'written' || bodyStatus === 'settled' || bodyStatus === '已完稿') {
                    level = 'complete';
                    missing = [];
                }
            }

            // v4.0: source 标记兼容（ai-generated / manual → 视为 partial 以上）
            if ((fmSource === 'ai-generated' || fmSource === 'manual') && !isTmplSkeleton) {
                if (level === 'empty' || level === 'skeleton') {
                    level = 'partial';
                }
            }

            // 记录状态
            this.stepLevels[stepKey] = level;
            this.stepMissing[stepKey] = missing;

            // v6.0: 只有 complete 级别才算 stepCompleted
            if (level === 'complete') {
                this.stepCompleted.add(stepKey);
            }

            // 有内容就存 stepResults（用于提示词注入等），不只是 complete 才存
            if (level !== 'empty' && !isTmplSkeleton) {
                this.stepResults[stepKey] = pureBody;
            }
        }

        // v3.4.7 P4: 正文手动修改 → 审查过期脏标记
        // v3.4.8: 结算会写 body frontmatter（mtime +1），必须跳过已完稿的章节
        let isSettled = false;  // v3.4.8 P0: 提升作用域，避免 L187 ReferenceError
        try {
            this.staleSteps = new Set();
            // v4.0: 正文已分离目录，必须用 findBodyFileV4 定位，否则 bodyFile 恒 null → isSettled/脏标记失效。
            const bodyFile = resolveBodyFile();
            if (bodyFile instanceof TFile) {
                // 检查 status 是否已完稿 — 结算后不再标脏
                let bodyStatus = '';
                try {
                    const bodyCache = this.app.metadataCache.getFileCache(bodyFile);
                    bodyStatus = bodyCache?.frontmatter?.['status'] || '';
                    if (!bodyStatus) {
                        const raw = await this.app.vault.read(bodyFile);
                        const fmMatch = raw.match(/^status:\s*(.+)$/m);
                        if (fmMatch) bodyStatus = fmMatch[1].trim();
                    }
                } catch (e) {
                    // P1-2: 读取正文 status 失败不影响主流程，但需要日志便于排查
                    console.warn('[ChapterStateManager] 读取正文 status 失败:', e instanceof Error ? e.message : String(e));
                }
                isSettled = bodyStatus === '已完稿' || bodyStatus === 'settled';

                if (!isSettled) {
                    const bodyMtime = bodyFile.stat?.mtime || 0;
                    // v6.0: selfCheck / continuityReview 已合并入 qualityControl
                    // 依赖正文内容的步骤，正文更新后它们过期
                    const dependsOnBody: (keyof typeof CHAPTER_FILE_TYPES)[] = [
                        'fix', 'qualityControl', 'analysisReport'
                    ];
                    for (const fileTypeKey of dependsOnBody) {
                        const chineseType = CHAPTER_FILE_TYPES[fileTypeKey as keyof typeof CHAPTER_FILE_TYPES];
                        const reviewFile = getChapterFile(chapFolder, chineseType);
                        if (!reviewFile) continue;
                        const reviewMtime = reviewFile.stat?.mtime || 0;
                        if (bodyMtime > reviewMtime) {
                            const stepK = Object.keys(stepFileMap).find(
                                k => stepFileMap[k] === fileTypeKey
                            );
                            if (stepK) {
                                this.stepCompleted.delete(stepK);
                                this.staleSteps.add(stepK);
                            }
                        }
                    }
                } else {
                    console.log('[ChapterStateManager] 正文 status=已完稿，跳过 mtime 标脏');
                }
            }

            // v3.4.8: 审计→修正时序检测（持久化跨会话标脏）
            // 新流程: ⑤→⑥→⑦→⑧→⑨finalFix→⑩analysisReport→⑪settlement
            // ⑧ qualityControl 在 ⑦ fix 后 → fix 过期
            // ⑩ analysisReport 在 ⑨ finalFix 后 → 若含 CRITICAL_FAIL → finalFix 过期
            if (!isSettled) {
                const fixFile = getChapterFile(chapFolder, CHAPTER_FILE_TYPES.fix);
                const finalFixFile = getChapterFile(chapFolder, CHAPTER_FILE_TYPES.finalFix);

                // ⑧ qualityControl > ⑦ fix → fix 过期
                if (fixFile instanceof TFile) {
                    const fixMtime = fixFile.stat?.mtime || 0;
                    const qcFile = getChapterFile(chapFolder, CHAPTER_FILE_TYPES.qualityControl);
                    if (qcFile instanceof TFile) {
                        const qcMtime = qcFile.stat?.mtime || 0;
                        if (qcMtime > fixMtime) {
                            this.stepCompleted.delete('fix');
                            this.staleSteps.add('fix');
                            console.warn(`[ChapterStateManager] qualityControl(${qcMtime}) > fix(${fixMtime}) → 标脏 fix`);
                        }
                    }
                }

                // ⑩ analysisReport 含 CRITICAL_FAIL → finalFix 过期
                const arFile = getChapterFile(chapFolder, CHAPTER_FILE_TYPES.analysisReport);
                if (arFile instanceof TFile && finalFixFile instanceof TFile) {
                    try {
                        const arContent = await this.app.vault.read(arFile);
                        if (arContent.includes('CRITICAL_FAIL')) {
                            this.stepCompleted.delete('finalFix');
                            this.staleSteps.add('finalFix');
                            console.warn('[ChapterStateManager] analysisReport 含 CRITICAL_FAIL → 标脏 finalFix');
                        }
                    } catch (e) {
                        // P1-2: 读取 analysisReport 失败 → 保守地不标脏 finalFix
                        console.warn('[ChapterStateManager] 读取 analysisReport 失败（保守不标脏 finalFix）:', e instanceof Error ? e.message : String(e));
                    }
                }
            }
        } catch (e) {
            console.warn('[ChapterStateManager] 脏标记检查失败（已跳过，不影响主流程）:', e);
            this.staleSteps = new Set();
        }

        // v6.0: context 是特殊步骤，恢复时也同步设置 level
        this.stepLevels['context'] = 'complete';
        this.stepMissing['context'] = [];
        this.stepCompleted.add('context');
        this.currentStepIndex = this.stepCompleted.size > 0 ? 1 : 0;
        console.warn('[ChapterStateManager] restoreChapterState 完成: stepCompleted=', [...this.stepCompleted], 'staleSteps=', [...this.staleSteps], 'stepLevels=', this.stepLevels);
    }

    /**
     * v3.4.8 SOURCE: 检测文件是否为"只有结构、没有实质内容"的模板骨架
     * 批量建章创建的模板文件有完整的标题结构和空字段，字节数轻松超标，
     * 但这些文件没有 AI 填充的实际内容，不应被误判为"已完成"。
     *
     * 检测策略（infoPlan 专用的强检测 + 其他步骤通用的弱检测）：
     * - infoPlan: frontmatter 情感温度/冲突强度为空 + body 空字段行占比 > 70%
     * - 通用: body 中不含任何实值字段行（`- Name：Value` 有实际 Value）→ 骨架
     */
    private detectTemplateSkeleton(pureBody: string, fm: Record<string, any>, stepKey: string): boolean {
        return this.detectTemplateSkeletonImpl(pureBody, fm, stepKey);
    }

    /**
     * v4.0: 从 chapDir 解析 project / volN / chapN。
     * chapDir 形如 `项目/03-大纲与章节/步骤结果/第N卷/第M章`。
     * project = `/03-大纲与章节/` 之前的整段前缀（兼容项目名含子层级）；
     * volN / chapN 从含「第X卷」「第X章」的路径段提取。
     */
    private parseChapDir(chapDir: string): { project: string; volN: number; chapN: number } {
        const marker = '/03-大纲与章节/';
        const mi = chapDir.indexOf(marker);
        const project = mi > 0 ? chapDir.slice(0, mi) : '';
        const volN = parseInt(chapDir.match(/第(\d+)卷/)?.[1] || '0', 10);
        const chapN = parseInt(chapDir.match(/第(\d+)章/)?.[1] || '0', 10);
        return { project, volN, chapN };
    }

    private detectTemplateSkeletonImpl(pureBody: string, fm: Record<string, any>, stepKey: string): boolean {
        // --- 步骤特定检测 ---
        if (stepKey === 'infoPlan') {
            // infoPlan 模板标志：frontmatter 核心字段为空值
            const fmTemp = String(fm['情感温度'] || '').trim();
            const fmConflict = String(fm['冲突强度'] || '').trim();
            if (!fmTemp && !fmConflict) {
                // 两个核心字段都为空 → 模板概率极高
                return true;
            }
            // 进一步：数 body 中有实值的行 vs 总行数
            const lines = pureBody.split('\n').filter(l => l.trim());
            if (lines.length === 0) return true;
            let filledLines = 0;
            for (const line of lines) {
                const t = line.trim();
                if (t.startsWith('#')) continue;           // 标题
                if (t.startsWith('---')) continue;         // 分隔符
                // 检查 `- 字段名：值` 模式是否有非空值
                const m = t.match(/^[-*]\s*.+?[:：]\s*(.+)$/);
                if (m && m[1].trim().length > 0) {
                    filledLines++;
                } else if (t.length > 10 && !t.includes('：') && !t.includes(':')) {
                    // 散文字段（非键值对，通常 AI 生成才有）
                    filledLines++;
                }
            }
            // 70% 以上的行都是空壳 → 模板
            return filledLines < Math.max(3, lines.length * 0.3);
        }

        // --- 通用检测 ---
        // v6.2: 自由文本步骤（正文/大纲/分析报告等）不再用字数阈值判断骨架
        // 原因：短但认真写的内容可能<100字但不是模板；长模板也可能>100字但全是占位符
        // 改为：仅通过模板占位符/标记判断是否为骨架，空内容由 step-validator 判定为 empty
        const narrativeSteps = ['bodyGeneration', 'outline', 'analysisReport', 'continuityCheck', 'selfCheck', 'fix', 'finalFix', 'plotDistill', 'qualityControl'];
        if (narrativeSteps.includes(stepKey)) {
            const templateMarkers = [
                '（待 auto_writer', '（待定）', '待补充', '暂无',
                '{{Name}}', '{{name}}', '（由AI生成）', '（填入',
                '<!-- -->', '（单层/多层',
            ];
            const hasTemplateMarker = templateMarkers.some(m => pureBody.includes(m));
            if (hasTemplateMarker) return true;
            const cleanText = pureBody.replace(/\s+/g, '').replace(/^#+.*$/gm, '').trim();
            if (cleanText.length === 0) return true;
            return false;
        }

        // 如果 frontmatter 无 source 字段 → 检查 body 是否有实质内容
        // 统计 `- Name：Value` 中有实值的行
        const lines = pureBody.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) return true;
        let filledCount = 0;
        for (const line of lines) {
            if (line.startsWith('#')) continue;
            const m = line.match(/^[-*]\s*.+?[:：]\s*(.+)$/);
            if (m && m[1].length > 0) filledCount++;
        }
        // 超过 50% 的实值行 → 有内容，不是骨架
        if (filledCount > lines.length * 0.5) return false;
        // 超过 3 个实值行 → 有内容
        if (filledCount >= 3) return false;
        return true;
    }
}
