import { TFile } from 'obsidian';
import { ALL_FULL_STEPS, FullStep } from '../../engine/step-runner';
import { pjStepDir } from '../../shared/paths';
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

export function parseChapterFromPath(path: string): {
    project: string;
    volume: string;
    chapterName: string;
    chapterNum: number;
} {
    const project = path.split('/')[0] || '';
    const volMatch = path.match(/03-大纲与章节\/(?:正文\/|步骤结果\/)?(第\d+卷)/);
    const volume = volMatch ? volMatch[1] : '';
    const chapMatch = path.match(/(第\d+章)/);
    const chapterName = chapMatch ? chapMatch[1] : '';
    const chapterNum = chapterName ? parseInt(chapterName.match(/\d+/)![0]) : 0;
    return { project, volume, chapterName, chapterNum };
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
