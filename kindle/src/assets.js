// Loads the SVG renderer and fonts from disk (Node), once per warm instance.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

const require = createRequire(import.meta.url);
let ready = null;

export function loadAssets() {
  ready ??= (async () => {
    await initWasm(readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
    const fonts = ["Inter-Regular.ttf", "Inter-Bold.ttf"].map(f =>
      new Uint8Array(readFileSync(fileURLToPath(new URL(`../fonts/${f}`, import.meta.url)))));
    return { Resvg, fonts };
  })();
  return ready;
}
