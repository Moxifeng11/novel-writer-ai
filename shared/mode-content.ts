/**
 * mode-content.ts — 短篇 / 剧本独立内容结构与单元文件
 *
 * 长篇继续使用 `03-大纲与章节`；短篇使用 `短篇创作/`，剧本使用 `剧本创作/`。
 * 本模块只提供路径、目录初始化、单元骨架与扫描，不依赖长篇步骤/章节状态。
 */
import type { App, DataAdapter } from 'obsidian';
import { TFile } from 'obsidian';
import type { CreationMode } from './creation-mode';
import { resolveProjectRoot } from '@/shared/project-root';
import { writeVaultText } from './file-system-port';

/**
 * 短篇内容根目录。
 */
export const SHORT_CONTENT_ROOT = '短篇创作';
/**
 * 剧本内容根目录。
 */
export const SCRIPT_CONTENT_ROOT = '剧本创作';

/**
 * 短篇目录结构。
 */
export const SHORT_DIRS = {
    storyCore: '01-故事核',
    outline: '02-分节大纲',
    body: '03-正文',
    review: '04-质检',
    export: '05-导出',
} as const;

/**
 * 剧本目录结构。
 */
export const SCRIPT_DIRS = {
    bible: '01-人物与场景',
    outline: '02-分集大纲',
    body: '03-剧本',
    storyboard: '04-分镜',
    review: '05-质检',
    export: '06-导出',
} as const;

/**
 * 模式单元信息。
 */
export interface ModeUnitInfo {
    unitName: string;
    number: number;
    title: string;
    status: string;
    words: number;
    file: TFile;
    legacy: boolean;
}

/**
 * 模式内容根目录名。
 *
 * @param mode - 模式
 * @returns 目录名
 */
export function modeContentRoot(mode: CreationMode): string {
    if (mode === 'short') return SHORT_CONTENT_ROOT;
    if (mode === 'script') return SCRIPT_CONTENT_ROOT;
    return '03-大纲与章节';
}

/**
 * 模式内容目录。
 * @param project - 项目（路径或对象）
 * @param mode - 模式
 * @returns 文本结果
 */
export function modeContentDir(project: string, mode: CreationMode): string {
    return `${resolveProjectRoot(project)}/${modeContentRoot(mode)}`;
}

/**
 * 模式正文目录。
 * @param project - 项目（路径或对象）
 * @param mode - 模式
 * @returns 文本结果
 */
export function modeBodyDir(project: string, mode: CreationMode): string {
    if (mode === 'short') return `${project}/${SHORT_CONTENT_ROOT}/${SHORT_DIRS.body}`;
    if (mode === 'script') return `${project}/${SCRIPT_CONTENT_ROOT}/${SCRIPT_DIRS.body}`;
    return `${project}/03-大纲与章节/正文`;
}

/**
 * 模式单元单位名（章/节/集）。
 *
 * @param mode - 模式
 * @returns 单位名
 */
export function modeUnitLabel(mode: CreationMode): string {
    return mode === 'short' ? '节' : mode === 'script' ? '集' : '章';
}

/**
 * 单元文件名。
 *
 * @param mode - 模式
 * @param number - 数值
 * @returns 文件名
 */
export function modeUnitFileName(mode: CreationMode, number: number): string {
    const n = String(number).padStart(2, '0');
    return mode === 'short' ? `第${n}节.md` : mode === 'script' ? `第${n}集.md` : `第${n}章_正文.md`;
}

/**
 * 单元展示名。
 *
 * @param number - 数值
 * @param mode - 模式
 * @returns 展示名
 */
export function modeUnitDisplay(number: number, mode: CreationMode): string {
    return `第${number}${modeUnitLabel(mode)}`;
}

/**
 * modeDocPath 函数。
 * @param project - 项目（路径或对象）
 * @param mode - 模式
 * @param doc - 文档
 * @returns 文本结果
 */
export function modeDocPath(project: string, mode: CreationMode, doc: 'storyCore' | 'outline' | 'bible' | 'storyboard'): string {
    if (mode === 'short') {
        if (doc === 'storyCore') return `${project}/${SHORT_CONTENT_ROOT}/${SHORT_DIRS.storyCore}/故事核.md`;
        if (doc === 'outline') return `${project}/${SHORT_CONTENT_ROOT}/${SHORT_DIRS.outline}/分节大纲.md`;
        return `${project}/${SHORT_CONTENT_ROOT}/${SHORT_DIRS.outline}/分节大纲.md`;
    }
    if (doc === 'bible') return `${project}/${SCRIPT_CONTENT_ROOT}/${SCRIPT_DIRS.bible}/场景圣经.md`;
    if (doc === 'outline') return `${project}/${SCRIPT_CONTENT_ROOT}/${SCRIPT_DIRS.outline}/分集大纲.md`;
    if (doc === 'storyboard') return `${project}/${SCRIPT_CONTENT_ROOT}/${SCRIPT_DIRS.storyboard}/分镜表.md`;
    return `${project}/${SCRIPT_CONTENT_ROOT}/${SCRIPT_DIRS.outline}/分集大纲.md`;
}

/**
 * 短篇单元骨架。
 *
 * @param number - 数值
 * @returns Markdown
 */
export function buildShortUnitSkeleton(number: number): string {
    const name = modeUnitDisplay(number, 'short');
    return `---
tags: [短篇正文]
节: "${name}"
status: pending
word_count: 0
---

# ${name}

## 本节目标
- 核心冲突：
- 信息推进：
- 情绪转折：
- 结尾钩子：

正文：
`;
}

/**
 * 剧本单元骨架。
 *
 * @param number - 数值
 * @returns Markdown
 */
export function buildScriptUnitSkeleton(number: number): string {
    const name = modeUnitDisplay(number, 'script');
    return `---
tags: [剧本]
集: "${name}"
status: pending
word_count: 0
---

# ${name}

## 基本信息
- 单集时长：
- 本集核心冲突：
- 本集爽点/反转：
- 结尾钩子：

## 场次

### ${number}-1 日/内 场景名
人物：
△动作/画面：

角色：（情绪）对白

（VO/字幕：）
`;
}

const SHORT_STORY_CORE_STARTER = `# 故事核

> 用一句话锁定：谁 + 要什么 + 被谁阻止 + 反转 + 情绪承诺。

## 一句话故事

## 核心冲突

## 情绪承诺

## 3–5 个反转
1.
2.
3.

## 结尾兑现
`;

const SHORT_OUTLINE_STARTER = `# 分节大纲

> 每节写清：目标 / 冲突 / 信息增量 / 情绪变化 / 反转 / 结尾钩子 / 预计字数。

## 第1节
- 目标：
- 冲突：
- 信息增量：
- 情绪变化：
- 反转：
- 结尾钩子：
- 预计字数：
`;

const SCRIPT_SCENE_BIBLE_STARTER = `# 场景圣经

> 主场景控制在 2–4 个，记录空间、光线、道具、环境声与可拍限制。

## 场景一
- 地点：
- 内/外景：
- 日/夜：
- 关键道具：
- 环境声：
- 可拍限制：
`;

const SCRIPT_OUTLINE_STARTER = `# 分集大纲

> 每集写清：核心冲突 / 情绪升级 / 爽点 / 结尾钩子 / 场次 / 预计秒数。

## 第1集
- 核心冲突：
- 情绪升级：
- 爽点/兑现：
- 结尾钩子：
- 场次数：
- 预计秒数：
`;

const SCRIPT_STORYBOARD_STARTER = `# 分镜表

| 镜号 | 景别 | 角度 | 运镜 | 时长 | 画面 | 动作/表演 | 台词/音效 | 转场 | 目的 |
|---|---|---|---|---|---|---|---|---|---|
| E01-S01-SH01 | 中景 | 平视 | 固定 | 2.5s |  |  |  | 切 |  |
`;

/**
 * 模式文档初始内容。
 *
 * @param project - 项目（路径或对象）
 * @param mode - 模式
 * @param doc - 文档
 * @returns Markdown
 */
export function modeDocStarter(project: string, mode: CreationMode, doc: 'storyCore' | 'outline' | 'bible' | 'storyboard'): string {
    if (mode === 'short') {
        if (doc === 'storyCore') return SHORT_STORY_CORE_STARTER.replace('# 故事核', `# ${project} · 故事核`);
        return SHORT_OUTLINE_STARTER.replace('# 分节大纲', `# ${project} · 分节大纲`);
    }
    if (doc === 'bible') return SCRIPT_SCENE_BIBLE_STARTER.replace('# 场景圣经', `# ${project} · 场景圣经`);
    if (doc === 'outline') return SCRIPT_OUTLINE_STARTER.replace('# 分集大纲', `# ${project} · 分集大纲`);
    return SCRIPT_STORYBOARD_STARTER.replace('# 分镜表', `# ${project} · 分镜表`);
}

/**
 * 创建短篇/剧本独立目录与起始文档（不复制长篇模板）
 *
 * @param adapter - 适配器
 * @param project - 项目（路径或对象）
 * @param mode - 模式
 * @param app - 传入时起始文档走 vault 索引写入（生产路径必须传）
 */
export async function ensureModeContentStructure(
    adapter: DataAdapter,
    project: string,
    mode: CreationMode,
    app?: App
): Promise<void> {
    const writeIfMissing = async (path: string, content: string): Promise<void> => {
        if (await adapter.exists(path)) return;
        if (app) {
            await writeVaultText(app, path, content);
            return;
        }
        const dir = path.substring(0, path.lastIndexOf('/'));
        if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
        // write-entry-allow: 无 App 的测试/兼容分支；生产调用方传 app 走 writeVaultText。
        await adapter.write(path, content);
    };

    if (mode === 'short') {
        const root = modeContentDir(project, 'short');
        for (const dir of Object.values(SHORT_DIRS)) {
            const path = `${root}/${dir}`;
            if (!(await adapter.exists(path))) await adapter.mkdir(path);
        }
        await writeIfMissing(modeDocPath(project, 'short', 'storyCore'), modeDocStarter(project, 'short', 'storyCore'));
        await writeIfMissing(modeDocPath(project, 'short', 'outline'), modeDocStarter(project, 'short', 'outline'));
        return;
    }

    if (mode === 'script') {
        const root = modeContentDir(project, 'script');
        for (const dir of Object.values(SCRIPT_DIRS)) {
            const path = `${root}/${dir}`;
            if (!(await adapter.exists(path))) await adapter.mkdir(path);
        }
        await writeIfMissing(modeDocPath(project, 'script', 'bible'), modeDocStarter(project, 'script', 'bible'));
        await writeIfMissing(modeDocPath(project, 'script', 'outline'), modeDocStarter(project, 'script', 'outline'));
        await writeIfMissing(modeDocPath(project, 'script', 'storyboard'), modeDocStarter(project, 'script', 'storyboard'));
    }
}

function readUnitNumber(file: TFile, mode: CreationMode): number | null {
    const pattern = mode === 'short' ? /第(\d{1,3})节/ : mode === 'script' ? /第(\d{1,3})集/ : /第(\d{1,3})章/;
    const match = file.name.match(pattern) || file.path.match(pattern);
    return match ? parseInt(match[1], 10) : null;
}

function unitInfo(app: App, file: TFile, mode: CreationMode, legacy: boolean): ModeUnitInfo | null {
    const number = readUnitNumber(file, mode);
    if (!number) return null;
    const cache = app.metadataCache.getFileCache(file);
    const title = (cache?.frontmatter?.['标题'] || cache?.frontmatter?.['title'] || '').toString().trim();
    const status = (cache?.frontmatter?.['status'] || '').toString().trim();
    const words = Number(cache?.frontmatter?.['word_count'] || 0);
    return {
        unitName: modeUnitDisplay(number, mode),
        number,
        title,
        status,
        words: Number.isFinite(words) ? words : 0,
        file,
        legacy,
    };
}

/**
 * 读取短篇/剧本正文单元；新结构优先，旧版长篇结构仅作为兼容回退
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param mode - 模式
 * @param files - 可选的仓库文件快照（选择页复用，避免逐项目全库扫描）
 * @returns 结果数组
 */
export function listModeUnits(app: App, project: string, mode: CreationMode, files?: TFile[]): ModeUnitInfo[] {
    if (mode === 'long') return [];
    const dir = modeBodyDir(project, mode);
    const pattern = mode === 'short' ? /第\d{1,3}节\.md$/ : /第\d{1,3}集\.md$/;
    // own 与 legacy 共用同一次全库扫描：own 命中时不跑 legacy，命中语义不变
    const allFiles = files ?? app.vault.getFiles();
    const own = allFiles
        .filter(file => file.path.startsWith(`${dir}/`) && pattern.test(file.name))
        .map(file => unitInfo(app, file, mode, false))
        .filter((item): item is ModeUnitInfo => !!item);

    if (own.length > 0) return own.sort((a, b) => a.number - b.number);

    // 兼容旧短篇/剧本项目：此前写入 03-大纲与章节/正文/第N卷/第N章_正文.md
    const legacyPrefix = `${project}/03-大纲与章节/正文/`;
    const legacy = allFiles
        .filter(file => file.path.startsWith(legacyPrefix) && /第\d+章_正文\.md$/.test(file.name))
        .map(file => {
            const numMatch = file.name.match(/第(\d+)章/);
            if (!numMatch) return null;
            const number = parseInt(numMatch[1], 10);
            const cache = app.metadataCache.getFileCache(file);
            const title = (cache?.frontmatter?.['标题'] || '').toString().trim();
            const status = (cache?.frontmatter?.['status'] || '').toString().trim();
            return {
                unitName: modeUnitDisplay(number, mode),
                number,
                title,
                status,
                words: Number(cache?.frontmatter?.['word_count'] || 0) || 0,
                file,
                legacy: true,
            } as ModeUnitInfo;
        })
        .filter((item): item is ModeUnitInfo => !!item);

    return legacy.sort((a, b) => a.number - b.number);
}

/**
 * 找下一个待写单元。
 *
 * @param units - 单元数
 * @returns 单元或 null
 */
export function findNextModeUnit(units: ModeUnitInfo[]): ModeUnitInfo | null {
    return units.find(unit => unit.status !== 'written' && unit.status !== 'settled') || units[units.length - 1] || null;
}

/**
 * 导出的章节数据（与 engine/export/manuscript-compiler 的输入兼容）
 *
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param mode - 模式
  * @returns string }>> 结果
 */
export async function collectModeManuscript(
    app: App,
    project: string,
    mode: CreationMode
): Promise<Array<{ volume: string; chapter: string; chapterNum: number; title: string; content: string; path: string }>> {
    const units = listModeUnits(app, project, mode);
    const result = [];
    for (const unit of units) {
        const content = await app.vault.read(unit.file);
        result.push({
            volume: '',
            chapter: unit.unitName,
            chapterNum: unit.number,
            title: unit.title,
            content,
            path: unit.file.path,
        });
    }
    return result;
}
