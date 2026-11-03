import { createLogger } from '@/shared/logger';

const log = createLogger('InternalRegistry');
/**
 * InternalRegistry 类。
 */
export class InternalRegistry {
    private commands = new Map<string, () => Promise<void>>();
    
    /**
     * 注册。
     * @param id - 标识
     * @param action - 动作
     */
    register(id: string, action: () => Promise<void>) {
        this.commands.set(id, action);
        log.info('[Registry] Command registered: ' + id);
    }

    /**
     * 检查命令是否已注册
     *
     * @param id - 标识
     * @returns 是否成功
     */
    has(id: string): boolean {
        return this.commands.has(id);
    }
    
    /**
     * execute 方法。
     * @param id - 标识
     */
    async execute(id: string) {
        const action = this.commands.get(id);
        if (action) {
            log.info('[Registry] Executing: ' + id);
            await action();
        } else {
            log.error('[Registry] Command ' + id + ' not found');
        }
    }
}
