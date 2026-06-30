export class InternalRegistry {
    private commands = new Map<string, () => Promise<void>>();
    
    register(id: string, action: () => Promise<void>) {
        this.commands.set(id, action);
        console.log('[Registry] Command registered: ' + id);
    }

    /** 检查命令是否已注册 */
    has(id: string): boolean {
        return this.commands.has(id);
    }
    
    async execute(id: string) {
        const action = this.commands.get(id);
        if (action) {
            console.log('[Registry] Executing: ' + id);
            await action();
        } else {
            console.error('[Registry] Command ' + id + ' not found');
        }
    }
}
