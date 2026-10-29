/**
 * style-fingerprint-library.ts — 写作指纹库引擎
 *
 * 功能：管理模板、全局和项目级的写作指纹，支持增删改查和向量检索
 * 对应优化方向：风格一致性
 *
 * v2 升级：
 * - 新增 template 层（模板指纹）
 * - 新增 GlobalFingerprintStateStore（项目级全局指纹启用状态）
 * - 新增层间复制和模板同步功能
 * - 新增 v1 → v2 数据迁移（shape: tags/scope）
 * - 新增 V1 → V2 维度迁移（7 维 → 12 维，含备份/回滚）
 */

import { App } from 'obsidian';
import { FileSystemPort, ObsidianFileSystem } from '../shared/file-system-port';
import {
    globalFingerprintsFile,
    globalFingerprintLibraryDir,
    projectFingerprintsFile,
    projectFingerprintLibraryDir,
    templateFingerprintsFile,
    templateFingerprintLibraryDir,
    projectGlobalFingerprintStateFile,
    projectFingerprintIntensityFile,
} from '../shared/paths';
import { SerializedWriter } from '../shared/serialized-writer';
import { StyleVectorStore, type StyleSimilarityResult, type StyleBlendOptions, type StyleInterpolationOptions, type StyleDimension, STYLE_DIMENSIONS } from './style-vector-store';
import type { EmbeddingProvider } from './embedding/embedding-provider';
import { getSharedEmbeddingProvider } from './embedding/embedding-service';
import { vectorizeFingerprintSamples, vectorizeFingerprintSamplesBatch, deleteFingerprintSamples } from './style/style-sample-service';
import {
    migrateFileV1ToV2,
    needsV1ToV2Migration,
} from './style/fingerprint-migrator';
import type { V2Fingerprint, StyleDimensionKeyV2 } from './style/style-dimensions-v2';
import {
    StyleVectorStoreV2,
    type StyleFingerprintVectorsV2,
    type StyleSimilarityResultV2,
    type StyleVectorModelMismatch,
} from './style/style-vector-store-v2';
import { createLogger } from '../shared/logger';
import { extractKeywordTokens } from '../shared/keyword-tokens';

const log = createLogger('StyleFingerprintLibrary');
import {
    FingerprintBlenderV2,
    type BlendSource,
    type BlendOptions,
    type BlendResult,
    type BlendedFingerprint,
} from './style/fingerprint-blender-v2';
import {
    StyleIntensityEngine,
    type StyleIntensityConfig,
    type StyleIntensityPreview,
    DEFAULT_INTENSITY_CONFIG,
} from './style/style-intensity-engine';

export interface StyleFingerprintStats {
    avgSentenceLength: number;
    avgParagraphLength: number;
    dialogueRatio: number;
    descriptionRatio: number;
    wordCount: number;
    /** 句长标准差；旧数据可能缺失 */
    sentenceLengthStdDev?: number;
    /** 短句（<=12 字）占比；旧数据可能缺失 */
    shortSentenceRatio?: number;
    /** 长句（>=30 字）占比；旧数据可能缺失 */
    longSentenceRatio?: number;
    /** 含引号的对话段占比；旧数据可能缺失 */
    dialogueTurnRatio?: number;
    /** 段长标准差；旧数据可能缺失 */
    paragraphLengthStdDev?: number;
    /** 去重字符数 / 总字符数；旧数据可能缺失 */
    lexicalDiversity?: number;
}

/**
 * V1 风格指纹特征（7 维字符串描述）
 * @deprecated V1 类型，保留向后兼容。新代码应使用 V2 的 StyleFingerprintFeaturesV2（12 维结构化）。
 * @see {@link import('./style/style-dimensions-v2').StyleFingerprintFeaturesV2}
 */
export interface StyleFingerprintFeatures {
    sentenceRhythm: string;
    wordPreference: string;
    narrativeStyle: string;
    rhetoric: string;
    dialogueStyle: string;
    paragraphStructure: string;
    overallTone: string;
}

/**
 * V1 风格指纹（7 维特征）
 * @deprecated V1 类型，保留向后兼容。新代码应使用 V2Fingerprint（12 维结构化）。
 * @see {@link import('./style/style-dimensions-v2').V2Fingerprint}
 */
export interface StyleFingerprint {
    id: string;
    name: string;
    source: string;
    scope: 'template' | 'global' | 'project';
    enabled: boolean;
    tags: string[];
    stats: StyleFingerprintStats;
    features: StyleFingerprintFeatures;
    samples: string[];
    extractedAt: number;
    sourceText?: string;
}

export interface VectorStore {
    add(fingerprintId: string, samples: string[]): Promise<void>;
    /** fingerprintId 用于上游过滤已禁用指纹、以及按指纹做多样性筛选；旧实现可不返回 */
    search(query: string, topN?: number): Promise<Array<{ sample: string; score: number; fingerprintId?: string }>>;
    delete(fingerprintId: string): Promise<void>;
}

export interface RefillFingerprintOptions {
    refillFeatures?: boolean;
    refillSamples?: boolean;
    reVectorize?: boolean;
}

export interface SearchSimilarStylesOptions {
    topN?: number;
    minScore?: number;
    dimensionWeights?: Partial<Record<StyleDimension, number>>;
    scopes?: Array<'template' | 'global' | 'project'>;
}

export { StyleVectorStore, StyleSimilarityResult, StyleBlendOptions, StyleInterpolationOptions, StyleDimension, STYLE_DIMENSIONS };

type V1StyleFingerprint = Omit<StyleFingerprint, 'tags' | 'scope'> & { tags?: string[]; scope?: string };

function generateId(): string {
    return 'fp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

export class StyleFingerprintLibrary {
    private app: App;
    private project?: string;
    private fs: FileSystemPort | null = null;
    private templateFingerprints: Map<string, StyleFingerprint> = new Map();
    private globalFingerprints: Map<string, StyleFingerprint> = new Map();
    private projectFingerprints: Map<string, StyleFingerprint> = new Map();
    private globalFingerprintStates: Map<string, Record<string, boolean>> = new Map();

    private templateWriter = new SerializedWriter({ debug: false });
    private globalWriter = new SerializedWriter({ debug: false });
    private projectWriter = new SerializedWriter({ debug: false });
    private globalStateWriter = new SerializedWriter({ debug: false });
    /** 上次加载的指纹文件签名；用于感知其他实例（指纹库 UI）的新增/删除/启停 */
    private fingerprintSignature: string | null = null;

    private styleVectorStoreGlobal?: StyleVectorStore;
    private styleVectorStoreProject?: StyleVectorStore;
    /** V2 12 维向量库（生产接线：按 scope 懒加载） */
    private styleVectorStoreV2Global?: StyleVectorStoreV2;
    private styleVectorStoreV2Project?: StyleVectorStoreV2;
    /**
     * 加载时保留的 V2 12 维指纹。
     * 旧实现把磁盘上的 V2 文件统一转回 V1（只保留 7 维字符串），
     * 导致 12 维特征在内存中直接丢失；这里单独保留一份，供 V2 向量/检索使用。
     */
    private v2Fingerprints: Map<string, V2Fingerprint> = new Map();
    private embeddingClient?: EmbeddingProvider;
    /** V2 多指纹融合引擎（懒加载） */
    private fingerprintBlenderV2?: FingerprintBlenderV2;
    /** V2 风格迁移强度引擎（懒加载） */
    private intensityEngine?: StyleIntensityEngine;
    /** 项目级指纹强度配置（按 projectId 索引，每个项目下 fpId → StyleIntensityConfig） */
    private intensityConfigs: Map<string, Record<string, StyleIntensityConfig>> = new Map();
    /** 强度配置读取失败的项目：禁止以空配置为基线整体保存 */
    private intensityLoadFailures = new Set<string>();
    /** 强度配置序列化写入器 */
    private intensityConfigWriter = new SerializedWriter({ debug: false });

    constructor(app: App, project?: string) {
        this.app = app;
        this.project = project;
        // V2 向量检索依赖 embedding；生产入口不再需要逐个手动 setEmbeddingClient
        const shared = getSharedEmbeddingProvider();
        if (shared) this.setEmbeddingClient(shared);
    }

    setEmbeddingClient(client: EmbeddingProvider): void {
        this.embeddingClient = client;
        this.styleVectorStoreGlobal = undefined;
        this.styleVectorStoreProject = undefined;
        this.styleVectorStoreV2Global = undefined;
        this.styleVectorStoreV2Project = undefined;
    }

    /**
     * 切换活动项目。
     *
     * 项目层的三张表（指纹、V2 缓存、向量库）都跟 project 绑定：
     * 直接改 project 字段会让新项目在 load 之前先读到上一个项目的指纹。
     */
    /** 当前绑定的项目（无项目时为 undefined） */
    get activeProject(): string | undefined {
        return this.project;
    }

    setProject(project?: string): void {
        if (this.project === project) return;
        this.project = project;
        this.projectFingerprints = new Map();
        for (const [id, fp] of this.v2Fingerprints) {
            if (fp.scope === 'project') this.v2Fingerprints.delete(id);
        }
        // 向量库里带旧 project 路径，必须重建
        this.styleVectorStoreProject = undefined;
        this.styleVectorStoreV2Project = undefined;
    }

    private getGlobalStyleVectorStoreV2(): StyleVectorStoreV2 | undefined {
        if (!this.embeddingClient) return undefined;
        if (!this.styleVectorStoreV2Global) {
            this.styleVectorStoreV2Global = new StyleVectorStoreV2(
                this.app,
                'global',
                this.embeddingClient
            );
        }
        return this.styleVectorStoreV2Global;
    }

    private getProjectStyleVectorStoreV2(): StyleVectorStoreV2 | undefined {
        if (!this.embeddingClient || !this.project) return undefined;
        if (!this.styleVectorStoreV2Project) {
            this.styleVectorStoreV2Project = new StyleVectorStoreV2(
                this.app,
                'project',
                this.embeddingClient,
                this.project
            );
        }
        return this.styleVectorStoreV2Project;
    }

    private getStyleVectorStoreV2ForScope(scope: 'template' | 'global' | 'project'): StyleVectorStoreV2 | undefined {
        switch (scope) {
            case 'template':
            case 'global':
                return this.getGlobalStyleVectorStoreV2();
            case 'project':
                return this.getProjectStyleVectorStoreV2();
        }
    }

    private getGlobalStyleVectorStore(): StyleVectorStore | undefined {
        if (!this.embeddingClient) return undefined;
        if (!this.styleVectorStoreGlobal) {
            this.styleVectorStoreGlobal = new StyleVectorStore(
                this.app,
                'global',
                this.embeddingClient
            );
        }
        return this.styleVectorStoreGlobal;
    }

    private getProjectStyleVectorStore(): StyleVectorStore | undefined {
        if (!this.embeddingClient || !this.project) return undefined;
        if (!this.styleVectorStoreProject) {
            this.styleVectorStoreProject = new StyleVectorStore(
                this.app,
                'project',
                this.embeddingClient,
                this.project
            );
        }
        return this.styleVectorStoreProject;
    }

    private getStyleVectorStoreForScope(scope: 'template' | 'global' | 'project'): StyleVectorStore | undefined {
        switch (scope) {
            case 'template':
            case 'global':
                return this.getGlobalStyleVectorStore();
            case 'project':
                return this.getProjectStyleVectorStore();
        }
    }

    private getFS(): FileSystemPort {
        if (!this.fs) {
            this.fs = new ObsidianFileSystem(this.app);
        }
        return this.fs;
    }

    // ============================================================
    // Template 层方法
    // ============================================================

    /**
     * 读取一个指纹文件。
     * - 文件不存在：返回 []（真空库）
     * - 读取/解析失败：损坏文件改名留档后返回 null，调用方保留内存状态。
     *   旧实现直接清空内存映射，下一次 save* 就会用空数组覆盖磁盘 ——
     *   一次瞬时读失败或一个坏字节就能把整库抹掉。
     */
    private async readFingerprintFile(path: string): Promise<unknown[] | null> {
        const fs = this.getFS();
        try {
            const data = await fs.read(path);
            const parsed = JSON.parse(data) as unknown;
            if (Array.isArray(parsed)) {
                return parsed.filter(item => !!item && typeof item === 'object');
            }
            return parsed && typeof parsed === 'object' ? [parsed] : [];
        } catch (e) {
            const exists = await fs.exists(path).catch(() => true);
            if (!exists) return [];
            await fs.rename(path, `${path}.corrupt-${Date.now()}.bak`).catch(() => undefined);
            log.warn(`[StyleFingerprintLibrary] 指纹文件读取失败，已留档待人工恢复: ${path}`, e);
            return null;
        }
    }

    async loadTemplate(): Promise<StyleFingerprint[]> {
        // 自动检测并迁移 V1 → V2 维度（幂等，已迁移则跳过）
        await this.migrateV1ToV2Dimensions('template').catch(() => undefined);

        const parsed = await this.readFingerprintFile(templateFingerprintsFile());
        if (!parsed) return Array.from(this.templateFingerprints.values());

        const items = parsed as (StyleFingerprint | V1StyleFingerprint | V2Fingerprint)[];
        const migrated = items.map(fp => this.migrateFingerprintV1toV2(fp, 'template'));
        this.collectV2Fingerprints(items, 'template');
        this.templateFingerprints = new Map(migrated.map(fp => [fp.id, fp]));
        return Array.from(this.templateFingerprints.values());
    }

    async addTemplate(fp: StyleFingerprint): Promise<void> {
        this.templateFingerprints.set(fp.id, fp);
        await this.saveTemplate();
        await vectorizeFingerprintSamples(this.app, fp, this.project);
    }

    async updateTemplate(fp: StyleFingerprint): Promise<void> {
        if (!this.templateFingerprints.has(fp.id)) return;
        this.templateFingerprints.set(fp.id, fp);
        await this.saveTemplate();
        await vectorizeFingerprintSamples(this.app, fp, this.project);
    }

    /**
     * 指纹删除后清掉它的三类向量索引（V1 维度 / V2 维度 / 样章）。
     * 不清理的话磁盘上会留下库里已不存在的孤儿向量文件，
     * 12 维检索与样章检索仍会命中已删除的指纹。
     */
    private async deleteVectorIndex(
        id: string,
        scope: 'template' | 'global' | 'project',
    ): Promise<void> {
        // 模板层与全局层共用 global 向量目录
        const storeScope: 'global' | 'project' = scope === 'project' ? 'project' : 'global';
        const v1 = storeScope === 'project'
            ? this.getProjectStyleVectorStore()
            : this.getGlobalStyleVectorStore();
        const v2 = storeScope === 'project'
            ? this.getProjectStyleVectorStoreV2()
            : this.getGlobalStyleVectorStoreV2();

        await Promise.all([
            Promise.resolve(v1?.deleteFingerprintVectors(id)).catch(e =>
                log.warn('[StyleFingerprintLibrary] 删除 V1 维度向量失败:', e)),
            Promise.resolve(v2?.deleteVectors(id)).catch(e =>
                log.warn('[StyleFingerprintLibrary] 删除 V2 维度向量失败:', e)),
            deleteFingerprintSamples(this.app, { id, scope }, this.project).catch(e =>
                log.warn('[StyleFingerprintLibrary] 删除样章向量失败:', e)),
        ]);
    }

    async deleteTemplate(id: string): Promise<void> {
        this.templateFingerprints.delete(id);
        this.v2Fingerprints.delete(id);
        await this.saveTemplate();
        await this.deleteVectorIndex(id, 'template');
    }

    getTemplate(id: string): StyleFingerprint | undefined {
        return this.templateFingerprints.get(id);
    }

    listTemplate(): StyleFingerprint[] {
        return Array.from(this.templateFingerprints.values());
    }

    async enableTemplate(id: string): Promise<void> {
        const fp = this.templateFingerprints.get(id);
        if (!fp) return;
        fp.enabled = true;
        await this.saveTemplate();
    }

    async disableTemplate(id: string): Promise<void> {
        const fp = this.templateFingerprints.get(id);
        if (!fp) return;
        fp.enabled = false;
        await this.saveTemplate();
    }

    private async saveTemplate(): Promise<void> {
        await this.templateWriter.enqueueAutoClean(async () => {
            const data = Array.from(this.templateFingerprints.values())
                .map(fp => this.toPersistedFingerprint(fp, 'template'));
            await this.getFS().mkdir(templateFingerprintLibraryDir()).catch(() => undefined);
            await this.getFS().write(templateFingerprintsFile(), JSON.stringify(data, null, 2));
        }).catch(e => {
            log.warn('[StyleFingerprintLibrary] 模板指纹保存失败:', e);
        });
    }

    // ============================================================
    // Global 层方法
    // ============================================================

    async loadGlobal(): Promise<StyleFingerprint[]> {
        // 自动检测并迁移 V1 → V2 维度（幂等，已迁移则跳过）
        await this.migrateV1ToV2Dimensions('global').catch(() => undefined);

        const parsed = await this.readFingerprintFile(globalFingerprintsFile());
        if (!parsed) return Array.from(this.globalFingerprints.values());

        const items = parsed as (StyleFingerprint | V1StyleFingerprint | V2Fingerprint)[];
        const migrated = items.map(fp => this.migrateFingerprintV1toV2(fp, 'global'));
        this.collectV2Fingerprints(items, 'global');
        this.globalFingerprints = new Map(migrated.map(fp => [fp.id, fp]));
        return Array.from(this.globalFingerprints.values());
    }

    async addGlobal(fp: StyleFingerprint): Promise<void> {
        this.globalFingerprints.set(fp.id, fp);
        await this.saveGlobal();
        await vectorizeFingerprintSamples(this.app, fp, this.project);
    }

    async updateGlobal(fp: StyleFingerprint): Promise<void> {
        if (!this.globalFingerprints.has(fp.id)) return;
        this.globalFingerprints.set(fp.id, fp);
        await this.saveGlobal();
        await vectorizeFingerprintSamples(this.app, fp, this.project);
    }

    async deleteGlobal(id: string): Promise<void> {
        this.globalFingerprints.delete(id);
        this.v2Fingerprints.delete(id);
        await this.saveGlobal();
        await this.deleteVectorIndex(id, 'global');
    }

    getGlobal(id: string): StyleFingerprint | undefined {
        return this.globalFingerprints.get(id);
    }

    listGlobal(): StyleFingerprint[] {
        return Array.from(this.globalFingerprints.values());
    }

    async enableGlobal(id: string): Promise<void> {
        const fp = this.globalFingerprints.get(id);
        if (!fp) return;
        fp.enabled = true;
        await this.saveGlobal();
    }

    async disableGlobal(id: string): Promise<void> {
        const fp = this.globalFingerprints.get(id);
        if (!fp) return;
        fp.enabled = false;
        await this.saveGlobal();
    }

    private async saveGlobal(): Promise<void> {
        await this.globalWriter.enqueueAutoClean(async () => {
            const data = Array.from(this.globalFingerprints.values())
                .map(fp => this.toPersistedFingerprint(fp, 'global'));
            await this.getFS().mkdir(globalFingerprintLibraryDir()).catch(() => undefined);
            await this.getFS().write(globalFingerprintsFile(), JSON.stringify(data, null, 2));
        }).catch(e => {
            log.warn('[StyleFingerprintLibrary] 全局指纹保存失败:', e);
        });
    }

    // ============================================================
    // Project 层方法
    // ============================================================

    async loadProject(): Promise<StyleFingerprint[]> {
        if (!this.project) return [];
        // 自动检测并迁移 V1 → V2 维度（幂等，已迁移则跳过）
        await this.migrateV1ToV2Dimensions('project').catch(() => undefined);

        const parsed = await this.readFingerprintFile(projectFingerprintsFile(this.project));
        if (!parsed) return Array.from(this.projectFingerprints.values());

        const items = parsed as (StyleFingerprint | V1StyleFingerprint | V2Fingerprint)[];
        const migrated = items.map(fp => this.migrateFingerprintV1toV2(fp, 'project'));
        this.collectV2Fingerprints(items, 'project');
        this.projectFingerprints = new Map(migrated.map(fp => [fp.id, fp]));
        return Array.from(this.projectFingerprints.values());
    }

    async addProject(fp: StyleFingerprint): Promise<void> {
        if (!this.project) return;
        this.projectFingerprints.set(fp.id, fp);
        await this.saveProject();
        await vectorizeFingerprintSamples(this.app, fp, this.project);
    }

    /**
     * 从知识库导入指纹：强制 scope=project 后委托 addProject 入库。
     */
    async addFromKnowledge(fingerprint: StyleFingerprint): Promise<void> {
        fingerprint.scope = 'project';
        await this.addProject(fingerprint);
    }

    async updateProject(fp: StyleFingerprint): Promise<void> {
        if (!this.project || !this.projectFingerprints.has(fp.id)) return;
        this.projectFingerprints.set(fp.id, fp);
        await this.saveProject();
        await vectorizeFingerprintSamples(this.app, fp, this.project);
    }

    async deleteProject(id: string): Promise<void> {
        if (!this.project) return;
        this.projectFingerprints.delete(id);
        this.v2Fingerprints.delete(id);
        await this.saveProject();
        await this.deleteVectorIndex(id, 'project');
    }

    getProject(id: string): StyleFingerprint | undefined {
        return this.projectFingerprints.get(id);
    }

    listProject(): StyleFingerprint[] {
        return Array.from(this.projectFingerprints.values());
    }

    async enableProject(id: string): Promise<void> {
        const fp = this.projectFingerprints.get(id);
        if (!fp) return;
        fp.enabled = true;
        await this.saveProject();
    }

    async disableProject(id: string): Promise<void> {
        const fp = this.projectFingerprints.get(id);
        if (!fp) return;
        fp.enabled = false;
        await this.saveProject();
    }

    private async saveProject(): Promise<void> {
        if (!this.project) return;
        await this.projectWriter.enqueueAutoClean(async () => {
            const data = Array.from(this.projectFingerprints.values())
                .map(fp => this.toPersistedFingerprint(fp, 'project'));
            await this.getFS().mkdir(projectFingerprintLibraryDir(this.project!)).catch(() => undefined);
            await this.getFS().write(projectFingerprintsFile(this.project!), JSON.stringify(data, null, 2));
        }).catch(e => {
            log.warn('[StyleFingerprintLibrary] 项目指纹保存失败:', e);
        });
    }

    // ============================================================
    // GlobalFingerprintStateStore - 项目级全局指纹启用状态
    // ============================================================

    async loadGlobalState(project?: string): Promise<Record<string, boolean>> {
        const targetProject = project ?? this.project;
        if (!targetProject) return {};
        try {
            const data = await this.getFS().read(projectGlobalFingerprintStateFile(targetProject));
            const state = JSON.parse(data) as Record<string, boolean>;
            this.globalFingerprintStates.set(targetProject, state);
            return state;
        } catch {
            const state: Record<string, boolean> = {};
            this.globalFingerprintStates.set(targetProject, state);
            return state;
        }
    }

    async saveGlobalState(project?: string, state?: Record<string, boolean>): Promise<void> {
        const targetProject = project ?? this.project;
        if (!targetProject) return;
        const targetState = state ?? this.globalFingerprintStates.get(targetProject) ?? {};
        this.globalFingerprintStates.set(targetProject, targetState);
        await this.saveGlobalStateInternal(targetProject, targetState);
    }

    private async saveGlobalStateInternal(project: string, state: Record<string, boolean>): Promise<void> {
        await this.globalStateWriter.enqueueAutoClean(async () => {
            await this.getFS().mkdir(projectFingerprintLibraryDir(project)).catch(() => undefined);
            await this.getFS().write(projectGlobalFingerprintStateFile(project), JSON.stringify(state, null, 2));
        }).catch(e => {
            log.warn('[StyleFingerprintLibrary] 全局指纹状态保存失败:', e);
        });
    }

    isGlobalEnabledForProject(globalFpId: string, project?: string): boolean {
        const targetProject = project ?? this.project;
        if (!targetProject) {
            const fp = this.globalFingerprints.get(globalFpId);
            return fp?.enabled ?? true;
        }
        const state = this.globalFingerprintStates.get(targetProject);
        if (state && globalFpId in state) {
            return state[globalFpId];
        }
        const fp = this.globalFingerprints.get(globalFpId);
        return fp?.enabled ?? true;
    }

    async setGlobalEnabledForProject(globalFpId: string, enabled: boolean, project?: string): Promise<void> {
        const targetProject = project ?? this.project;
        if (!targetProject) return;
        let state = this.globalFingerprintStates.get(targetProject);
        if (!state) {
            state = {};
            this.globalFingerprintStates.set(targetProject, state);
        }
        state[globalFpId] = enabled;
        await this.saveGlobalStateInternal(targetProject, state);
    }

    // ============================================================
    // 风格迁移强度配置持久化（Task 5）
    // ============================================================

    /** 获取强度引擎实例（懒加载） */
    getIntensityEngine(): StyleIntensityEngine {
        if (!this.intensityEngine) {
            this.intensityEngine = new StyleIntensityEngine();
        }
        return this.intensityEngine;
    }

    /**
     * 加载项目级指纹强度配置
     * - 文件不存在时返回空对象（使用默认强度 1.0）
     * - 每次调用都读盘：强度弹窗与协同引擎持有不同的库实例，
     *   缓存会让「弹窗里改完、协同 prompt 仍用旧强度」静默发生
     */
    async loadIntensityConfigs(project?: string): Promise<Record<string, StyleIntensityConfig>> {
        const targetProject = project ?? this.project;
        if (!targetProject) return {};
        const fs = this.getFS();
        const path = projectFingerprintIntensityFile(targetProject);
        // 文件不存在 = 该项目还没配置过强度，是合法状态。
        // 只有「读到了但读/解析失败」才禁止后续整体覆盖。
        let exists = true;
        try {
            exists = await fs.exists(path);
        } catch {
            exists = true;
        }
        if (!exists) {
            this.intensityConfigs.set(targetProject, {});
            this.intensityLoadFailures.delete(targetProject);
            return {};
        }
        try {
            const data = await fs.read(path);
            const parsed = JSON.parse(data) as unknown;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('强度配置不是对象');
            }
            const configs = parsed as Record<string, StyleIntensityConfig>;
            this.intensityConfigs.set(targetProject, configs);
            this.intensityLoadFailures.delete(targetProject);
            return configs;
        } catch (e) {
            // 读失败不能当成「没有强度配置」：
            // 旧实现会缓存空对象，随后 setIntensityConfig 以空对象为基线整体保存，
            // 把其他指纹已保存的强度/禁用状态永久抹掉。
            const cached = this.intensityConfigs.get(targetProject);
            if (cached) {
                log.warn('[StyleFingerprintLibrary] 强度配置读取失败，沿用内存中的现有配置:', e);
                return cached;
            }
            this.intensityLoadFailures.add(targetProject);
            log.warn('[StyleFingerprintLibrary] 强度配置读取失败，本次不缓存空值（避免覆盖磁盘）:', e);
            return {};
        }
    }

    /**
     * 获取指定指纹的强度配置
     * - 未配置时返回默认配置（globalIntensity = 1.0，完全启用）
     */
    getIntensityConfig(fpId: string, project?: string): StyleIntensityConfig {
        const targetProject = project ?? this.project;
        if (!targetProject) return DEFAULT_INTENSITY_CONFIG;
        const configs = this.intensityConfigs.get(targetProject);
        if (configs && fpId in configs) {
            return configs[fpId];
        }
        return DEFAULT_INTENSITY_CONFIG;
    }

    /**
     * 设置指定指纹的强度配置并持久化
     */
    async setIntensityConfig(
        fpId: string,
        config: StyleIntensityConfig,
        project?: string
    ): Promise<void> {
        const targetProject = project ?? this.project;
        if (!targetProject) return;
        // 先合并磁盘上已有的配置：新会话里直接改一个指纹时，
        // 若只写内存里的这一条，会把其他指纹已保存的强度整份覆盖掉
        await this.loadIntensityConfigs(targetProject);
        if (this.intensityLoadFailures.has(targetProject)) {
            // 读都读不到就无法「合并」：宁可保存失败让用户重试，也不能整体覆盖
            throw new Error('强度配置读取失败，本次不保存以免覆盖其他指纹的配置');
        }
        let configs = this.intensityConfigs.get(targetProject);
        if (!configs) {
            configs = {};
            this.intensityConfigs.set(targetProject, configs);
        }
        configs[fpId] = config;
        await this.saveIntensityConfigsInternal(targetProject, configs);
    }

    /**
     * 删除指定指纹的强度配置
     */
    async removeIntensityConfig(fpId: string, project?: string): Promise<void> {
        const targetProject = project ?? this.project;
        if (!targetProject) return;
        // 与 setIntensityConfig 同理：先读盘再删，避免把未加载的其他配置一并抹掉
        await this.loadIntensityConfigs(targetProject);
        const configs = this.intensityConfigs.get(targetProject);
        if (!configs || !(fpId in configs)) return;
        delete configs[fpId];
        await this.saveIntensityConfigsInternal(targetProject, configs);
    }

    /**
     * 预览强度效果（不修改指纹）
     */
    previewIntensity(config: StyleIntensityConfig): StyleIntensityPreview {
        return this.getIntensityEngine().previewIntensity(config);
    }

    private async saveIntensityConfigsInternal(
        project: string,
        configs: Record<string, StyleIntensityConfig>
    ): Promise<void> {
        try {
            await this.intensityConfigWriter.enqueueAutoClean(async () => {
                await this.getFS().mkdir(projectFingerprintLibraryDir(project)).catch(() => undefined);
                await this.getFS().write(
                    projectFingerprintIntensityFile(project),
                    JSON.stringify(configs, null, 2)
                );
            });
        } catch (e) {
            // 不能吞掉：吞掉后调用方仍会弹「已保存」，用户重启才发现设置丢失
            log.warn('[StyleFingerprintLibrary] 强度配置保存失败:', e);
            throw e;
        }
    }

    // ============================================================
    // 层间复制
    // ============================================================

    async copyFingerprint(
        sourceScope: 'template' | 'global' | 'project',
        targetScope: 'template' | 'global' | 'project',
        fpId: string,
        targetProject?: string
    ): Promise<StyleFingerprint | null> {
        const sourceMap = this.getScopeMap(sourceScope);
        const sourceFp = sourceMap.get(fpId);
        if (!sourceFp) return null;

        const newFp: StyleFingerprint = {
            id: generateId(),
            name: sourceFp.name,
            source: sourceFp.source,
            scope: targetScope,
            enabled: true,
            tags: [...sourceFp.tags],
            stats: { ...sourceFp.stats },
            features: { ...sourceFp.features },
            samples: [...(sourceFp.samples || [])],
            extractedAt: Date.now(),
            sourceText: sourceFp.sourceText,
        };

        const effectiveTargetProject = targetProject ?? this.project;
        if (targetScope === 'project' && !effectiveTargetProject) return null;

        // 源指纹是 V2 时把 12 维结构一起带走：只复制 V1 七维字符串，
        // 副本会丢掉逐维样本/量化值，且 blendSource 之类的元数据也没了。
        const sourceV2 = this.v2Fingerprints.get(fpId);
        const v2Copy: V2Fingerprint | null = sourceV2
            ? {
                  ...sourceV2,
                  id: newFp.id,
                  name: newFp.name,
                  scope: targetScope,
                  enabled: true,
                  extractedAt: newFp.extractedAt,
                  features: JSON.parse(JSON.stringify(sourceV2.features)),
                  v1Backup: {
                      features: { ...newFp.features } as unknown as Record<string, string>,
                      extractedAt: newFp.extractedAt,
                      migratedAt: Date.now(),
                  },
              }
            : null;

        // 目标项目 ≠ 当前绑定项目时，必须交给目标项目的实例落盘：
        // 直接写 this.projectFingerprints 会被 saveProject 写到当前项目文件里。
        if (targetScope === 'project' && effectiveTargetProject !== this.project) {
            const target = new StyleFingerprintLibrary(this.app, effectiveTargetProject);
            await target.loadProject();
            if (v2Copy) target.v2Fingerprints.set(newFp.id, v2Copy);
            await target.addProject(newFp);
            return newFp;
        }

        switch (targetScope) {
            case 'template':
                this.templateFingerprints.set(newFp.id, newFp);
                await this.saveTemplate();
                break;
            case 'global':
                this.globalFingerprints.set(newFp.id, newFp);
                await this.saveGlobal();
                break;
            case 'project':
                this.projectFingerprints.set(newFp.id, newFp);
                await this.saveProject();
                break;
        }

        if (v2Copy) this.v2Fingerprints.set(newFp.id, v2Copy);
        await vectorizeFingerprintSamples(this.app, newFp, effectiveTargetProject);

        return newFp;
    }

    private getScopeMap(scope: 'template' | 'global' | 'project'): Map<string, StyleFingerprint> {
        switch (scope) {
            case 'template': return this.templateFingerprints;
            case 'global': return this.globalFingerprints;
            case 'project': return this.projectFingerprints;
        }
    }

    // ============================================================
    // 模板同步
    // ============================================================

    async syncFromTemplate(project?: string): Promise<{ added: string[]; updated: string[]; deleted: string[] }> {
        const targetProject = project ?? this.project;
        if (!targetProject) return { added: [], updated: [], deleted: [] };

        const templateList = this.listTemplate();
        const projectList = this.listProject();
        const projectByName = new Map(projectList.map(fp => [fp.name, fp]));
        const projectById = new Map(projectList.map(fp => [fp.id, fp]));

        const added: string[] = [];
        const updated: string[] = [];
        const deleted: string[] = [];

        for (const tplFp of templateList) {
            const existing = projectByName.get(tplFp.name) ?? projectById.get(tplFp.id);
            if (!existing) {
                const newFp = await this.copyFingerprint('template', 'project', tplFp.id, targetProject);
                if (newFp) {
                    added.push(newFp.id);
                }
            } else if (tplFp.extractedAt > existing.extractedAt) {
                const updatedFp: StyleFingerprint = {
                    ...existing,
                    name: tplFp.name,
                    source: tplFp.source,
                    tags: [...tplFp.tags],
                    stats: { ...tplFp.stats },
                    features: { ...tplFp.features },
                    extractedAt: tplFp.extractedAt,
                    sourceText: tplFp.sourceText,
                };
                this.projectFingerprints.set(existing.id, updatedFp);
                updated.push(existing.id);
            }
        }

        if (updated.length > 0) {
            await this.saveProject();
        }

        return { added, updated, deleted };
    }

    // ============================================================
    // 获取启用的指纹
    // ============================================================

    /**
     * 指纹文件签名（全局指纹 + 项目指纹 + 项目全局启用状态）
     * 文件不可读时返回 null：调用方应保留当前内存状态
     */
    async computeFingerprintSignature(project?: string): Promise<string | null> {
        const target = project ?? this.project;
        const paths = [globalFingerprintsFile()];
        if (target) {
            paths.push(projectFingerprintsFile(target));
            paths.push(projectGlobalFingerprintStateFile(target));
        }
        const parts: string[] = [];
        for (const path of paths) {
            let stamp: { mtime: number; size: number } | null;
            try {
                // 用 getFileStamp 而不是 getFile：全局指纹文件在配置目录里，
                // getAbstractFileByPath 恒为 null → 以前签名永远是 ":missing"，
                // 新增/删除/启停全局指纹都触发不了 reloadIfChanged。
                // 端口未实现时回退到 getFile（测试桩兼容）。
                const fsPort = this.getFS();
                stamp = fsPort.getFileStamp
                    ? await fsPort.getFileStamp(path)
                    : (await fsPort.getFile(path))?.stat ?? null;
            } catch {
                return null;
            }
            parts.push(stamp ? `${path}@${stamp.mtime}:${stamp.size}` : `${path}:missing`);
        }
        return parts.join('|');
    }

    /**
     * 指纹文件变化时重新加载（新增/删除/启用/禁用）
     * 指纹库 UI 与协同引擎各持一个实例，后者的内存列表不会自动更新
     */
    async reloadIfChanged(project?: string): Promise<boolean> {
        const target = project ?? this.project;
        const signature = await this.computeFingerprintSignature(target);
        if (signature === null || signature === this.fingerprintSignature) return false;
        await this.loadGlobal();
        if (target) {
            await this.loadProject();
            await this.loadGlobalState(target);
        }
        this.fingerprintSignature = signature;
        return true;
    }

    async getEnabledFingerprints(project?: string): Promise<StyleFingerprint[]> {
        const targetProject = project ?? this.project;

        const projectEnabled = Array.from(this.projectFingerprints.values())
            .filter(fp => fp.enabled);

        const globalEnabled = Array.from(this.globalFingerprints.values())
            .filter(fp => this.isGlobalEnabledForProject(fp.id, targetProject));

        return [...projectEnabled, ...globalEnabled];
    }

    // ============================================================
    // v1 → v2 数据迁移
    // ============================================================

    /**
     * 保留磁盘上的 V2 12 维特征。
     * `migrateFingerprintV1toV2` 为了兼容 V1 消费方会把内存数据转回 7 维，
     * 这里额外保留原始 V2 数据，避免「加载即降级」。
     */
    /**
     * 保存时决定该条目落盘的形态。
     *
     * 内存里的三张表只持有 V1 投影（7 维字符串），直接写盘会把磁盘上
     * 已有的 V2 12 维特征、逐维样本、量化值全部抹掉——每次 enable/disable
     * 都降级一次。这里在「V2 仍与当前 V1 一致」时写回原 V2 对象，
     * 只让 V1 的可变字段（name/enabled/tags/...）覆盖过去。
     *
     * 若 V1 特征已被重新提取（与 V2 的 7 维投影不一致），说明 V2 过期，
     * 就写 V1，等下次加载重新迁移。
     */
    private toPersistedFingerprint(
        fp: StyleFingerprint,
        scope: 'template' | 'global' | 'project',
    ): StyleFingerprint | V2Fingerprint {
        const v2 = this.v2Fingerprints.get(fp.id);
        if (!v2 || v2.scope !== scope) return fp;

        const projected = this.extractV1FeaturesFromV2(v2.features);
        const same = (Object.keys(projected) as Array<keyof StyleFingerprintFeatures>)
            .every(key => (projected[key] ?? '') === (fp.features?.[key] ?? ''));
        if (!same) return fp;

        return {
            ...v2,
            ...fp,
            version: 'v2',
            // V1 的 7 维字符串不能覆盖 V2 的 12 维结构
            features: v2.features,
        } as unknown as V2Fingerprint;
    }

    private collectV2Fingerprints(items: unknown[], scope?: 'template' | 'global' | 'project'): void {
        // 先清掉同作用域的旧条目：load 会整表替换 V1 映射，
        // 但 V2 缓存此前只增不减，删除的指纹与上个项目的指纹会一直留着，
        // 被 listV2Fingerprints / searchSimilarStylesV2 / rebuildAllV2StyleVectors 读到。
        if (scope) {
            for (const [id, fp] of this.v2Fingerprints) {
                if (fp.scope === scope) this.v2Fingerprints.delete(id);
            }
        }
        for (const item of items) {
            const fp = item as Partial<V2Fingerprint>;
            if (!fp || fp.version !== 'v2' || !fp.id || !fp.features) continue;
            this.v2Fingerprints.set(fp.id, fp as V2Fingerprint);
        }
    }

    /** 获取单个指纹的 V2 12 维特征（不存在时返回 undefined） */
    getV2Fingerprint(id: string): V2Fingerprint | undefined {
        return this.v2Fingerprints.get(id);
    }

    /** 列出已加载的 V2 12 维指纹 */
    listV2Fingerprints(scope?: 'template' | 'global' | 'project'): V2Fingerprint[] {
        const all = Array.from(this.v2Fingerprints.values());
        if (!scope) return all;
        return all.filter(fp => (fp.scope ?? 'global') === scope);
    }

    /**
     * 将加载的指纹数据统一为 V1 StyleFingerprint 格式
     *
     * 处理三种输入：
     * 1. V1 旧格式（无 tags/scope）→ 补全 tags/scope
     * 2. V1 新格式（有 tags/scope）→ 原样返回
     * 3. V2 格式（version='v2' + v1Backup）→ 从 v1Backup 提取 V1 特征
     *
     * 这样保证内存中始终是 V1 StyleFingerprint，向后兼容现有代码。
     * 磁盘上可能是 V2 格式（迁移后），但加载时自动转换回 V1。
     */
    private migrateFingerprintV1toV2(
        fp: StyleFingerprint | V1StyleFingerprint | V2Fingerprint,
        scope: 'template' | 'global' | 'project'
    ): StyleFingerprint {
        // 情况 3：V2 格式 — 从 v1Backup 提取 V1 特征
        const maybeV2 = fp as Partial<V2Fingerprint>;
        if (maybeV2.version === 'v2' && maybeV2.v1Backup) {
            const v2 = maybeV2 as V2Fingerprint;
            const v1Backup = v2.v1Backup!;
            const v1Features = v1Backup.features as unknown as StyleFingerprintFeatures;
            return {
                id: v2.id,
                name: v2.name,
                source: v2.source,
                scope: (v2.scope as StyleFingerprint['scope']) ?? scope,
                enabled: v2.enabled,
                tags: v2.tags ?? [],
                stats: v2.stats as StyleFingerprintStats,
                features: v1Features,
                samples: v2.samples ?? [],
                extractedAt: v2.extractedAt,
                sourceText: v2.sourceText,
            };
        }

        // 情况 1 & 2：V1 格式 — 补全 tags/scope
        const v1 = fp as StyleFingerprint | V1StyleFingerprint;
        const hasTags = 'tags' in v1 && v1.tags !== undefined;
        const hasScope = 'scope' in v1 && v1.scope !== undefined;
        if (hasTags && hasScope) {
            return v1 as StyleFingerprint;
        }
        return {
            ...v1,
            tags: hasTags ? v1.tags! : [],
            scope: hasScope ? (v1.scope as StyleFingerprint['scope']) : scope,
        } as StyleFingerprint;
    }

    /**
     * V1 → V2 维度迁移（文件级，含备份/回滚）
     *
     * 扫描指定作用域的指纹文件：
     * - 检测 V1 格式（无 version 字段或 version='v1'）
     * - 迁移为 V2 格式（12 维结构化）
     * - 写入 .v1.bak 备份文件
     * - 迁移失败自动回滚
     *
     * 幂等：V2 格式文件不会被重复迁移
     *
     * @param scope - 指纹作用域
     * @returns 迁移结果（success=true 表示成功或无需迁移）
     */
    async migrateV1ToV2Dimensions(
        scope?: 'template' | 'global' | 'project'
    ): Promise<{ success: boolean; migrated: number; error?: string }> {
        const fs = this.getFS();
        let totalMigrated = 0;
        const scopes = scope ? [scope] : ['template', 'global', 'project'] as const;

        for (const s of scopes) {
            let filePath: string;
            if (s === 'template') {
                filePath = templateFingerprintsFile();
            } else if (s === 'global') {
                filePath = globalFingerprintsFile();
            } else {
                if (!this.project) continue;
                filePath = projectFingerprintsFile(this.project);
            }

            try {
                if (!(await fs.exists(filePath))) continue;

                // 检测是否需要迁移
                const raw = await fs.read(filePath);
                const parsed = JSON.parse(raw);
                const arr = Array.isArray(parsed) ? parsed : [parsed];
                const needsMigration = arr.some((item: unknown) => needsV1ToV2Migration(item));
                if (!needsMigration) continue;

                // 执行文件级迁移
                const result = await migrateFileV1ToV2(fs, filePath, s);
                if (result.success) {
                    totalMigrated += Array.isArray(parsed) ? parsed.length : 1;
                } else {
                    return { success: false, migrated: totalMigrated, error: result.error };
                }
            } catch (e) {
                log.warn(`[StyleFingerprintLibrary] ${s} 指纹 V1→V2 维度迁移失败:`, e);
            }
        }

        return { success: true, migrated: totalMigrated };
    }

    async migrateV1toV2(): Promise<void> {
        const fs = this.getFS();

        const needsMigration = (arr: (StyleFingerprint | V1StyleFingerprint)[]): boolean => {
            return arr.some(fp => !('tags' in fp) || fp.tags === undefined || !('scope' in fp) || fp.scope === undefined);
        };

        const templatePath = templateFingerprintsFile();
        if (await fs.exists(templatePath)) {
            try {
                const data = await fs.read(templatePath);
                const parsed = JSON.parse(data) as (StyleFingerprint | V1StyleFingerprint)[];
                if (needsMigration(parsed)) {
                    await fs.write(templatePath + '.bak', data);
                    const migrated = parsed.map(fp => this.migrateFingerprintV1toV2(fp, 'template'));
                    await fs.write(templatePath, JSON.stringify(migrated, null, 2));
                    log.info('[StyleFingerprintLibrary] 模板指纹 v1→v2 迁移完成');
                }
            } catch (e) {
                log.warn('[StyleFingerprintLibrary] 模板指纹迁移失败:', e);
            }
        }

        const globalPath = globalFingerprintsFile();
        if (await fs.exists(globalPath)) {
            try {
                const data = await fs.read(globalPath);
                const parsed = JSON.parse(data) as (StyleFingerprint | V1StyleFingerprint)[];
                if (needsMigration(parsed)) {
                    await fs.write(globalPath + '.bak', data);
                    const migrated = parsed.map(fp => this.migrateFingerprintV1toV2(fp, 'global'));
                    await fs.write(globalPath, JSON.stringify(migrated, null, 2));
                    log.info('[StyleFingerprintLibrary] 全局指纹 v1→v2 迁移完成');
                }
            } catch (e) {
                log.warn('[StyleFingerprintLibrary] 全局指纹迁移失败:', e);
            }
        }

        if (this.project) {
            const projectPath = projectFingerprintsFile(this.project);
            if (await fs.exists(projectPath)) {
                try {
                    const data = await fs.read(projectPath);
                    const parsed = JSON.parse(data) as (StyleFingerprint | V1StyleFingerprint)[];
                    if (needsMigration(parsed)) {
                        await fs.write(projectPath + '.bak', data);
                        const migrated = parsed.map(fp => this.migrateFingerprintV1toV2(fp, 'project'));
                        await fs.write(projectPath, JSON.stringify(migrated, null, 2));
                        log.info('[StyleFingerprintLibrary] 项目指纹 v1→v2 迁移完成');
                    }
                } catch (e) {
                    log.warn('[StyleFingerprintLibrary] 项目指纹迁移失败:', e);
                }
            }
        }
    }

    // ============================================================
    // 指纹重新提取
    // ============================================================

    async refillFingerprint(
        fpId: string,
        scope: 'template' | 'global' | 'project',
        options: RefillFingerprintOptions,
        sourceText: string,
        extractor: any,
        vectorStore: any,
        onProgress?: (progress: { phase: string; percent: number; message: string }) => void
    ): Promise<void> {
        const { refillFeatures = true, refillSamples = true, reVectorize = true } = options;

        const fp = this.getFingerprint(fpId, scope);
        if (!fp) {
            throw new Error(`指纹不存在: ${fpId}`);
        }

        onProgress?.({ phase: 'init', percent: 0, message: '初始化重新提取...' });

        if (refillFeatures) {
            onProgress?.({ phase: 'feature-extraction', percent: 10, message: '正在重新提取特征...' });
            
            const features = await extractor.extractFeatures(sourceText, onProgress);
            fp.features = features;
            onProgress?.({ phase: 'feature-extraction', percent: 40, message: '特征提取完成' });
        }

        if (refillSamples) {
            onProgress?.({ phase: 'sample-selection', percent: 45, message: '正在重新采样...' });
            
            const samples = await extractor.selectSamples(sourceText, onProgress);
            fp.samples = samples;
            onProgress?.({ phase: 'sample-selection', percent: 65, message: '采样完成' });
        }

        if (reVectorize) {
            onProgress?.({ phase: 'vectorization', percent: 70, message: '正在重新向量化...' });
            
            await vectorStore.delete(fpId);
            
            if (fp.samples.length > 0) {
                for (let i = 0; i < fp.samples.length; i++) {
                    await vectorStore.add(fpId, [fp.samples[i]]);
                    const percent = 70 + Math.round(((i + 1) / fp.samples.length) * 25);
                    onProgress?.({ 
                        phase: 'vectorization', 
                        percent, 
                        message: `向量化中 (${i + 1}/${fp.samples.length})` 
                    });
                }
            }
            onProgress?.({ phase: 'vectorization', percent: 95, message: '向量化完成' });
        }

        fp.extractedAt = Date.now();

        switch (scope) {
            case 'template':
                await this.updateTemplate(fp);
                break;
            case 'global':
                await this.updateGlobal(fp);
                break;
            case 'project':
                await this.updateProject(fp);
                break;
        }

        onProgress?.({ phase: 'complete', percent: 100, message: '重新提取完成' });
    }

    getFingerprint(fpId: string, scope: 'template' | 'global' | 'project'): StyleFingerprint | undefined {
        const scopeMap = this.getScopeMap(scope);
        return scopeMap.get(fpId);
    }

    // ============================================================
    // 风格向量存储集成
    // ============================================================

    async vectorizeFingerprint(fpId: string, scope: 'template' | 'global' | 'project'): Promise<boolean> {
        const fp = this.getFingerprint(fpId, scope);
        if (!fp) return false;

        const vectorStore = this.getStyleVectorStoreForScope(scope);
        if (!vectorStore) return false;

        try {
            await vectorStore.addFingerprintVectors(fpId, fp.features);
            return true;
        } catch (e) {
            log.warn('[StyleFingerprintLibrary] 指纹向量化失败:', fpId, e);
            return false;
        }
    }

    async getFingerprintVectors(fpId: string, scope: 'template' | 'global' | 'project') {
        const vectorStore = this.getStyleVectorStoreForScope(scope);
        if (!vectorStore) return undefined;
        return vectorStore.getFingerprintVectors(fpId);
    }

    // ============================================================
    // 风格相似度搜索
    // ============================================================

    async searchSimilarStyles(
        query: string | { fingerprintId: string; scope: 'template' | 'global' | 'project' },
        options?: SearchSimilarStylesOptions
    ): Promise<StyleSimilarityResult[]> {
        const scopes = options?.scopes ?? ['template', 'global', 'project'];
        const allFingerprints: StyleFingerprint[] = [];

        if (scopes.includes('template')) {
            allFingerprints.push(...this.listTemplate());
        }
        if (scopes.includes('global')) {
            allFingerprints.push(...this.listGlobal());
        }
        if (scopes.includes('project')) {
            allFingerprints.push(...this.listProject());
        }

        if (allFingerprints.length === 0) return [];

        const globalVectorStore = this.getGlobalStyleVectorStore();
        const projectVectorStore = this.getProjectStyleVectorStore();

        const globalFps = allFingerprints.filter(fp => fp.scope === 'template' || fp.scope === 'global');
        const projectFps = allFingerprints.filter(fp => fp.scope === 'project');

        let results: StyleSimilarityResult[] = [];

        try {
            if (typeof query === 'string') {
                if (globalVectorStore && globalFps.length > 0) {
                    const globalResults = await globalVectorStore.searchSimilarByText(query, globalFps, options);
                    results = results.concat(globalResults);
                }
                if (projectVectorStore && projectFps.length > 0) {
                    const projectResults = await projectVectorStore.searchSimilarByText(query, projectFps, options);
                    results = results.concat(projectResults);
                }
            } else {
                const sourceScope = query.scope;
                const sourceVectorStore = this.getStyleVectorStoreForScope(sourceScope);
                if (!sourceVectorStore) return [];

                const sourceFpsList = sourceScope === 'project' ? projectFps : globalFps;
                const otherFps = sourceScope === 'project' ? globalFps : projectFps;
                const otherVectorStore = sourceScope === 'project' ? globalVectorStore : projectVectorStore;

                const sourceResults = await sourceVectorStore.searchSimilarByFingerprint(
                    query.fingerprintId,
                    sourceFpsList,
                    options
                );
                results = results.concat(sourceResults);

                if (otherVectorStore && otherFps.length > 0) {
                    const sourceFp = sourceFpsList.find(f => f.id === query.fingerprintId);
                    if (sourceFp) {
                        const sourceVectors = await sourceVectorStore.getOrBuildVectors(sourceFp);
                        if (sourceVectors && sourceVectors.overallVector.length > 0) {
                            const queryText = this.buildQueryFromFeatures(sourceFp.features);
                            const otherResults = await otherVectorStore.searchSimilarByText(queryText, otherFps, options);
                            results = results.concat(otherResults);
                        }
                    }
                }
            }
        } catch (e) {
            log.warn('[StyleFingerprintLibrary] 风格相似度搜索失败:', e);
        }

        // Hybrid rerank: vector score + tag/keyword overlap. Pure vector search
        // misses exact style names/tags (e.g. "冷峻克制"), which users expect to
        // rank first.
        const fpById = new Map(allFingerprints.map(fp => [fp.id, fp]));
        const queryText = typeof query === 'string'
            ? query
            : (() => {
                const sourceFp = allFingerprints.find(fp => fp.id === query.fingerprintId);
                return sourceFp ? this.buildQueryFromFeatures(sourceFp.features) : '';
            })();
        const tokens = extractKeywordTokens(queryText, 80);
        const boosted = results.map(result => {
            const fp = fpById.get(result.fingerprintId);
            let boost = 0;
            if (fp && tokens.length > 0) {
                const haystack = `${fp.name} ${fp.source} ${fp.tags.join(' ')} ${this.buildQueryFromFeatures(fp.features)}`.toLowerCase();
                const hits = tokens.filter(token => haystack.includes(token)).length;
                boost += Math.min(0.08, (hits / tokens.length) * 0.08);
                const tagHits = fp.tags.filter(tag => queryText.toLowerCase().includes(tag.toLowerCase())).length;
                boost += Math.min(0.06, tagHits * 0.03);
            }
            return { ...result, overallScore: Math.min(1, result.overallScore + boost) };
        });
        const deduped = new Map<string, StyleSimilarityResult>();
        for (const result of boosted) {
            const existing = deduped.get(result.fingerprintId);
            if (!existing || result.overallScore > existing.overallScore) deduped.set(result.fingerprintId, result);
        }
        results = [...deduped.values()];
        results.sort((a, b) => b.overallScore - a.overallScore);
        return results.slice(0, options?.topN ?? 10);
    }

    // ============================================================
    // V2 12 维检索（生产接线）
    // ============================================================

    /** 收集指定 scope 下的 V2 候选（只包含有 12 维特征的指纹） */
    private collectV2Candidates(
        scopes: Array<'template' | 'global' | 'project'>
    ): Array<{
        id: string;
        name: string;
        scope: 'template' | 'global' | 'project';
        features: V2Fingerprint['features'];
        extractedAt?: number;
    }> {
        const candidates: Array<{
            id: string;
            name: string;
            scope: 'template' | 'global' | 'project';
            features: V2Fingerprint['features'];
            extractedAt?: number;
        }> = [];
        for (const scope of scopes) {
            for (const fp of this.listV2Fingerprints(scope)) {
                candidates.push({
                    id: fp.id,
                    name: fp.name,
                    scope,
                    features: fp.features,
                    extractedAt: fp.extractedAt,
                });
            }
        }
        return candidates;
    }

    /** 按调用方给定的指纹集合收窄候选；不传时保持全量 */
    private filterV2Candidates<T extends { id: string }>(candidates: T[], fingerprintIds?: string[]): T[] {
        if (!fingerprintIds) return candidates;
        const allowed = new Set(fingerprintIds);
        return candidates.filter(candidate => allowed.has(candidate.id));
    }

    /** 获取（必要时构建）指定指纹的 V2 12 维向量 */
    async getFingerprintVectorsV2(
        fpId: string,
        scope: 'template' | 'global' | 'project'
    ): Promise<StyleFingerprintVectorsV2 | undefined> {
        const store = this.getStyleVectorStoreV2ForScope(scope);
        if (!store) return undefined;
        const v2 = this.v2Fingerprints.get(fpId);
        if (!v2?.features) return store.getVectors(fpId);
        return store.getOrBuildVectors(fpId, v2.features, v2.extractedAt);
    }

    /** 强制重建指定指纹的 V2 12 维向量 */
    async buildV2VectorsForFingerprint(
        fpId: string,
        scope: 'template' | 'global' | 'project'
    ): Promise<StyleFingerprintVectorsV2 | undefined> {
        const store = this.getStyleVectorStoreV2ForScope(scope);
        const v2 = this.v2Fingerprints.get(fpId);
        if (!store || !v2?.features) {
            log.warn(`[StyleFingerprintLibrary] 无法重建 V2 向量（缺少 12 维特征）: ${fpId}`);
            return undefined;
        }
        return store.addOrUpdateVectors(fpId, v2.features);
    }

    /** V2 加权整体检索（12 维） */
    async searchSimilarStylesV2(
        query: string,
        options?: {
            topN?: number;
            minScore?: number;
            dimensionWeights?: Partial<Record<StyleDimensionKeyV2, number>>;
            onlyDimensions?: StyleDimensionKeyV2[];
            scopes?: Array<'template' | 'global' | 'project'>;
            /**
             * 只在这些指纹内排名。
             * 位置生成只应排名「已启用」的指纹：禁用指纹与 template 来源库也参与排名时，
             * 会先占满 topN，再与启用集合取交集 → 结果为空后回退全量，注入上限形同虚设。
             */
            fingerprintIds?: string[];
        }
    ): Promise<StyleSimilarityResultV2[]> {
        const scopes = options?.scopes ?? ['template', 'global', 'project'];
        const candidates = this.filterV2Candidates(this.collectV2Candidates(scopes), options?.fingerprintIds);
        if (candidates.length === 0) return [];

        const globalStore = this.getGlobalStyleVectorStoreV2();
        const projectStore = this.getProjectStyleVectorStoreV2();
        const globalCandidates = candidates.filter(c => c.scope !== 'project');
        const projectCandidates = candidates.filter(c => c.scope === 'project');
        const searchOptions = {
            topN: options?.topN,
            minScore: options?.minScore,
            dimensionWeights: options?.dimensionWeights,
            onlyDimensions: options?.onlyDimensions,
        };

        let results: StyleSimilarityResultV2[] = [];
        try {
            if (globalStore && globalCandidates.length > 0) {
                results = results.concat(await globalStore.searchWeighted(query, globalCandidates, searchOptions));
            }
            if (projectStore && projectCandidates.length > 0) {
                results = results.concat(await projectStore.searchWeighted(query, projectCandidates, searchOptions));
            }
        } catch (e) {
            log.warn('[StyleFingerprintLibrary] V2 风格检索失败:', e);
            return [];
        }

        results.sort((a, b) => b.overallScore - a.overallScore);
        return results.slice(0, options?.topN ?? 10);
    }

    /** V2 单维度检索（12 维任选其一） */
    async searchByDimensionV2(
        query: string,
        dimension: StyleDimensionKeyV2,
        options?: {
            topN?: number;
            minScore?: number;
            scopes?: Array<'template' | 'global' | 'project'>;
        }
    ): Promise<StyleSimilarityResultV2[]> {
        const scopes = options?.scopes ?? ['template', 'global', 'project'];
        const candidates = this.collectV2Candidates(scopes);
        if (candidates.length === 0) return [];

        const globalStore = this.getGlobalStyleVectorStoreV2();
        const projectStore = this.getProjectStyleVectorStoreV2();
        const globalCandidates = candidates.filter(c => c.scope !== 'project');
        const projectCandidates = candidates.filter(c => c.scope === 'project');
        const searchOptions = { topN: options?.topN, minScore: options?.minScore };

        let results: StyleSimilarityResultV2[] = [];
        try {
            if (globalStore && globalCandidates.length > 0) {
                results = results.concat(await globalStore.searchByDimension(query, globalCandidates, dimension, searchOptions));
            }
            if (projectStore && projectCandidates.length > 0) {
                results = results.concat(await projectStore.searchByDimension(query, projectCandidates, dimension, searchOptions));
            }
        } catch (e) {
            log.warn('[StyleFingerprintLibrary] V2 单维度检索失败:', e);
            return [];
        }

        results.sort((a, b) => b.overallScore - a.overallScore);
        return results.slice(0, options?.topN ?? 10);
    }

    /**
     * 换 embedding 模型后被隔离、需要重建的 V2 向量。
     * 调用方据此提示用户执行 `rebuildAllV2StyleVectors`。
     */
    async getVectorModelMismatches(
        scope?: 'template' | 'global' | 'project'
    ): Promise<StyleVectorModelMismatch[]> {
        const scopes: Array<'template' | 'global' | 'project'> = scope ? [scope] : ['global', 'project'];
        const mismatches: StyleVectorModelMismatch[] = [];
        for (const s of scopes) {
            const store = this.getStyleVectorStoreV2ForScope(s);
            if (!store) continue;
            try {
                mismatches.push(...await store.reportModelMismatches());
            } catch (e) {
                log.warn('[StyleFingerprintLibrary] 读取 V2 向量模型隔离报告失败:', e);
            }
        }
        return mismatches;
    }

    /** 重建所有带 12 维特征指纹的 V2 向量 */
    async rebuildAllV2StyleVectors(
        onProgress?: (current: number, total: number, fingerprintId: string, scope: string) => void
    ): Promise<{ rebuilt: string[]; failed: string[] }> {
        const v2List = this.listV2Fingerprints();
        const rebuilt: string[] = [];
        const failed: string[] = [];
        let current = 0;

        for (const fp of v2List) {
            current++;
            const scope = (fp.scope ?? 'global') as 'template' | 'global' | 'project';
            onProgress?.(current, v2List.length, fp.id, scope);
            try {
                const result = await this.buildV2VectorsForFingerprint(fp.id, scope);
                if (result) rebuilt.push(fp.id);
                else failed.push(fp.id);
            } catch (e) {
                log.warn(`[StyleFingerprintLibrary] V2 向量重建失败: ${fp.id}`, e);
                failed.push(fp.id);
            }
        }

        return { rebuilt, failed };
    }

    private buildQueryFromFeatures(features: StyleFingerprintFeatures): string {
        const parts: string[] = [];
        for (const dim of STYLE_DIMENSIONS) {
            const desc = features[dim as keyof StyleFingerprintFeatures];
            if (desc) {
                parts.push(desc);
            }
        }
        return parts.join(' ');
    }

    // ============================================================
    // 风格混合与插值
    // ============================================================

    blendStyles(
        fingerprints: Array<{ fingerprint: StyleFingerprint; weight?: number }>,
        options?: StyleBlendOptions
    ): StyleFingerprintFeatures {
        const fps = fingerprints.map(f => f.fingerprint);
        const weights: Record<string, number> = {};

        fingerprints.forEach(f => {
            weights[f.fingerprint.id] = f.weight ?? 1;
        });

        const sampleStore = this.getGlobalStyleVectorStore() ?? this.getProjectStyleVectorStore();
        if (sampleStore) {
            return sampleStore.blendStyles(fps, { weights, ...options });
        }

        if (fps.length === 0) {
            return {
                sentenceRhythm: '',
                wordPreference: '',
                narrativeStyle: '',
                rhetoric: '',
                dialogueStyle: '',
                paragraphStructure: '',
                overallTone: '',
            };
        }

        const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
        const blended: Partial<StyleFingerprintFeatures> = {};

        for (const dim of STYLE_DIMENSIONS) {
            const parts: string[] = [];
            fps.forEach(fp => {
                const desc = fp.features[dim as keyof StyleFingerprintFeatures];
                const w = (weights[fp.id] ?? 1) / totalWeight;
                if (desc && w > 0.1) {
                    parts.push(desc);
                }
            });
            (blended as any)[dim] = parts.join('；');
        }

        return blended as StyleFingerprintFeatures;
    }

    interpolateStyles(
        fpA: StyleFingerprint,
        fpB: StyleFingerprint,
        options?: StyleInterpolationOptions
    ): StyleFingerprintFeatures {
        return this.blendStyles(
            [
                { fingerprint: fpA, weight: 1 - (options?.ratio ?? 0.5) },
                { fingerprint: fpB, weight: options?.ratio ?? 0.5 },
            ]
        );
    }

    generateBlendPrompt(blendedFeatures: StyleFingerprintFeatures): string {
        const sampleStore = this.getGlobalStyleVectorStore() ?? this.getProjectStyleVectorStore();
        if (sampleStore) {
            return sampleStore.generateBlendPrompt(blendedFeatures);
        }

        const dimLabels: Record<string, string> = {
            sentenceRhythm: '句式节奏',
            wordPreference: '用词偏好',
            narrativeStyle: '叙事风格',
            rhetoric: '修辞特点',
            dialogueStyle: '对话风格',
            paragraphStructure: '段落结构',
            overallTone: '整体基调',
        };

        const lines: string[] = ['【融合风格指南】'];
        for (const dim of STYLE_DIMENSIONS) {
            const desc = blendedFeatures[dim as keyof StyleFingerprintFeatures];
            if (desc) {
                lines.push(`${dimLabels[dim]}：${desc}`);
            }
        }
        return lines.join('\n');
    }

    // ============================================================
    // V2 多指纹加权融合（Task 4）
    // ============================================================

    /** 获取 V2 融合引擎（懒加载） */
    private getFingerprintBlenderV2(): FingerprintBlenderV2 {
        if (!this.fingerprintBlenderV2) {
            this.fingerprintBlenderV2 = new FingerprintBlenderV2();
        }
        return this.fingerprintBlenderV2;
    }

    /**
     * 多指纹加权融合（V2 入口）
     *
     * 调用方负责准备 V2Fingerprint 数据（从磁盘加载或迁移）。
     * 融合结果可保存为独立指纹模板（调用 saveBlendedFingerprint）。
     *
     * @param sources 融合来源（1-3 个 V2 指纹 + 权重）
     * @param options 融合选项
     * @returns 融合结果（含 BlendedFingerprint 和可选向量）
     */
    blendFingerprints(
        sources: BlendSource[],
        options?: BlendOptions
    ): BlendResult {
        return this.getFingerprintBlenderV2().blend(sources, options);
    }

    /**
     * 融合预览（不保存，仅计算）
     * 等同于 blendFingerprints，语义上明确"仅预览"
     */
    blendFingerprintsPreview(
        sources: BlendSource[],
        options?: BlendOptions
    ): BlendResult {
        return this.getFingerprintBlenderV2().blend(sources, options);
    }

    /**
     * 将融合指纹保存为独立指纹
     *
     * @param blended 融合结果中的 fingerprint
     * @param scope 目标作用域（默认 'template'）
     * @returns 保存后的指纹（V1 兼容形式），失败返回 null
     */
    async saveBlendedFingerprint(
        blended: BlendedFingerprint,
        scope: 'template' | 'global' | 'project' = 'template'
    ): Promise<StyleFingerprint | null> {
        if (scope === 'project' && !this.project) return null;

        // 将 BlendedFingerprint 转为 V1 兼容形式以复用现有保存逻辑
        const v1Features = this.extractV1FeaturesFromV2(blended.features);
        const v1Fp: StyleFingerprint = {
            id: blended.id,
            name: blended.name,
            source: blended.source,
            scope,
            enabled: true,
            tags: blended.tags,
            stats: blended.stats,
            features: v1Features,
            samples: blended.samples,
            extractedAt: blended.extractedAt,
            sourceText: blended.sourceText,
        };

        // 融合结果本身就是 12 维 V2。注册进 V2 缓存，add* 落盘时才会原样回写
        // 结构化维度与 blendSource；否则只剩 7 维字符串，融合白做。
        // 融合指纹没有 V1 历史，用投影合成 v1Backup 供 V1 消费方还原。
        this.v2Fingerprints.set(blended.id, {
            ...blended,
            scope,
            v1Backup: blended.v1Backup ?? {
                features: v1Features as unknown as Record<string, string>,
                extractedAt: blended.extractedAt,
                migratedAt: Date.now(),
            },
        });

        try {
            switch (scope) {
                case 'template':
                    await this.addTemplate(v1Fp);
                    break;
                case 'global':
                    await this.addGlobal(v1Fp);
                    break;
                case 'project':
                    await this.addProject(v1Fp);
                    break;
            }
            return v1Fp;
        } catch (e) {
            log.warn('[StyleFingerprintLibrary] 保存融合指纹失败:', e);
            return null;
        }
    }

    /**
     * 从 V2 12 维 features 提取 V1 7 维字符串特征（用于 V1 兼容保存）
     * 利用 V1_TO_V2_FIELD_MAP 的反向映射
     */
    private extractV1FeaturesFromV2(features: V2Fingerprint['features']): StyleFingerprintFeatures {
        const v1Features: Partial<StyleFingerprintFeatures> = {};
        // V2 → V1 映射：key 是 V2 维度名，value 是 V1 字段名。
        //
        // 注意解构顺序必须是 [v2Key, v1Key]。曾经写成 [v1Key, v2Key]，
        // 于是拿 V1 字段名去 12 维 V2 对象上查（features.sentenceRhythm），
        // 恒为 undefined → 本函数永远返回 {}，融合结果保存下来没有特征。
        const v2ToV1Map: Record<string, string> = {
            rhythm: 'sentenceRhythm',
            wordChoice: 'wordPreference',
            perspective: 'narrativeStyle',
            rhetoric: 'rhetoric',
            dialogue: 'dialogueStyle',
            narration: 'paragraphStructure',
            languageTexture: 'overallTone',
        };
        for (const [v2Key, v1Key] of Object.entries(v2ToV1Map)) {
            const dim = features[v2Key as keyof typeof features];
            if (dim && typeof dim === 'object' && 'description' in dim) {
                (v1Features as Record<string, string>)[v1Key] = dim.description || '';
            }
        }
        return v1Features as StyleFingerprintFeatures;
    }

    // ============================================================
    // 批量重建向量索引
    // ============================================================

    async rebuildAllStyleVectors(
        onProgress?: (current: number, total: number, fingerprintId: string, scope: string) => void
    ): Promise<void> {
        const globalStore = this.getGlobalStyleVectorStore();
        const projectStore = this.getProjectStyleVectorStore();

        const templateFps = this.listTemplate();
        const globalFps = this.listGlobal();
        const projectFps = this.listProject();

        const total = templateFps.length + globalFps.length + projectFps.length;
        let current = 0;

        if (globalStore) {
            for (const fp of templateFps) {
                current++;
                onProgress?.(current, total, fp.id, 'template');
                try {
                    await globalStore.addFingerprintVectors(fp.id, fp.features);
                } catch (e) {
                    log.warn(`[StyleFingerprintLibrary] 模板指纹向量重建失败: ${fp.id}`, e);
                }
            }
            for (const fp of globalFps) {
                current++;
                onProgress?.(current, total, fp.id, 'global');
                try {
                    await globalStore.addFingerprintVectors(fp.id, fp.features);
                } catch (e) {
                    log.warn(`[StyleFingerprintLibrary] 全局指纹向量重建失败: ${fp.id}`, e);
                }
            }
        }

        if (projectStore) {
            for (const fp of projectFps) {
                current++;
                onProgress?.(current, total, fp.id, 'project');
                try {
                    await projectStore.addFingerprintVectors(fp.id, fp.features);
                } catch (e) {
                    log.warn(`[StyleFingerprintLibrary] 项目指纹向量重建失败: ${fp.id}`, e);
                }
            }
        }

        // 样章向量与特征向量是两套索引：正文 few-shot 依赖样章索引，必须一起重建
        await vectorizeFingerprintSamplesBatch(
            this.app,
            [...templateFps, ...globalFps, ...projectFps],
            this.project,
        );
    }

    // ============================================================
    // 刷新和脏状态
    // ============================================================

    async flush(): Promise<void> {
        await this.templateWriter.flush();
        await this.globalWriter.flush();
        await this.projectWriter.flush();
        await this.globalStateWriter.flush();
        await this.intensityConfigWriter.flush();
    }

    get hasPendingWrites(): boolean {
        return (
            this.templateWriter.isDirty ||
            this.globalWriter.isDirty ||
            this.projectWriter.isDirty ||
            this.globalStateWriter.isDirty ||
            this.intensityConfigWriter.isDirty
        );
    }
}

export { StyleFingerprintLibrary as FingerprintLibraryManager };
