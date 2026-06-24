import { AnimatePresence, motion } from "framer-motion";

import { CommandPalette } from "@/components/layout/CommandPalette";
import { Sidebar } from "@/components/layout/Sidebar";
import { StatusBar } from "@/components/layout/StatusBar";
import { TopBar } from "@/components/layout/TopBar";
import { ActivityPanel } from "@/components/feedback/ActivityPanel";
import { ConfirmDialog } from "@/components/feedback/ConfirmDialog";
import { Toaster } from "@/components/feedback/Toaster";
import { CheckoutDialog } from "@/components/dialogs/CheckoutDialog";
import { CreateBranchDialog } from "@/components/dialogs/CreateBranchDialog";
import { RepoCompareDialog } from "@/components/dialogs/RepoCompareDialog";
import { RepoHistoryDialog } from "@/components/dialogs/RepoHistoryDialog";
import { RepoLocationDialog } from "@/components/dialogs/RepoLocationDialog";
import { RepoOpDialog } from "@/components/dialogs/RepoOpDialog";
import { BranchesView } from "@/views/BranchesView";
import { ChangesView } from "@/views/ChangesView";
import { CommandLogView } from "@/views/CommandLogView";
import { HistoryView } from "@/views/HistoryView";
import { MergeView } from "@/views/MergeView";
import { OverviewView } from "@/views/OverviewView";
import { ReposView } from "@/views/ReposView";
import { SettingsView } from "@/views/SettingsView";
import { useUiStore } from "@/store/ui";

function ViewRouter() {
  const view = useUiStore((s) => s.view);
  const node = (() => {
    switch (view) {
      case "overview":
        return <OverviewView />;
      case "changes":
        return <ChangesView />;
      case "history":
        return <HistoryView />;
      case "branches":
        return <BranchesView />;
      case "merge":
        return <MergeView />;
      case "repos":
        return <ReposView />;
      case "log":
        return <CommandLogView />;
      case "settings":
        return <SettingsView />;
    }
  })();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={view}
        className="h-full"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.16, ease: "easeOut" }}
      >
        {node}
      </motion.div>
    </AnimatePresence>
  );
}

export function AppShell() {
  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-hidden">
          <ViewRouter />
        </main>
        <StatusBar />
      </div>

      <CommandPalette />
      <CheckoutDialog />
      <CreateBranchDialog />
      <RepoLocationDialog />
      <RepoOpDialog />
      <RepoCompareDialog />
      <RepoHistoryDialog />
      <ActivityPanel />
      <Toaster />
      <ConfirmDialog />
    </div>
  );
}
