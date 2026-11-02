/**
 * knowledge-to-fingerprint-converter.ts — 知识库 → 写作指纹转换器
 *
 * 功能：将知识库拆解的 6 个维度（风格/节奏/技巧/结构/人设/伏笔）转换为
 *       StyleFingerprint 对象，并入库到项目级指纹库。
 *
 * 依赖：
 * - 风格拆解 Markdown（kbBookStyleFingerprintFile）：提供统计数据 + 特征描述
 * - 其余 5 个维度文件：提供代表性段落样本
 */

import { App } from 'obsidian';
import { StyleFingerprint, StyleFingerprintFeatures } from './style-fingerprint-library';
import {
    kbBookStyleFingerprintFile,
    kbBookRhythmAnalysisFile,
    kbBookWritingTechniquesFile,
    kbBookStructureBreakdownFile,
    kbBookCharacterExtractionFile,
    kbBookForeshadowDBFile,
} from '../shared/paths';
import type { EmbeddingProvider } from './embedding/embedding-provider';
import { getSharedEmbeddingProvider } from './embedding/embedding-service';
import { StyleVectorStore, STYLE_DIMENSIONS, STYLE_DIMENSION_LABELS } from './style-vector-store';
import { createLogger } from '../shared/logger';


const log = createLogger('KnowledgeToFingerprintConverter');
const SAMPLE_MAX_LENGTH = 200;
const SAMPLE_MIN_TOTAL = 15;
const SAMPLE_MAX_TOTAL = 30;
const PER_DIMENSION_SAMPLE_COUNT = 5;

/**
 * KnowledgeToFingerprintConverter 类。
 */
export class KnowledgeToFingerprintConverter {
    private app: App;
    private embeddingClient?: EmbeddingProvider;

    constructor(app: App, embeddingClient?: EmbeddingProvider) {
        this.app = app;
        this.embeddingClient = embeddingClient ?? getSharedEmbeddingProvider() ?? undefined;
    }

    /**
     * 设置向量客户端。
     * @param client - 客户端实例
     */
    setEmbeddingClient(client: EmbeddingProvider): void {
        this.embeddingClient = client;
    }

    /**
     * 将知识库拆解数据转换为写作指纹对象。
     *
     * @param bookId 书籍 ID（保留参数，当前未直接使用）
     * @param bookName 书名（用于定位知识库目录）
     * @param baseDir 知识库根目录，可选
     * @param originalSamples - 原始样本
      * @returns StyleFingerprint 实例
     */
    async convert(bookId: string, bookName: string, baseDir?: string, originalSamples?: string[]): Promise<StyleFingerprint> {
        const styleFilePath = kbBookStyleFingerprintFile(bookName, baseDir);
        const styleContent = await this.readFileSafely(styleFilePath);
        if (styleContent === null) {
            throw new Error('风格维度拆解缺失，无法转换指纹，请先完成风格维度拆解');
        }

        const frontmatter = this.parseFrontmatter(styleContent);
        const stats = this.buildStats(frontmatter);
        const features = this.buildFeatures(styleContent);
        // 只接受真实原文片段。知识库拆解报告里的段落不是 prose，
        // 注入正文 few-shot 会让模型模仿“分析报告腔”。
        const samples = (originalSamples || [])
            .map(s => (s || '').trim())
            .filter(Boolean)
            .slice(0, 20);

        const fingerprint: StyleFingerprint = {
            id: 'fp_kb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10),
            name: `${bookName}（知识库导入）`,
            source: `knowledge-base:${bookName}`,
            scope: 'project',
            enabled: true,
            tags: ['知识库导入', bookName],
            stats,
            features,
            samples,
            extractedAt: Date.now(),
        };

        return fingerprint;
    }

    /**
     * 转换并向量化：将知识库拆解数据转换为写作指纹，
     * 并在 embeddingClient 可用时生成风格向量数据。
     * @param bookId - 书籍 ID
     * @param bookName - 书名
     * @param baseDir - 基础目录
     * @param onProgress - 进度回调
     * @param originalSamples - 原始样本
      * @returns boolean }> 结果
     */
    async convertWithVectors(
        bookId: string,
        bookName: string,
        baseDir?: string,
        onProgress?: (phase: string, percent: number, message: string) => void,
        originalSamples?: string[],
    ): Promise<{ fingerprint: StyleFingerprint; vectorized: boolean }> {
        onProgress?.('parsing', 10, '正在解析知识库数据...');

        const fingerprint = await this.convert(bookId, bookName, baseDir, originalSamples);

        onProgress?.('vectorizing', 60, '正在生成风格向量...');

        let vectorized = false;
        if (this.embeddingClient) {
            try {
                const tempStore = new StyleVectorStore(
                    this.app,
                    'project',
                    this.embeddingClient,
                    'temp_' + bookId
                );
                await tempStore.buildFingerprintVectors(fingerprint.id, fingerprint.features);
                vectorized = true;
                onProgress?.('complete', 100, '风格向量生成完成');
            } catch (e) {
                log.warn('[KnowledgeToFingerprintConverter] 向量化失败:', e);
                onProgress?.('complete', 100, '向量化跳过（向量模型不可用）');
            }
        } else {
            onProgress?.('complete', 100, '转换完成（未向量化）');
        }

        return { fingerprint, vectorized };
    }

    /**
     * 从风格分析结果生成更丰富的特征描述，用于向量化。
     * @param features - 特征集合
      * @returns StyleFingerprintFeatures 实例
     */
    enhanceFeaturesForVectorization(features: StyleFingerprintFeatures): StyleFingerprintFeatures {
        const enhanced = { ...features };

        for (const dim of STYLE_DIMENSIONS) {
            const key = dim as keyof StyleFingerprintFeatures;
            const desc = enhanced[key];
            if (!desc || desc.length < 20) {
                const label = STYLE_DIMENSION_LABELS[dim];
                enhanced[key] = `${label}特征：${desc || '未检测到明显特征'}` as typeof enhanced[typeof key];
            }
        }

        return enhanced;
    }

    // ============================================================
    // 字段映射
    // ============================================================

    /**
     * 从 frontmatter（JSON 结构）中构建 StyleFingerprintStats。
     * frontmatter 由 style-deconstructor 的 buildFrontmatter 生成，
     * 结构为完整的 StyleAnalysisResult 嵌套对象。
     */
    private buildStats(fm: Record<string, any>): StyleFingerprint['stats'] {
        const sentenceRhythm = (fm.sentenceRhythm || {}) as Record<string, any>;
        const paragraphStructure = (fm.paragraphStructure || {}) as Record<string, any>;
        const narrativeStyle = (fm.narrativeStyle || {}) as Record<string, any>;
        const dialogueStyle = (fm.dialogueStyle || {}) as Record<string, any>;
        const stats = (fm.stats || {}) as Record<string, any>;
        const descriptionRatio = (narrativeStyle.descriptionRatio || {}) as Record<string, any>;

        return {
            avgSentenceLength: this.toNumber(sentenceRhythm.avgSentenceLength),
            avgParagraphLength: this.toNumber(paragraphStructure.avgParagraphLength),
            dialogueRatio: this.toNumber(narrativeStyle.dialogueRatio ?? dialogueStyle.dialogueRatio),
            descriptionRatio: this.toNumber(descriptionRatio.total),
            wordCount: this.toNumber(stats.totalChars),
        };
    }

    /**
     * 从 Markdown 正文中提取各维度特征描述。
     */
    private buildFeatures(content: string): StyleFingerprint['features'] {
        return {
            sentenceRhythm: this.extractSection(content, '句式节奏'),
            wordPreference: this.extractSection(content, '用词偏好'),
            narrativeStyle: this.extractSection(content, '叙事特点'),
            rhetoric: this.extractSection(content, '修辞手法'),
            dialogueStyle: this.extractSection(content, '对话风格'),
            paragraphStructure: this.extractSection(content, '段落结构'),
            overallTone: this.extractSection(content, '整体文风'),
        };
    }

    // ============================================================
    // 样本采集
    // ============================================================

    /**
     * 从 6 个维度文件中提取代表性段落。
     * 每个维度提取 PER_DIMENSION_SAMPLE_COUNT 段，去重、截断、限量。
     * 不足 SAMPLE_MIN_TOTAL 段时用风格拆解文件补足。
     */
    private async collectSamples(
        bookName: string,
        baseDir: string | undefined,
        styleContent: string,
    ): Promise<string[]> {
        const dimensionPaths = [
            kbBookStyleFingerprintFile(bookName, baseDir),
            kbBookRhythmAnalysisFile(bookName, baseDir),
            kbBookWritingTechniquesFile(bookName, baseDir),
            kbBookStructureBreakdownFile(bookName, baseDir),
            kbBookCharacterExtractionFile(bookName, baseDir),
            kbBookForeshadowDBFile(bookName, baseDir),
        ];

        const seen = new Set<string>();
        const samples: string[] = [];

        for (const filePath of dimensionPaths) {
            if (samples.length >= SAMPLE_MAX_TOTAL) break;
            const content = await this.readFileSafely(filePath);
            if (content === null) continue;
            const paragraphs = this.extractParagraphs(content, PER_DIMENSION_SAMPLE_COUNT);
            for (const p of paragraphs) {
                const truncated = this.truncateText(p, SAMPLE_MAX_LENGTH);
                if (seen.has(truncated)) continue;
                seen.add(truncated);
                samples.push(truncated);
                if (samples.length >= SAMPLE_MAX_TOTAL) break;
            }
        }

        // 不足下限时用风格拆解文件补足
        if (samples.length < SAMPLE_MIN_TOTAL) {
            const extra = this.extractParagraphs(styleContent, SAMPLE_MAX_TOTAL * 2);
            for (const p of extra) {
                const truncated = this.truncateText(p, SAMPLE_MAX_LENGTH);
                if (seen.has(truncated)) continue;
                seen.add(truncated);
                samples.push(truncated);
                if (samples.length >= SAMPLE_MIN_TOTAL) break;
            }
        }

        return samples.slice(0, SAMPLE_MAX_TOTAL);
    }

    // ============================================================
    // 辅助方法
    // ============================================================

    /**
     * 解析 Markdown frontmatter。风格拆解文件由 saveAnalysisToMarkdown 生成，
     * frontmatter 内容为 JSON 字符串（非标准 YAML key:value）。
     */
    private parseFrontmatter(content: string): Record<string, any> {
        const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (!fmMatch) return {};
        try {
            return JSON.parse(fmMatch[1]) as Record<string, any>;
        } catch {
            return {};
        }
    }

    /**
     * 从 Markdown 正文中提取指定二级章节内容（从 `## title` 到下一个 `## ` 或文末）。
     */
    private extractSection(content: string, sectionTitle: string): string {
        const pattern = new RegExp(`^##\\s+${this.escapeRegExp(sectionTitle)}\\s*\\n([\\s\\S]*?)(?=^##\\s+|$)`, 'm');
        const match = content.match(pattern);
        if (!match) return '';
        return match[1].trim();
    }

    /**
     * 从文本中提取段落：按空行或单换行分割，过滤空段和过短段。
     */
    private extractParagraphs(text: string, maxCount: number): string[] {
        const candidates = text
            .split(/\r?\n\s*\r?\n/)
            .map(p => p.replace(/\r?\n/g, ' ').trim())
            .filter(p => p.length >= 10 && !/^#/.test(p) && !/^\|/.test(p) && !/^-{3,}/.test(p));
        const unique: string[] = [];
        const seen = new Set<string>();
        for (const p of candidates) {
            if (seen.has(p)) continue;
            seen.add(p);
            unique.push(p);
            if (unique.length >= maxCount) break;
        }
        return unique;
    }

    /**
     * 截断文本到指定长度，超出时附加省略号。
     */
    private truncateText(text: string, maxLength: number): string {
        if (text.length <= maxLength) return text;
        return text.slice(0, maxLength - 1) + '…';
    }

    /**
     * 安全读取文件内容，不存在或读取失败返回 null。
     */
    private async readFileSafely(filePath: string): Promise<string | null> {
        try {
            const adapter = this.app.vault.adapter as unknown as {
                exists(p: string): Promise<boolean>;
                read(p: string): Promise<string>;
            };
            if (!(await adapter.exists(filePath))) return null;
            return await adapter.read(filePath);
        } catch {
            return null;
        }
    }

    private toNumber(v: unknown): number {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }

    private escapeRegExp(s: string): string {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
