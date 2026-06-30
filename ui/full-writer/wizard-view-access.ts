/**
 * WizardViewAccess — 向导控制器对主视图的访问接口
 * 替代 `(this.view as any).xxx` 模式，提供类型安全的成员访问
 */
import type { App } from 'obsidian';

export interface WizardTabData {
    id: string;
    label: string;
    type: string;
    project: string;
    projectType?: 'original' | 'fanfic';
    currentStepIdx: number;
    steps: any[];
    chapterKey?: string;
    chapterName?: string;
    volume?: string;
}

export interface WizardViewAccess {
    app: App;
    tabs: WizardTabData[];
    tabContent: HTMLDivElement;
    wizardStepExecuting: Set<string>;

    pushNav(tabId: string): Promise<void>;
    popNav(): void;
    closeTab(tabId: string): void;
    openFirstUnwrittenChapter(project: string): Promise<void>;

    checkWorldviewComplete(project: string): Promise<boolean>;
    checkSettingLibComplete(project: string): Promise<boolean>;
    checkWritingStyleComplete(project: string): Promise<boolean>;
    checkEntitiesComplete(project: string): Promise<boolean>;
    checkOutlineComplete(project: string): Promise<boolean>;
    closeOutlineTreeModal(): void;
}
