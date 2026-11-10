import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DeconstructionWorkerManager } from '../../../engine/deconstruction-worker-manager';
import { CharacterDeconstructor } from '../../../engine/deconstructors/character-deconstructor';

/**
 * B-3（2026-11-10 用户拍板）：社区三文件安装拿不到 workers，只能走主线程。
 * 「分发取舍不能丢失质量」——这里锁住：
 *  - 无 worker 时明确走主线程（isWorkerAvailable=false）；
 *  - 主线程结果与直接调用拆解器完全一致；
 *  - worker 入口复用同一批拆解器模块，防止未来出现第二套实现。
 */
const SAMPLE = '林玄推门而入，雨水顺着剑鞘滴落。苏晚抬头看他一眼，没有说话。';

describe('Worker 降级 — 主线程与 Worker 质量同源（B-3）', () => {
    it('无 worker 资源时走主线程，结果与直接调用拆解器一致', async () => {
        const manager = new DeconstructionWorkerManager(undefined, { useWorker: false });
        expect(manager.isWorkerAvailable()).toBe(false);

        const viaManager = await manager.analyzeCharacter(SAMPLE);
        const direct = await new CharacterDeconstructor().analyze(SAMPLE);

        expect(viaManager).toEqual(direct);
    });

    it('worker 入口与主线程复用同一批拆解器模块', () => {
        const src = fs.readFileSync(
            path.resolve(__dirname, '../../../engine/deconstructors/deconstruction-worker.ts'),
            'utf8',
        );
        for (const name of [
            'StyleDeconstructor',
            'RhythmDeconstructor',
            'TechniqueDeconstructor',
            'StructureDeconstructor',
            'CharacterDeconstructor',
            'ForeshadowDeconstructor',
            'CommercialDeconstructor',
            'ReadabilityDeconstructor',
        ]) {
            expect(src, name).toContain(`import { ${name}`);
        }
    });
});
