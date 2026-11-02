import { TFile } from 'obsidian';
import { ALL_FULL_STEPS, FullStep } from '../../engine/step-runner';
import { parseChapterLocation, pjStepDir, projectIdFromPath } from '../../shared/paths';
import { createLogger } from '../../shared/logger';


const log = createLogger('FullWriterUtils');
export function calcResumeStepIndex(stepCompleted: Set<string>): number {
    for (const step of ALL_FULL_STEPS) {
        if (step.index === 0 || step.auto) continue;
        const sk = step.key;
        if (sk && !stepCompleted.has(sk)) {
            log.warn('[小说工坊] calcResumeStepIndex: 第一个未完成 =', step.label, 'stepCompleted=', [...stepCompleted]);
            return step.index;
        }
    }
    return 7;
}

export function rebuildChapDir(
    project: string,
    chapterName: string,
    volume: string,
    chapterNum?: number
): string {
    const volMatchNum = volume.match(/第(\d+)卷/);
    const chapMatchNum = chapterName.match(/第(\d+)章/);
    const volN = volMatchNum ? parseInt(volMatchNum[1], 10) : 1;
    const chapN = chapMatchNum ? parseInt(chapMatchNum[1], 10) : (chapterNum || 1);
    return pjStepDir(project, volN, chapN);
}

/**
 * 章节路径反解（工作台用）。
 * 标准路径交给 shared/paths.parseChapterLocation；无法识别时退回“项目 + 空章节”，
 * 项目仍走 projectIdFromPath，避免 v4 结构下把「长篇小说」当项目（B2）。
 * @param path - 路径
 */
export function parseChapterFromPath(path: string): {
    project: string;
    volume: string;
    chapterName: string;
    chapterNum: number;
} {
    const parsed = parseChapterLocation(path);
    if (parsed) return parsed;
    return {
        project: projectIdFromPath(path),
        volume: '',
        chapterName: '',
        chapterNum: 0,
    };
}

export function estimateTotalChars(
    context: any,
    stepResults: Record<string, string>,
    systemPromptEl?: HTMLTextAreaElement,
    userPromptEl?: HTMLTextAreaElement
): number {
    let total = 0;
    if (context) {
        total += JSON.stringify(context.data).length;
    }
    for (const result of Object.values(stepResults)) {
        total += result.length;
    }
    if (systemPromptEl) total += systemPromptEl.value.length;
    if (userPromptEl) total += userPromptEl.value.length;
    return total;
}

export function findStepByIndex(logicalIndex: number): FullStep | undefined {
    return ALL_FULL_STEPS.find(s => s.index === logicalIndex);
}

export function extractChapterNumber(chapterName: string): number {
    const match = chapterName.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
}
