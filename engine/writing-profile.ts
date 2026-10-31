import { App, parseYaml, stringifyYaml } from 'obsidian';
import { FileSystemPort, ObsidianFileSystem } from '../shared/file-system-port';
import { createLogger } from '../shared/logger';


import type { CreationMode } from '../shared/creation-mode';

const log = createLogger('WritingProfile');
export interface GenreConfig {
    primary: string;
    secondary?: string[];
    tags: string[];
}

export interface StyleConfig {
    primaryStyle: string;
    secondaryStyle?: string;
    perspective: 'first_person' | 'third_person_omniscient' | 'third_person_limited';
    sentenceRhythm?: string;
    formalityLevel: number;
}

export interface RhythmConfig {
    pace: 'fast' | 'medium' | 'slow';
    pacingPattern: string;
    chapterTargetWords: number;
    climaxFrequency: string;
}

export interface TechniquesConfig {
    enabled: string[];
    disabled: string[];
    dialogueRatio?: number;
    descriptionRatio?: number;
}

export interface FingerprintConfig {
    /**
     * 模板层继承的指纹 id。
     * 注意：指纹启用状态的唯一真相源是指纹库（`StyleFingerprintLibrary#listProject` /
     * `isGlobalEnabledForProject`），画像里不再保存 enabledProject / enabledGlobal 副本。
     */
    templateInherited: string[];
    injectionStrength: number;
}

export interface ConsistencyConfig {
    characterCheck: boolean;
    foreshadowCheck: boolean;
    rhythmCheck: boolean;
}

export interface WritingProfile {
    projectName: string;
    projectType: 'original' | 'fanfic';
    /** v4.18: 创作模式；旧配置缺失时按 long 兼容 */
    creationMode?: CreationMode;
    shortCategory?: string;
    scriptGenre?: string;
    targetWords?: number;
    targetUnits?: number;
    createdAt: string;
    updatedAt: string;
    genre: GenreConfig;
    style: StyleConfig;
    rhythm: RhythmConfig;
    techniques: TechniquesConfig;
    fingerprint: FingerprintConfig;
    customRules: string[];
    consistency: ConsistencyConfig;
    version: number;
}

const CONFIG_FILE_NAME = '写作配置.md';
const CURRENT_VERSION = 1;

const BODY_TEMPLATE = `# 写作配置

本文件由插件自动生成，记录本项目的写作偏好配置。
可以手动修改，但建议通过插件设置界面调整。
`;

interface GenreDefaults {
    pace: 'fast' | 'medium' | 'slow';
    pacingPattern: string;
    chapterTargetWords: number;
    perspective: 'first_person' | 'third_person_omniscient' | 'third_person_limited';
    primaryStyle: string;
    climaxFrequency: string;
}

const GENRE_DEFAULTS: Record<string, GenreDefaults> = {
    '玄幻': {
        pace: 'fast',
        pacingPattern: '升级流模式',
        chapterTargetWords: 3000,
        perspective: 'third_person_omniscient',
        primaryStyle: '热血爽文风',
        climaxFrequency: '每3-5章一个小高潮，每10-15章一个大高潮',
    },
    '都市': {
        pace: 'medium',
        pacingPattern: '职场/商战模式',
        chapterTargetWords: 2500,
        perspective: 'third_person_limited',
        primaryStyle: '简洁写实风',
        climaxFrequency: '每5-8章一个小高潮，每15-20章一个大高潮',
    },
    '言情': {
        pace: 'slow',
        pacingPattern: '情感递进模式',
        chapterTargetWords: 2000,
        perspective: 'third_person_limited',
        primaryStyle: '细腻情感风',
        climaxFrequency: '每4-6章一个情感高潮，每10-15章一个重大转折',
    },
    '历史': {
        pace: 'medium',
        pacingPattern: '权谋推进模式',
        chapterTargetWords: 3000,
        perspective: 'third_person_omniscient',
        primaryStyle: '厚重沉稳风',
        climaxFrequency: '每5-8章一个小高潮，每12-18章一个大高潮',
    },
    '科幻': {
        pace: 'fast',
        pacingPattern: '探索推进模式',
        chapterTargetWords: 3000,
        perspective: 'third_person_omniscient',
        primaryStyle: '硬核想象风',
        climaxFrequency: '每3-5章一个小高潮，每10-15章一个大高潮',
    },
    '悬疑': {
        pace: 'medium',
        pacingPattern: '探案推进模式',
        chapterTargetWords: 2500,
        perspective: 'third_person_limited',
        primaryStyle: '紧张悬疑风',
        climaxFrequency: '每2-4章一个小转折，每8-12章一个真相揭晓',
    },
    '武侠': {
        pace: 'fast',
        pacingPattern: '江湖恩怨模式',
        chapterTargetWords: 3000,
        perspective: 'third_person_omniscient',
        primaryStyle: '快意江湖风',
        climaxFrequency: '每3-5章一个小高潮，每10-15章一个大高潮',
    },
    '游戏': {
        pace: 'fast',
        pacingPattern: '升级通关模式',
        chapterTargetWords: 3000,
        perspective: 'third_person_omniscient',
        primaryStyle: '轻松爽文风',
        climaxFrequency: '每2-4章一个关卡高潮，每8-12章一个大BOSS战',
    },
};

const DEFAULT_GENRE: GenreDefaults = {
    pace: 'medium',
    pacingPattern: '标准叙事模式',
    chapterTargetWords: 2500,
    perspective: 'third_person_omniscient',
    primaryStyle: '简洁文风',
    climaxFrequency: '每5-8章一个小高潮，每15-20章一个大高潮',
};

export class WritingProfileManager {
    private app: App;
    private cache: WritingProfile | null;
    private fs: FileSystemPort | null = null;

    /** 读盘解析失败标记：为 true 时首次保存先留档，避免用默认值覆盖用户配置 */
    private loadFailed = false;
    private loadFailedPath = '';

    constructor(app: App, fs?: FileSystemPort) {
        this.app = app;
        this.cache = null;
        this.fs = fs ?? null;
    }

    private getFS(): FileSystemPort {
        if (!this.fs) {
            this.fs = new ObsidianFileSystem(this.app);
        }
        return this.fs;
    }

    static getConfigFilePath(projectPath: string): string {
        return `${projectPath}/${CONFIG_FILE_NAME}`;
    }

    /**
     * 读取写作配置。
     * P1-10（v4.27）：旧实现把「文件不存在」与「解析失败」都吞成默认值，随后任何 save
     * 都会用默认值覆盖用户配置。现在区分两者：解析失败置 loadFailed，保存前先留档。
     */
    async load(projectPath: string): Promise<WritingProfile> {
        const filePath = WritingProfileManager.getConfigFilePath(projectPath);
        let content: string;
        try {
            content = await this.getFS().read(filePath);
        } catch {
            // 文件不存在属正常（首次使用），不标记失败
            this.loadFailed = false;
            this.loadFailedPath = '';
            const defaultProfile = this.getEmptyProfile();
            this.cache = defaultProfile;
            return defaultProfile;
        }
        const profile = this.parseProfile(content);
        if (profile) {
            this.cache = profile;
            this.loadFailed = false;
            this.loadFailedPath = '';
            return profile;
        }
        this.loadFailed = true;
        this.loadFailedPath = filePath;
        log.warn('[WritingProfileManager] 配置解析失败，已标记待留档（保存前会备份原文件）:', filePath);
        const defaultProfile = this.getEmptyProfile();
        this.cache = defaultProfile;
        return defaultProfile;
    }

    async save(projectPath: string, profile: WritingProfile): Promise<void> {
        const filePath = WritingProfileManager.getConfigFilePath(projectPath);
        if (this.loadFailed && this.loadFailedPath === filePath) {
            // 解析失败后的首次保存：先留档原文件，再写新配置
            try {
                const existing = await this.getFS().read(filePath);
                await this.getFS().write(`${filePath}.bak-${Date.now()}`, existing);
                log.warn('[WritingProfileManager] 原配置解析失败，已留档备份:', filePath);
            } catch (e) {
                log.warn('[WritingProfileManager] 原配置留档失败（继续保存）:', e);
            }
            this.loadFailed = false;
            this.loadFailedPath = '';
        }
        try {
            profile.updatedAt = new Date().toISOString();
            const content = this.serializeProfile(profile);
            await this.getFS().write(filePath, content);
            this.cache = { ...profile };
        } catch (e) {
            log.warn('[WritingProfileManager] 保存配置失败:', e);
            throw e;
        }
    }

    generateDefault(
        genre: string,
        projectName: string,
        projectType: 'original' | 'fanfic' = 'original'
    ): WritingProfile {
        const defaults = GENRE_DEFAULTS[genre] || DEFAULT_GENRE;
        const now = new Date().toISOString();

        return {
            projectName,
            projectType,
            createdAt: now,
            updatedAt: now,
            genre: {
                primary: genre,
                secondary: [],
                tags: [genre],
            },
            style: {
                primaryStyle: defaults.primaryStyle,
                perspective: defaults.perspective,
                formalityLevel: 0.5,
            },
            rhythm: {
                pace: defaults.pace,
                pacingPattern: defaults.pacingPattern,
                chapterTargetWords: defaults.chapterTargetWords,
                climaxFrequency: defaults.climaxFrequency,
            },
            techniques: {
                enabled: [],
                disabled: [],
                dialogueRatio: 0.4,
                descriptionRatio: 0.3,
            },
            fingerprint: {
                templateInherited: [],
                injectionStrength: 0.5,
            },
            customRules: [],
            consistency: {
                characterCheck: true,
                foreshadowCheck: true,
                rhythmCheck: true,
            },
            version: CURRENT_VERSION,
        };
    }

    async updateField(projectPath: string, fieldPath: string, value: any): Promise<void> {
        const profile = await this.load(projectPath);
        this.setNestedValue(profile, fieldPath, value);
        await this.save(projectPath, profile);
    }

    async exists(projectPath: string): Promise<boolean> {
        const filePath = WritingProfileManager.getConfigFilePath(projectPath);
        try {
            return await this.getFS().exists(filePath);
        } catch {
            return false;
        }
    }

    getEmptyProfile(projectName: string = '未命名项目'): WritingProfile {
        const now = new Date().toISOString();
        return {
            projectName,
            projectType: 'original',
            createdAt: now,
            updatedAt: now,
            genre: {
                primary: '',
                secondary: [],
                tags: [],
            },
            style: {
                primaryStyle: '简洁文风',
                perspective: 'third_person_omniscient',
                formalityLevel: 0.5,
            },
            rhythm: {
                pace: 'medium',
                pacingPattern: '标准叙事模式',
                chapterTargetWords: 2500,
                climaxFrequency: '每5-8章一个小高潮',
            },
            techniques: {
                enabled: [],
                disabled: [],
                dialogueRatio: 0.4,
                descriptionRatio: 0.3,
            },
            fingerprint: {
                templateInherited: [],
                injectionStrength: 0.5,
            },
            customRules: [],
            consistency: {
                characterCheck: true,
                foreshadowCheck: true,
                rhythmCheck: true,
            },
            version: CURRENT_VERSION,
        };
    }

    /**
     * 解析配置；结构非法返回 null（v4.27，P1-10）。
     * 旧实现把解析失败也返回空配置，调用方无法区分「文件不存在」与「文件坏了」，
     * 于是 save 会用默认值覆盖用户配置。
     */
    private parseProfile(content: string): WritingProfile | null {
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!fmMatch) return null;

        try {
            const fmData = parseYaml(fmMatch[1]) as Record<string, any>;
            if (!fmData || typeof fmData !== 'object') return null;
            return this.normalizeProfile(fmData);
        } catch {
            return null;
        }
    }

    private serializeProfile(profile: WritingProfile): string {
        const fmYaml = stringifyYaml(profile as any).trim();
        return `---\n${fmYaml}\n---\n\n${BODY_TEMPLATE}`;
    }

    private normalizeProfile(data: Record<string, any>): WritingProfile {
        const empty = this.getEmptyProfile(data.projectName || '未命名项目');

        return {
            projectName: typeof data.projectName === 'string' ? data.projectName : empty.projectName,
            projectType: data.projectType === 'fanfic' ? 'fanfic' : 'original',
            creationMode: data.creationMode === 'short' || data.creationMode === 'script' ? data.creationMode : 'long',
            shortCategory: typeof data.shortCategory === 'string' ? data.shortCategory : '',
            scriptGenre: typeof data.scriptGenre === 'string' ? data.scriptGenre : '',
            targetWords: typeof data.targetWords === 'number' && data.targetWords > 0 ? data.targetWords : undefined,
            targetUnits: typeof data.targetUnits === 'number' && data.targetUnits > 0 ? data.targetUnits : undefined,
            createdAt: typeof data.createdAt === 'string' ? data.createdAt : empty.createdAt,
            updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : empty.updatedAt,
            genre: this.normalizeGenre(data.genre, empty.genre),
            style: this.normalizeStyle(data.style, empty.style),
            rhythm: this.normalizeRhythm(data.rhythm, empty.rhythm),
            techniques: this.normalizeTechniques(data.techniques, empty.techniques),
            fingerprint: this.normalizeFingerprint(data.fingerprint, empty.fingerprint),
            customRules: Array.isArray(data.customRules) ? data.customRules.filter((x: any) => typeof x === 'string') : [],
            consistency: this.normalizeConsistency(data.consistency, empty.consistency),
            version: typeof data.version === 'number' ? data.version : CURRENT_VERSION,
        };
    }

    private normalizeGenre(data: any, fallback: GenreConfig): GenreConfig {
        if (!data || typeof data !== 'object') return fallback;
        return {
            primary: typeof data.primary === 'string' ? data.primary : fallback.primary,
            secondary: Array.isArray(data.secondary)
                ? data.secondary.filter((x: any) => typeof x === 'string')
                : fallback.secondary,
            tags: Array.isArray(data.tags)
                ? data.tags.filter((x: any) => typeof x === 'string')
                : fallback.tags,
        };
    }

    private normalizeStyle(data: any, fallback: StyleConfig): StyleConfig {
        if (!data || typeof data !== 'object') return fallback;
        const validPerspectives = ['first_person', 'third_person_omniscient', 'third_person_limited'];
        const perspective = validPerspectives.includes(data.perspective)
            ? data.perspective as StyleConfig['perspective']
            : fallback.perspective;
        return {
            primaryStyle: typeof data.primaryStyle === 'string' ? data.primaryStyle : fallback.primaryStyle,
            secondaryStyle: typeof data.secondaryStyle === 'string' ? data.secondaryStyle : fallback.secondaryStyle,
            perspective,
            sentenceRhythm: typeof data.sentenceRhythm === 'string' ? data.sentenceRhythm : fallback.sentenceRhythm,
            formalityLevel: typeof data.formalityLevel === 'number'
                ? Math.max(0, Math.min(1, data.formalityLevel))
                : fallback.formalityLevel,
        };
    }

    private normalizeRhythm(data: any, fallback: RhythmConfig): RhythmConfig {
        if (!data || typeof data !== 'object') return fallback;
        const validPaces = ['fast', 'medium', 'slow'];
        const pace = validPaces.includes(data.pace)
            ? data.pace as RhythmConfig['pace']
            : fallback.pace;
        return {
            pace,
            pacingPattern: typeof data.pacingPattern === 'string' ? data.pacingPattern : fallback.pacingPattern,
            chapterTargetWords: typeof data.chapterTargetWords === 'number'
                ? Math.max(500, Math.min(20000, Math.floor(data.chapterTargetWords)))
                : fallback.chapterTargetWords,
            climaxFrequency: typeof data.climaxFrequency === 'string' ? data.climaxFrequency : fallback.climaxFrequency,
        };
    }

    private normalizeTechniques(data: any, fallback: TechniquesConfig): TechniquesConfig {
        if (!data || typeof data !== 'object') return fallback;
        return {
            enabled: Array.isArray(data.enabled)
                ? data.enabled.filter((x: any) => typeof x === 'string')
                : fallback.enabled,
            disabled: Array.isArray(data.disabled)
                ? data.disabled.filter((x: any) => typeof x === 'string')
                : fallback.disabled,
            dialogueRatio: typeof data.dialogueRatio === 'number'
                ? Math.max(0, Math.min(1, data.dialogueRatio))
                : fallback.dialogueRatio,
            descriptionRatio: typeof data.descriptionRatio === 'number'
                ? Math.max(0, Math.min(1, data.descriptionRatio))
                : fallback.descriptionRatio,
        };
    }

    private normalizeFingerprint(data: any, fallback: FingerprintConfig): FingerprintConfig {
        if (!data || typeof data !== 'object') return fallback;
        // 旧画像里的 enabledProject / enabledGlobal 直接忽略：启用状态只认指纹库
        return {
            templateInherited: Array.isArray(data.templateInherited)
                ? data.templateInherited.filter((x: any) => typeof x === 'string')
                : fallback.templateInherited,
            injectionStrength: typeof data.injectionStrength === 'number'
                ? Math.max(0.1, Math.min(1.0, data.injectionStrength))
                : fallback.injectionStrength,
        };
    }

    private normalizeConsistency(data: any, fallback: ConsistencyConfig): ConsistencyConfig {
        if (!data || typeof data !== 'object') return fallback;
        return {
            characterCheck: typeof data.characterCheck === 'boolean' ? data.characterCheck : fallback.characterCheck,
            foreshadowCheck: typeof data.foreshadowCheck === 'boolean' ? data.foreshadowCheck : fallback.foreshadowCheck,
            rhythmCheck: typeof data.rhythmCheck === 'boolean' ? data.rhythmCheck : fallback.rhythmCheck,
        };
    }

    private setNestedValue(obj: any, path: string, value: any): void {
        const keys = path.split('.');
        let current = obj;
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!current[key] || typeof current[key] !== 'object') {
                current[key] = {};
            }
            current = current[key];
        }
        current[keys[keys.length - 1]] = value;
    }
}
