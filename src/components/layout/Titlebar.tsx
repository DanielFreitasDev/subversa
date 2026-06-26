import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Barra de título própria (a janela roda sem decoração nativa — ver
 * `tauri.conf.json` e `capabilities/default.json`). Substitui a moldura cinza do
 * sistema por uma faixa no tema do app, mantendo arrastar, minimizar, maximizar,
 * fechar e o redimensionar pelas bordas (que o WM não oferece em janelas sem
 * decoração no Linux/KDE).
 */

// `ResizeDirection` não é exportado pela API; replicamos a união de literais.
type ResizeDir =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthEast"
  | "NorthWest"
  | "SouthEast"
  | "SouthWest";

/** Só há janela nativa dentro do Tauri (no `npm run dev` puro não existe). */
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Espessura (px) das alças invisíveis de redimensionamento. Fina o bastante
 *  para não brigar com a barra de rolagem na borda direita. */
const EDGE = 5;
const CORNER = 12;

const appWindow = () => getCurrentWindow();

/** Alças invisíveis nas 4 bordas + 4 cantos para redimensionar a janela. */
function ResizeBorder() {
  const grip = (style: React.CSSProperties, dir: ResizeDir, cursor: string) => (
    <div
      className="no-drag fixed z-[67]"
      style={{ ...style, cursor }}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        appWindow()
          .startResizeDragging(dir)
          .catch(() => {});
      }}
    />
  );

  return (
    <>
      {grip({ top: 0, left: CORNER, right: CORNER, height: EDGE }, "North", "ns-resize")}
      {grip({ bottom: 0, left: CORNER, right: CORNER, height: EDGE }, "South", "ns-resize")}
      {grip({ left: 0, top: CORNER, bottom: CORNER, width: EDGE }, "West", "ew-resize")}
      {grip({ right: 0, top: CORNER, bottom: CORNER, width: EDGE }, "East", "ew-resize")}
      {grip({ top: 0, left: 0, width: CORNER, height: CORNER }, "NorthWest", "nwse-resize")}
      {grip({ top: 0, right: 0, width: CORNER, height: CORNER }, "NorthEast", "nesw-resize")}
      {grip({ bottom: 0, left: 0, width: CORNER, height: CORNER }, "SouthWest", "nesw-resize")}
      {grip({ bottom: 0, right: 0, width: CORNER, height: CORNER }, "SouthEast", "nwse-resize")}
    </>
  );
}

export function Titlebar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    const win = appWindow();
    let unlisten: (() => void) | undefined;
    win.isMaximized().then(setMaximized).catch(() => {});
    win
      .onResized(() => {
        win.isMaximized().then(setMaximized).catch(() => {});
      })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  if (!isTauri) return null;

  const ctrl =
    "no-drag flex h-full w-[44px] items-center justify-center text-muted transition-colors";

  return (
    <>
      {!maximized && <ResizeBorder />}
      <div
        data-tauri-drag-region
        className="relative z-[66] flex h-8 shrink-0 items-center justify-end border-b border-line bg-panel"
      >
        <span
          data-tauri-drag-region
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-[11px] font-medium tracking-wide text-faint"
        >
          Subversa
        </span>
        <div className="no-drag flex h-full">
          <button
            type="button"
            aria-label="Minimizar"
            className={`${ctrl} hover:bg-panel-2 hover:text-ink`}
            onClick={() => appWindow().minimize().catch(() => {})}
          >
            <Minus className="size-4" />
          </button>
          <button
            type="button"
            aria-label={maximized ? "Restaurar" : "Maximizar"}
            className={`${ctrl} hover:bg-panel-2 hover:text-ink`}
            onClick={() => appWindow().toggleMaximize().catch(() => {})}
          >
            {maximized ? <Copy className="size-3.5" /> : <Square className="size-3.5" />}
          </button>
          <button
            type="button"
            aria-label="Fechar"
            className={`${ctrl} hover:bg-danger hover:text-white`}
            onClick={() => appWindow().close().catch(() => {})}
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </>
  );
}
