import { useWorkspaceStore } from "@/store/workspace";

/** Hook reativo para a working copy atualmente selecionada. */
export const useSelectedWc = () =>
  useWorkspaceStore((s) => s.workingCopies.find((w) => w.path === s.selectedPath) ?? null);
