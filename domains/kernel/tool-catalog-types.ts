export interface ToolButton {
    label: string;
    desc: string;
    icon: string;
    commandId: string;
}

export interface ToolGroup {
    label: string;
    buttons: ToolButton[];
    defaultCollapsed?: boolean;
}
