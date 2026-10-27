/** 单章一键编排的运行模式（放在 shared 层，避免 UI 控制器与编排器互相引用）。 */
export type ChapterRunMode = 'recommended' | 'step';