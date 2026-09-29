import { Command, FileText, FolderOpen, Keyboard, MoveHorizontal, PanelLeft, Search, X, ZoomIn, ZoomOut, type LucideIcon } from "lucide-react";

// Commands refer to icons by name so the registry stays free of UI imports.
const ICONS: Record<string, LucideIcon> = {
  open: FolderOpen,
  close: X,
  "zoom-in": ZoomIn,
  "zoom-out": ZoomOut,
  palette: Command,
  keyboard: Keyboard,
  file: FileText,
  outline: PanelLeft,
  "fit-width": MoveHorizontal,
  search: Search,
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const Component = ICONS[name] ?? FileText;
  return <Component size={size} aria-hidden="true" strokeWidth={1.75} />;
}
