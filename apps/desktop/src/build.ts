/** True only under the vite dev server (`tauri dev`). Any built binary,
    including a local `tauri build`, ships as production. */
export const IS_DEV_BUILD = import.meta.env.DEV;

/** Marks a development build so it can never be mistaken for the shipped app.
    The window title is set from Rust; this covers the web layer. */
export function applyBuildIdentity() {
  const root = document.documentElement;
  root.dataset.buildMode = IS_DEV_BUILD ? "development" : "production";
  root.classList.toggle("dev-build", IS_DEV_BUILD);
}
