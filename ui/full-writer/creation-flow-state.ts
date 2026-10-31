/**
 * creation-flow-state.ts — 把磁盘/内存事实采集为流程快照
 *
 * 这里只做 I/O 与事实归纳，所有「事实 → 状态」的判定都在
 * shared/creation-flow.ts 的纯函数里，便于单测穷举。
 * 判定全部复用既有 helper（listModeUnits / getChaptersForProject /
 * summarizeChapterProgress / readPreResearchData），不另建一套进度口径。
 */
import type { App } from 'obsidian';
import type { CreationMode } from '../../shared/creation-mode';
import { CREATION_MODE_SPECS, parseCreationModeMeta } from '../../shared/creation-mode';
import { readProjectMeta } from '../../shared/paths';
import {
    listModeUnits,
    modeDocPath,
    modeDocStarter,
    type ModeUnitInfo,
} from '../../shared/mode-content';
import { isPreResearchComplete, readPreResearchData } from '../../shared/pre-research';
import {
    resolveCreationFlow,
    hasMeaningfulDocContent,
    type CreationFlowDocFacts,
    type CreationFlowFacts,
    type CreationFlowSnapshot,
} from '../../shared/creation-flow';
import { isChapterWritten } from '../../shared/chapter-progress';
import { EXPORT_FALLBACK_DIR } from '../../shared/export-file';
import { getChaptersForProject, sortChaptersByNumber, type ChapterListEntry } from '../project-utils';
import { rememberProjectMode, resolveProjectMode } from '../../shared/project-mode';
import { STORAGE_KEY_PREFIXES, projectScopedKey } from '../../shared/storage-keys';

export interface CreationFlowStateOptions {
    /** 向导页签当前内存里的步骤结果；不传时读 localStorage 的项目分桶 */
    wizardResults?: Record<string, string>;
    /** 传入项目模式可省一次解析 */
    mode?: CreationMode;
}

export interface CreationFlowState {
    mode: CreationMode;
    facts: CreationFlowFacts;
    snapshot: CreationFlowSnapshot;
}

/**
 * 向导必做步骤里会落进 wizardStepResults 的键。
 * story_structure / outline / chapters 是弹窗步骤，结果直接写文件，不在这里；
 * 它们是否完成由「有没有章节骨架」等磁盘事实判断。
 */
const REQUIRED_WIZARD_KEYS = ['worldview', 'setting_lib'];

/** 桌面端导出走浏览器下载，磁盘上看不到；调用导出后记一个项目级标记 */
export function markFlowExported(project: string): void {
    if (!project) return;
    try {
        localStorage.setItem(`${STORAGE_KEY_PREFIXES.flowExport}${project}`, String(Date.now()));
    } catch {
        // localStorage 不可用时只是无法标记导出完成，不影响导出本身
    }
}

function readExportFlag(project: string): boolean {
    try {
        return !!localStorage.getItem(`${STORAGE_KEY_PREFIXES.flowExport}${project}`);
    } catch {
        return false;
    }
}

function readWizardResultsFromStorage(project: string): Record<string, string> {
    try {
        const raw = localStorage.getItem(projectScopedKey(STORAGE_KEY_PREFIXES.wizardResults, project));
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {};
    } catch {
        return {};
    }
}

function hasWizardResults(results: Record<string, string>): boolean {
    return REQUIRED_WIZARD_KEYS.every(key => String(results[key] ?? '').trim().length > 0);
}

async function readDocFacts(app: App, project: string, mode: CreationMode): Promise<CreationFlowDocFacts> {
    const kinds: Array<'storyCore' | 'outline' | 'bible' | 'storyboard'> = mode === 'script'
        ? ['bible', 'outline', 'storyboard']
        : mode === 'short'
            ? ['storyCore', 'outline']
            : [];

    const facts: CreationFlowDocFacts = {};
    for (const kind of kinds) {
        const path = modeDocPath(project, mode, kind);
        try {
            if (!(await app.vault.adapter.exists(path))) {
                facts[kind] = false;
                continue;
            }
            const content = await app.vault.adapter.read(path);
            facts[kind] = hasMeaningfulDocContent(content, modeDocStarter(project, mode, kind));
        } catch {
            facts[kind] = false;
        }
    }
    return facts;
}

function hasExportArtifact(app: App, project: string): boolean {
    if (readExportFlag(project)) return true;
    const baseName = project.split('/').pop() || project;
    try {
        const files = app.vault.getFiles();
        if (files.some(file => file.path.startsWith(`${EXPORT_FALLBACK_DIR}/`) && file.name.includes(baseName))) {
            return true;
        }
        return files.some(file =>
            file.path.startsWith(`${project}/05-导出/`) || file.path.startsWith(`${project}/06-导出/`));
    } catch {
        return false;
    }
}

interface UnitTotals {
    total: number;
    written: number;
    settled: number;
    nextNumber: number | null;
}

function summarizeUnits(units: ModeUnitInfo[]): UnitTotals {
    const writtenFlags = units.map(unit =>
        isChapterWritten(unit.status, true, unit.file?.stat?.size ?? 0));
    const written = writtenFlags.filter(Boolean).length;
    const settled = units.filter(unit => (unit.status || '').trim().toLowerCase() === 'settled').length;

    const byNumber = new Map<number, boolean>();
    units.forEach((unit, index) => byNumber.set(unit.number, writtenFlags[index]));
    const maxNumber = units.reduce((max, unit) => Math.max(max, unit.number), 0);
    let nextNumber: number | null = null;
    for (let number = 1; number <= maxNumber; number++) {
        if (!byNumber.get(number)) {
            nextNumber = number;
            break;
        }
    }

    return { total: units.length, written, settled, nextNumber };
}

function summarizeLongChapters(chapters: ChapterListEntry[]): UnitTotals {
    const sorted = sortChaptersByNumber([...chapters]);
    const written = sorted.filter(chapter => chapter.written).length;
    const settled = sorted.filter(chapter => (chapter.status || '').trim().toLowerCase() === 'settled').length;

    const byNumber = new Map<number, boolean>();
    for (const chapter of sorted) {
        const matched = chapter.chapter.match(/第\s*(\d+)\s*[章节集回幕]/);
        const number = matched ? parseInt(matched[1], 10) : 0;
        if (number > 0) byNumber.set(number, chapter.written);
    }
    const maxNumber = [...byNumber.keys()].reduce((max, number) => Math.max(max, number), 0);
    let nextNumber: number | null = null;
    for (let number = 1; number <= maxNumber; number++) {
        if (!byNumber.get(number)) {
            nextNumber = number;
            break;
        }
    }

    return { total: sorted.length, written, settled, nextNumber };
}

/**
 * 采集流程快照。project 必须是项目 ID（含模式目录前缀）。
 */
export async function collectCreationFlowState(
    app: App,
    project: string,
    options: CreationFlowStateOptions = {},
): Promise<CreationFlowState> {
    const mode = options.mode ?? await resolveProjectMode(app, project);
    rememberProjectMode(project, mode);

    let unitTarget = CREATION_MODE_SPECS[mode].targetUnits.default;
    let preResearchDone = false;
    if (mode !== 'long') {
        try {
            const meta = parseCreationModeMeta((await readProjectMeta(app, project)) || '');
            // `.project` 缺失/损坏时 parse 会回退到 long 的默认集数，不能拿来当本模式目标
            unitTarget = meta.mode === mode ? meta.targetUnits : CREATION_MODE_SPECS[mode].targetUnits.default;
            preResearchDone = isPreResearchComplete(await readPreResearchData(app.vault.adapter, project));
        } catch {
            preResearchDone = false;
        }
    }

    const docs = await readDocFacts(app, project, mode);

    let units: UnitTotals;
    if (mode === 'long') {
        units = summarizeLongChapters(getChaptersForProject(app, project));
    } else {
        units = summarizeUnits(listModeUnits(app, project, mode));
    }

    const wizardResults = options.wizardResults ?? readWizardResultsFromStorage(project);
    const facts: CreationFlowFacts = {
        preResearchDone,
        docs,
        wizardDone: mode === 'long' ? hasWizardResults(wizardResults) : undefined,
        unitTotal: units.total,
        unitTarget: unitTarget > 0 ? unitTarget : 0,
        unitWritten: units.written,
        unitSettled: mode === 'long' ? units.settled : undefined,
        nextUnitNumber: units.nextNumber,
        exportExists: hasExportArtifact(app, project),
    };

    return {
        mode,
        facts,
        snapshot: resolveCreationFlow(mode, project, facts),
    };
}
