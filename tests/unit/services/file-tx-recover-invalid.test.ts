import { describe, expect, it } from 'vitest';
import { App, TFolder, TFile } from 'obsidian';
import { FileTxService } from '@/services/file-tx';

describe('FileTxService.recover — 损坏日志留档', () => {
    it('无法解析的日志改名 .invalid，不直接删除', async () => {
        const app = new App();
        const vault = app.vault;
        (vault as never as { _seedFile(p: string, c: string): unknown })._seedFile('项目/04-项目总控/事务/bad.json', '{截断');
        const renamed: Array<[string, string]> = [];
        (vault as unknown as { adapter: Record<string, unknown> }).adapter = {
            ...(vault as unknown as { adapter: Record<string, unknown> }).adapter,
            rename: async (from: string, to: string) => { renamed.push([from, to]); },
        };
        const service = new FileTxService(app);
        const recovered = await service.recover('项目');
        expect(recovered).toBe(0);
        expect(renamed).toEqual([['项目/04-项目总控/事务/bad.json', '项目/04-项目总控/事务/bad.json.invalid']]);
    });
});
