/**
 * fingerprint-migrator.test.ts — V1→V2 写作指纹迁移工具单元测试
 *
 * 覆盖范围（按用户原始要求）：
 * 1. V2 数据结构类型正确（12 维全部存在，每维有 status 字段）
 * 2. V1→V2 映射正确（7 个 V1 字符串字段映射到 V2 对应维度的 description）
 * 3. 缺失维度标记为 pending（5 个新增维度 status='pending'）
 * 4. 迁移前备份（.v1.bak 文件生成）
 * 5. 迁移失败回滚（从备份恢复原文件）
 * 6. 迁移耗时 < 50ms
 * 7. V1 API 兼容（V2 格式加载后能保留 V1 备份数据）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFileSystem } from '../../../../shared/file-system-port';
import {
    migrateV1ToV2,
    migrateFileV1ToV2,
    needsV1ToV2Migration,
    rollbackV2ToV1,
    getPendingDimensions,
    getCompleteDimensions,
    validateV2Fingerprint,
    getDimensionStatusSummary,
    getV2DimensionForV1Field,
    isV2DimensionNew,
    type V1StyleFingerprint,
    type V1StyleFingerprintFeatures,
} from '../../../../engine/style/fingerprint-migrator';
import {
    STYLE_DIMENSIONS_V2,
    STYLE_DIMENSION_KEYS_V2,
    STYLE_DIMENSION_LABELS_V2,
    V1_TO_V2_FIELD_MAP,
    V2_NEW_DIMENSIONS,
    V2_DIMENSION_COUNT,
    type V2Fingerprint,
    type StyleFingerprintFeaturesV2,
    type StyleDimensionKeyV2,
    type V1FingerprintBackup,
} from '../../../../engine/style/style-dimensions-v2';

// ============================================================
// 测试夹具工厂
// ============================================================

function makeV1Features(overrides: Partial<V1StyleFingerprintFeatures> = {}): V1StyleFingerprintFeatures {
    return {
        sentenceRhythm: '短句为主，节奏紧凑，多用逗号分割',
        wordPreference: '常用词为主，偶尔出现古风词汇',
        narrativeStyle: '第三人称限制视角，贴近主角内心',
        rhetoric: '比喻密集，偶有拟人和夸张',
        dialogueStyle: '对话简练，台词个性化强',
        paragraphStructure: '段落短小，单句成段频繁',
        overallTone: '语言质感偏书面化，带有古风韵味',
        ...overrides,
    };
}

function makeV1Fingerprint(overrides: Partial<V1StyleFingerprint> = {}): V1StyleFingerprint {
    return {
        id: 'fp_test_001',
        name: '测试指纹',
        source: '测试源文本',
        scope: 'global',
        enabled: true,
        tags: ['测试', '示例'],
        stats: {
            avgSentenceLength: 15.5,
            avgParagraphLength: 45.2,
            dialogueRatio: 0.35,
            descriptionRatio: 0.25,
            wordCount: 10000,
        },
        features: makeV1Features(),
        samples: ['示例样本一', '示例样本二'],
        extractedAt: 1700000000000,
        ...overrides,
    };
}

// ============================================================
// 测试用例
// ============================================================

describe('fingerprint-migrator', () => {

    // ============================================================
    // 1. V2 数据结构类型正确
    // ============================================================
    describe('V2 数据结构类型', () => {
        it('STYLE_DIMENSIONS_V2 应包含 12 个维度', () => {
            expect(STYLE_DIMENSIONS_V2).toHaveLength(12);
            expect(V2_DIMENSION_COUNT).toBe(12);
        });

        it('每个维度元信息字段完整（key/name/icon/description/fromV1）', () => {
            for (const dim of STYLE_DIMENSIONS_V2) {
                expect(typeof dim.key).toBe('string');
                expect(typeof dim.name).toBe('string');
                expect(typeof dim.icon).toBe('string');
                expect(typeof dim.description).toBe('string');
                expect(typeof dim.fromV1).toBe('boolean');
            }
        });

        it('STYLE_DIMENSION_KEYS_V2 与 STYLE_DIMENSIONS_V2 一致', () => {
            expect(STYLE_DIMENSION_KEYS_V2).toHaveLength(12);
            const keysFromMeta = STYLE_DIMENSIONS_V2.map(d => d.key);
            const keysFromConst = [...STYLE_DIMENSION_KEYS_V2];
            expect(keysFromConst.sort()).toEqual(keysFromMeta.sort());
        });

        it('STYLE_DIMENSION_LABELS_V2 包含全部 12 个中文名', () => {
            const labels = Object.keys(STYLE_DIMENSION_LABELS_V2);
            expect(labels).toHaveLength(12);
            for (const label of Object.values(STYLE_DIMENSION_LABELS_V2)) {
                expect(typeof label).toBe('string');
                expect(label.length).toBeGreaterThan(0);
            }
        });

        it('V2_NEW_DIMENSIONS 应为 5 个新增维度', () => {
            expect(V2_NEW_DIMENSIONS).toHaveLength(5);
            expect(V2_NEW_DIMENSIONS).toContain('sentencePattern');
            expect(V2_NEW_DIMENSIONS).toContain('emotion');
            expect(V2_NEW_DIMENSIONS).toContain('tension');
            expect(V2_NEW_DIMENSIONS).toContain('infoDensity');
            expect(V2_NEW_DIMENSIONS).toContain('description');
        });

        it('V1_TO_V2_FIELD_MAP 应包含 7 个 V1→V2 映射', () => {
            expect(Object.keys(V1_TO_V2_FIELD_MAP)).toHaveLength(7);
            expect(V1_TO_V2_FIELD_MAP.sentenceRhythm).toBe('rhythm');
            expect(V1_TO_V2_FIELD_MAP.wordPreference).toBe('wordChoice');
            expect(V1_TO_V2_FIELD_MAP.narrativeStyle).toBe('perspective');
            expect(V1_TO_V2_FIELD_MAP.rhetoric).toBe('rhetoric');
            expect(V1_TO_V2_FIELD_MAP.dialogueStyle).toBe('dialogue');
            expect(V1_TO_V2_FIELD_MAP.paragraphStructure).toBe('narration');
            expect(V1_TO_V2_FIELD_MAP.overallTone).toBe('languageTexture');
        });

        it('迁移后的 V2 指纹 12 维全部存在且每维有 status 字段', () => {
            const v1 = makeV1Fingerprint();
            const v2 = migrateV1ToV2(v1, 'global');

            const features: StyleFingerprintFeaturesV2 = v2.features;
            const requiredKeys: StyleDimensionKeyV2[] = [
                'rhythm', 'sentencePattern', 'wordChoice', 'rhetoric', 'perspective',
                'emotion', 'tension', 'infoDensity', 'dialogue', 'description',
                'narration', 'languageTexture',
            ];

            for (const key of requiredKeys) {
                expect(features[key]).toBeDefined();
                expect(typeof features[key].status).toBe('string');
                expect(['complete', 'pending', 'partial']).toContain(features[key].status);
                expect(Array.isArray(features[key].samples)).toBe(true);
                expect(typeof features[key].description).toBe('string');
            }
        });
    });

    // ============================================================
    // 2. V1→V2 映射正确
    // ============================================================
    describe('V1→V2 字段映射', () => {
        it('V1 的 7 个字符串字段正确映射到 V2 对应维度的 description', () => {
            const v1Features = makeV1Features();
            const v1 = makeV1Fingerprint({ features: v1Features });
            const v2 = migrateV1ToV2(v1, 'global');

            expect(v2.features.rhythm.description).toBe(v1Features.sentenceRhythm);
            expect(v2.features.wordChoice.description).toBe(v1Features.wordPreference);
            expect(v2.features.perspective.description).toBe(v1Features.narrativeStyle);
            expect(v2.features.rhetoric.description).toBe(v1Features.rhetoric);
            expect(v2.features.dialogue.description).toBe(v1Features.dialogueStyle);
            expect(v2.features.narration.description).toBe(v1Features.paragraphStructure);
            expect(v2.features.languageTexture.description).toBe(v1Features.overallTone);
        });

        it('V1 来源的 7 个维度标记为 complete', () => {
            const v1 = makeV1Fingerprint();
            const v2 = migrateV1ToV2(v1, 'global');

            expect(v2.features.rhythm.status).toBe('complete');
            expect(v2.features.wordChoice.status).toBe('complete');
            expect(v2.features.perspective.status).toBe('complete');
            expect(v2.features.rhetoric.status).toBe('complete');
            expect(v2.features.dialogue.status).toBe('complete');
            expect(v2.features.narration.status).toBe('complete');
            expect(v2.features.languageTexture.status).toBe('complete');
        });

        it('V1 字符串为空时对应维度标记为 pending', () => {
            const v1 = makeV1Fingerprint({
                features: makeV1Features({ sentenceRhythm: '' }),
            });
            const v2 = migrateV1ToV2(v1, 'global');

            expect(v2.features.rhythm.description).toBe('');
            expect(v2.features.rhythm.status).toBe('pending');
            // 其他 V1 来源维度仍为 complete
            expect(v2.features.wordChoice.status).toBe('complete');
        });

        it('保留 V1 基础字段（id/name/source/tags/stats/samples）', () => {
            const v1 = makeV1Fingerprint();
            const v2 = migrateV1ToV2(v1, 'global');

            expect(v2.id).toBe(v1.id);
            expect(v2.name).toBe(v1.name);
            expect(v2.source).toBe(v1.source);
            expect(v2.tags).toEqual(v1.tags);
            expect(v2.stats).toEqual(v1.stats);
            expect(v2.samples).toEqual(v1.samples);
            expect(v2.extractedAt).toBe(v1.extractedAt);
        });

        it('V1 缺失 tags 和 scope 时使用默认值', () => {
            const v1 = makeV1Fingerprint();
            // 模拟旧 V1 数据缺失 tags/scope
            const v1Raw: V1StyleFingerprint = {
                ...v1,
                tags: undefined,
                scope: undefined,
                enabled: undefined,
            } as unknown as V1StyleFingerprint;

            const v2 = migrateV1ToV2(v1Raw, 'project');

            expect(v2.tags).toEqual([]);
            expect(v2.scope).toBe('project');
            expect(v2.enabled).toBe(true);
        });
    });

    // ============================================================
    // 3. 缺失维度标记为 pending
    // ============================================================
    describe('新增维度 pending 标记', () => {
        it('V2 新增的 5 维迁移后 status 为 pending', () => {
            const v1 = makeV1Fingerprint();
            const v2 = migrateV1ToV2(v1, 'global');

            expect(v2.features.sentencePattern.status).toBe('pending');
            expect(v2.features.emotion.status).toBe('pending');
            expect(v2.features.tension.status).toBe('pending');
            expect(v2.features.infoDensity.status).toBe('pending');
            expect(v2.features.description.status).toBe('pending');
        });

        it('新增维度的定量统计字段为默认零值', () => {
            const v1 = makeV1Fingerprint();
            const v2 = migrateV1ToV2(v1, 'global');

            expect(v2.features.sentencePattern.inversionDensity).toBe(0);
            expect(v2.features.emotion.emotionalFluctuationFrequency).toBe(0);
            expect(v2.features.tension.suspenseDensity).toBe(0);
            expect(v2.features.infoDensity.infoDensity).toBe(0);
            expect(v2.features.description.detailDensity).toBe(0);
        });

        it('新增维度的 description 和 samples 为空', () => {
            const v1 = makeV1Fingerprint();
            const v2 = migrateV1ToV2(v1, 'global');

            expect(v2.features.sentencePattern.description).toBe('');
            expect(v2.features.sentencePattern.samples).toEqual([]);
            expect(v2.features.emotion.description).toBe('');
            expect(v2.features.tension.samples).toEqual([]);
        });

        it('getPendingDimensions 返回 5 个新增维度', () => {
            const v1 = makeV1Fingerprint();
            const v2 = migrateV1ToV2(v1, 'global');
            const pending = getPendingDimensions(v2);

            expect(pending).toHaveLength(5);
            expect(pending).toContain('sentencePattern');
            expect(pending).toContain('emotion');
            expect(pending).toContain('tension');
            expect(pending).toContain('infoDensity');
            expect(pending).toContain('description');
        });

        it('getCompleteDimensions 返回 7 个 V1 来源维度', () => {
            const v1 = makeV1Fingerprint();
            const v2 = migrateV1ToV2(v1, 'global');
            const complete = getCompleteDimensions(v2);

            expect(complete).toHaveLength(7);
            expect(complete).toContain('rhythm');
            expect(complete).toContain('wordChoice');
            expect(complete).toContain('perspective');
            expect(complete).toContain('rhetoric');
            expect(complete).toContain('dialogue');
            expect(complete).toContain('narration');
            expect(complete).toContain('languageTexture');
        });

        it('getDimensionStatusSummary 返回正确的统计', () => {
            const v1 = makeV1Fingerprint();
            const v2 = migrateV1ToV2(v1, 'global');
            const summary = getDimensionStatusSummary(v2);

            expect(summary.complete).toBe(7);
            expect(summary.pending).toBe(5);
            expect(summary.partial).toBe(0);
            expect(summary.total).toBe(12);
        });
    });

    // ============================================================
    // 4. 迁移前备份
    // ============================================================
    describe('迁移前备份', () => {
        let fs: MockFileSystem;
        const filePath = 'test/fingerprints.json';
        const backupPath = `${filePath}.v1.bak`;

        beforeEach(() => {
            fs = new MockFileSystem();
        });

        it('迁移后生成 .v1.bak 备份文件', async () => {
            const v1Array = [makeV1Fingerprint()];
            const raw = JSON.stringify(v1Array);
            fs.setFile(filePath, raw);

            expect(await fs.exists(backupPath)).toBe(false);

            const result = await migrateFileV1ToV2(fs, filePath, 'global');

            expect(result.success).toBe(true);
            expect(result.backupPath).toBe(backupPath);
            expect(await fs.exists(backupPath)).toBe(true);
        });

        it('备份文件内容与原始 V1 数据一致', async () => {
            const v1Array = [makeV1Fingerprint(), makeV1Fingerprint({ id: 'fp_test_002' })];
            const raw = JSON.stringify(v1Array);
            fs.setFile(filePath, raw);

            await migrateFileV1ToV2(fs, filePath, 'global');

            const backupRaw = await fs.read(backupPath);
            expect(backupRaw).toBe(raw);
        });

        it('V2 数据写入原文件，备份保留 V1 原始数据', async () => {
            const v1Array = [makeV1Fingerprint()];
            const raw = JSON.stringify(v1Array);
            fs.setFile(filePath, raw);

            await migrateFileV1ToV2(fs, filePath, 'global');

            // 原文件已变为 V2 格式
            const v2Raw = await fs.read(filePath);
            const v2Parsed = JSON.parse(v2Raw);
            expect(v2Parsed[0].version).toBe('v2');
            // 备份仍为 V1 格式
            const backupRaw = await fs.read(backupPath);
            const backupParsed = JSON.parse(backupRaw);
            expect(backupParsed[0].version).toBeUndefined();
            expect(typeof backupParsed[0].features.sentenceRhythm).toBe('string');
        });

        it('单个 V1 指纹（非数组）迁移也生成备份', async () => {
            const v1 = makeV1Fingerprint();
            const raw = JSON.stringify(v1);
            fs.setFile(filePath, raw);

            const result = await migrateFileV1ToV2(fs, filePath, 'global');

            expect(result.success).toBe(true);
            expect(await fs.exists(backupPath)).toBe(true);
        });
    });

    // ============================================================
    // 5. 迁移失败回滚
    // ============================================================
    describe('迁移失败回滚', () => {
        let fs: MockFileSystem;
        const filePath = 'test/fingerprints.json';
        const backupPath = `${filePath}.v1.bak`;

        beforeEach(() => {
            fs = new MockFileSystem();
        });

        it('已迁移的 V2 数据不会重复迁移（幂等）', async () => {
            const v2Array: V2Fingerprint[] = [migrateV1ToV2(makeV1Fingerprint(), 'global')];
            const raw = JSON.stringify(v2Array);
            fs.setFile(filePath, raw);

            const result = await migrateFileV1ToV2(fs, filePath, 'global');

            expect(result.success).toBe(true);
            // 不会生成备份文件
            expect(await fs.exists(backupPath)).toBe(false);
        });

        it('文件不存在时返回失败但不崩溃', async () => {
            const result = await migrateFileV1ToV2(fs, 'not/exist.json', 'global');

            expect(result.success).toBe(false);
            expect(result.error).toContain('文件不存在');
        });

        it('rollbackV2ToV1 可从备份恢复 V1 数据', async () => {
            const v1Array = [makeV1Fingerprint()];
            const raw = JSON.stringify(v1Array);
            fs.setFile(filePath, raw);

            // 执行迁移
            await migrateFileV1ToV2(fs, filePath, 'global');
            expect(await fs.exists(backupPath)).toBe(true);

            // 原文件已是 V2
            const v2Raw = await fs.read(filePath);
            expect(JSON.parse(v2Raw)[0].version).toBe('v2');

            // 回滚
            const rolledBack = await rollbackV2ToV1(fs, filePath);
            expect(rolledBack).toBe(true);

            // 原文件恢复为 V1
            const restoredRaw = await fs.read(filePath);
            const restored = JSON.parse(restoredRaw);
            expect(restored[0].version).toBeUndefined();
            expect(typeof restored[0].features.sentenceRhythm).toBe('string');
        });

        it('rollbackV2ToV1 备份不存在时返回 false', async () => {
            const rolledBack = await rollbackV2ToV1(fs, 'no/backup.json');
            expect(rolledBack).toBe(false);
        });

        it('JSON 解析失败时回滚原文件', async () => {
            // 写入损坏的 JSON
            fs.setFile(filePath, '{invalid json content');
            // 预置一个备份以便回滚
            fs.setFile(backupPath, JSON.stringify([makeV1Fingerprint()]));

            const result = await migrateFileV1ToV2(fs, filePath, 'global');

            expect(result.success).toBe(false);
            expect(result.error).toContain('迁移异常');
        });
    });

    // ============================================================
    // 6. 迁移耗时 < 50ms
    // ============================================================
    describe('迁移性能', () => {
        it('单个 V1 指纹迁移耗时 < 50ms', () => {
            const v1 = makeV1Fingerprint();
            const start = Date.now();
            migrateV1ToV2(v1, 'global');
            const duration = Date.now() - start;
            expect(duration).toBeLessThan(50);
        });

        it('migrateFileV1ToV2 报告的 durationMs < 50ms（内存 IO）', async () => {
            const fs = new MockFileSystem();
            const v1Array = [makeV1Fingerprint()];
            fs.setFile('test/fp.json', JSON.stringify(v1Array));

            const result = await migrateFileV1ToV2(fs, 'test/fp.json', 'global');

            expect(result.success).toBe(true);
            expect(result.durationMs).toBeLessThan(50);
        });

        it('批量迁移 10 个 V1 指纹耗时 < 50ms', () => {
            const v1Array = Array.from({ length: 10 }, (_, i) =>
                makeV1Fingerprint({ id: `fp_batch_${i}` })
            );
            const start = Date.now();
            v1Array.map(v1 => migrateV1ToV2(v1, 'global'));
            const duration = Date.now() - start;
            expect(duration).toBeLessThan(50);
        });
    });

    // ============================================================
    // 7. V1 API 兼容
    // ============================================================
    describe('V1 API 兼容性', () => {
        it('迁移后的 V2 指纹保留 v1Backup 字段', () => {
            const v1 = makeV1Fingerprint();
            const v2 = migrateV1ToV2(v1, 'global');

            expect(v2.v1Backup).toBeDefined();
            expect(v2.v1Backup!.features).toEqual(v1.features);
            expect(v2.v1Backup!.extractedAt).toBe(v1.extractedAt);
            expect(v2.v1Backup!.migratedAt).toBeGreaterThan(0);
        });

        it('v1Backup.features 包含 V1 原始 7 个字段', () => {
            const v1 = makeV1Fingerprint();
            const v2 = migrateV1ToV2(v1, 'global');
            const backupFeatures: V1FingerprintBackup['features'] = v2.v1Backup!.features;

            expect(backupFeatures.sentenceRhythm).toBe(v1.features.sentenceRhythm);
            expect(backupFeatures.wordPreference).toBe(v1.features.wordPreference);
            expect(backupFeatures.narrativeStyle).toBe(v1.features.narrativeStyle);
            expect(backupFeatures.rhetoric).toBe(v1.features.rhetoric);
            expect(backupFeatures.dialogueStyle).toBe(v1.features.dialogueStyle);
            expect(backupFeatures.paragraphStructure).toBe(v1.features.paragraphStructure);
            expect(backupFeatures.overallTone).toBe(v1.features.overallTone);
        });

        it('迁移后的 V2 指纹 version 字段为 v2', () => {
            const v1 = makeV1Fingerprint();
            const v2 = migrateV1ToV2(v1, 'global');

            expect(v2.version).toBe('v2');
        });

        it('迁移后的 V2 指纹有 migratedAt 时间戳', () => {
            const before = Date.now();
            const v1 = makeV1Fingerprint();
            const v2 = migrateV1ToV2(v1, 'global');
            const after = Date.now();

            expect(v2.migratedAt).toBeDefined();
            expect(v2.migratedAt!).toBeGreaterThanOrEqual(before);
            expect(v2.migratedAt!).toBeLessThanOrEqual(after);
        });

        it('validateV2Fingerprint 对迁移后的 V2 指纹返回 true', () => {
            const v1 = makeV1Fingerprint();
            const v2 = migrateV1ToV2(v1, 'global');

            expect(validateV2Fingerprint(v2)).toBe(true);
        });

        it('validateV2Fingerprint 对非 V2 数据返回 false', () => {
            const v1 = makeV1Fingerprint();
            expect(validateV2Fingerprint(v1)).toBe(false);
            expect(validateV2Fingerprint(null)).toBe(false);
            expect(validateV2Fingerprint({})).toBe(false);
            expect(validateV2Fingerprint({ version: 'v1' })).toBe(false);
        });

        it('validateV2Fingerprint 检测缺失维度', () => {
            const v1 = makeV1Fingerprint();
            const v2 = migrateV1ToV2(v1, 'global');
            // 删除一个维度
            delete (v2.features as unknown as Record<string, unknown>).rhythm;
            expect(validateV2Fingerprint(v2)).toBe(false);
        });

        it('validateV2Fingerprint 检测非法 status 值', () => {
            const v1 = makeV1Fingerprint();
            const v2 = migrateV1ToV2(v1, 'global');
            (v2.features.rhythm as { status: string }).status = 'invalid';
            expect(validateV2Fingerprint(v2)).toBe(false);
        });

        it('needsV1ToV2Migration 对 V1 数据返回 true', () => {
            const v1 = makeV1Fingerprint();
            expect(needsV1ToV2Migration(v1)).toBe(true);
        });

        it('needsV1ToV2Migration 对 V2 数据返回 false', () => {
            const v2 = migrateV1ToV2(makeV1Fingerprint(), 'global');
            expect(needsV1ToV2Migration(v2)).toBe(false);
        });

        it('needsV1ToV2Migration 对 null/undefined 返回 false', () => {
            expect(needsV1ToV2Migration(null)).toBe(false);
            expect(needsV1ToV2Migration(undefined)).toBe(false);
            expect(needsV1ToV2Migration('string')).toBe(false);
        });
    });

    // ============================================================
    // 8. 工具函数
    // ============================================================
    describe('工具函数', () => {
        it('getV2DimensionForV1Field 返回正确的 V2 维度键', () => {
            expect(getV2DimensionForV1Field('sentenceRhythm')).toBe('rhythm');
            expect(getV2DimensionForV1Field('wordPreference')).toBe('wordChoice');
            expect(getV2DimensionForV1Field('narrativeStyle')).toBe('perspective');
            expect(getV2DimensionForV1Field('rhetoric')).toBe('rhetoric');
            expect(getV2DimensionForV1Field('dialogueStyle')).toBe('dialogue');
            expect(getV2DimensionForV1Field('paragraphStructure')).toBe('narration');
            expect(getV2DimensionForV1Field('overallTone')).toBe('languageTexture');
        });

        it('getV2DimensionForV1Field 对未知字段返回 undefined', () => {
            expect(getV2DimensionForV1Field('unknownField')).toBeUndefined();
        });

        it('isV2DimensionNew 对新增维度返回 true', () => {
            expect(isV2DimensionNew('sentencePattern')).toBe(true);
            expect(isV2DimensionNew('emotion')).toBe(true);
            expect(isV2DimensionNew('tension')).toBe(true);
            expect(isV2DimensionNew('infoDensity')).toBe(true);
            expect(isV2DimensionNew('description')).toBe(true);
        });

        it('isV2DimensionNew 对 V1 来源维度返回 false', () => {
            expect(isV2DimensionNew('rhythm')).toBe(false);
            expect(isV2DimensionNew('wordChoice')).toBe(false);
            expect(isV2DimensionNew('perspective')).toBe(false);
            expect(isV2DimensionNew('rhetoric')).toBe(false);
            expect(isV2DimensionNew('dialogue')).toBe(false);
            expect(isV2DimensionNew('narration')).toBe(false);
            expect(isV2DimensionNew('languageTexture')).toBe(false);
        });
    });

    // ============================================================
    // 9. 边界场景
    // ============================================================
    describe('边界场景', () => {
        it('空数组文件迁移后仍为空数组', async () => {
            const fs = new MockFileSystem();
            const filePath = 'test/empty.json';
            fs.setFile(filePath, '[]');

            const result = await migrateFileV1ToV2(fs, filePath, 'global');

            expect(result.success).toBe(true);
            const content = await fs.read(filePath);
            expect(JSON.parse(content)).toEqual([]);
        });

        it('混合 V1/V2 数组只迁移 V1 项', async () => {
            const fs = new MockFileSystem();
            const filePath = 'test/mixed.json';
            const v1Fp = makeV1Fingerprint();
            const v2Fp = migrateV1ToV2(makeV1Fingerprint({ id: 'fp_v2_001' }), 'global');
            fs.setFile(filePath, JSON.stringify([v1Fp, v2Fp]));

            const result = await migrateFileV1ToV2(fs, filePath, 'global');

            expect(result.success).toBe(true);
            const content = await fs.read(filePath);
            const parsed = JSON.parse(content);
            expect(parsed).toHaveLength(2);
            expect(parsed[0].version).toBe('v2');
            expect(parsed[1].version).toBe('v2');
        });

        it('V1 指纹的 samples 数组在 V2 中保留', () => {
            const v1 = makeV1Fingerprint({ samples: ['样本A', '样本B', '样本C'] });
            const v2 = migrateV1ToV2(v1, 'global');

            expect(v2.samples).toEqual(['样本A', '样本B', '样本C']);
        });

        it('迁移保留 sourceText 字段', () => {
            const v1 = makeV1Fingerprint();
            v1.sourceText = '原始源文本内容';
            const v2 = migrateV1ToV2(v1, 'global');

            expect(v2.sourceText).toBe('原始源文本内容');
        });

        it('stats 字段完整复制', () => {
            const v1 = makeV1Fingerprint({
                stats: {
                    avgSentenceLength: 20.5,
                    avgParagraphLength: 80.3,
                    dialogueRatio: 0.5,
                    descriptionRatio: 0.3,
                    wordCount: 50000,
                },
            });
            const v2 = migrateV1ToV2(v1, 'global');

            expect(v2.stats.avgSentenceLength).toBe(20.5);
            expect(v2.stats.avgParagraphLength).toBe(80.3);
            expect(v2.stats.dialogueRatio).toBe(0.5);
            expect(v2.stats.descriptionRatio).toBe(0.3);
            expect(v2.stats.wordCount).toBe(50000);
        });
    });
});
