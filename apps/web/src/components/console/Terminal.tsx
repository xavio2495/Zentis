"use client";

import { useEffect, useRef, useState } from "react";
import { TERMINAL_THEME } from "@/lib/terminal-theme";

/**
 * The operator's console, in a browser.
 *
 * Not a picture of the console and not a reimplementation of it: the same Ink application the
 * binary runs, bundled for the browser and writing ANSI into xterm.js. What a visitor sees here is
 * what the maker sees, over the recorded moment — the bundle asks no endpoint anything, because a
 * page that spends the maker's indexer allowance per visitor is a page that comes down.
 *
 * The bundle is loaded as a module from `/console/console.js` rather than imported: it is
 * self-contained, shims its own Node globals, and putting it through this app's bundler would mean
 * maintaining those shims twice.
 */
export function Terminal() {
  const host = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const element = host.current;
    if (element === null) return undefined;
    let disposed = false;
    let dispose: (() => void) | null = null;

    void (async () => {
      const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed) return;

      const term = new XTerm({
        convertEol: true,
        cursorBlink: false,
        // The console draws its own frame and never scrolls; a scrollback would let a stray
        // repaint push the screen up and leave half a frame above it.
        scrollback: 0,
        fontSize: 13,
        fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        theme: { ...TERMINAL_THEME },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(element);
      fit.fit();

      const handle = {
        write: (data: string) => term.write(data),
        get cols() {
          return term.cols;
        },
        get rows() {
          return term.rows;
        },
        onData: (handler: (data: string) => void) => {
          term.onData(handler);
        },
        onResize: (handler: (size: { cols: number; rows: number }) => void) => {
          term.onResize(handler);
        },
      };

      // Handed over on a global and picked up by an inline module: a bare `import(url)` would be
      // rewritten by the bundler, which is exactly what this file is avoiding.
      (window as unknown as { __zentisTerminal?: unknown }).__zentisTerminal = handle;
      const script = document.createElement("script");
      script.type = "module";
      script.textContent =
        'import { mount } from "/console/console.js";' +
        "window.__zentisConsole = mount(window.__zentisTerminal);";
      script.onerror = () => setFailed("the console bundle did not load");
      document.head.appendChild(script);

      const onResize = () => fit.fit();
      window.addEventListener("resize", onResize);
      dispose = () => {
        window.removeEventListener("resize", onResize);
        const app = (window as unknown as { __zentisConsole?: { unmount?: () => void } }).__zentisConsole;
        app?.unmount?.();
        script.remove();
        term.dispose();
      };
    })().catch((cause: unknown) => setFailed(String(cause)));

    return () => {
      disposed = true;
      dispose?.();
    };
  }, []);

  return (
    <>
      <div ref={host} className="h-full w-full" />
      {failed === null ? null : <p className="m-0 p-3 text-fs-0 text-bad">{failed}</p>}
    </>
  );
}
