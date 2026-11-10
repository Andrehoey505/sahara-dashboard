/**
 * Small wrappers around the Tauri commands, with browser fallbacks so the app
 * still works when running under `npm run dev` in a plain browser.
 */

type Invoke = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

async function tauri(): Promise<Invoke | null> {
  if (typeof window === "undefined") return null;
  // Tauri v2 injects this into the webview; it's absent in a plain browser.
  if (!(window as any).__TAURI_INTERNALS__) return null;
  try {
    const mod = await import("@tauri-apps/api/core");
    return mod.invoke as Invoke;
  } catch {
    return null;
  }
}

/** Open a URL in the user's default browser. */
export async function openExternal(url: string): Promise<void> {
  const invoke = await tauri();
  if (invoke) {
    await invoke("open_external", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function copyToClipboard(text: string): Promise<boolean> {
  const invoke = await tauri();
  if (invoke) {
    try {
      await invoke("copy_to_clipboard", { text });
      return true;
    } catch {
      // fall through to the web API
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function readFromClipboard(): Promise<string> {
  const invoke = await tauri();
  if (invoke) {
    try {
      return await invoke<string>("read_from_clipboard");
    } catch {
      // fall through
    }
  }
  try {
    return await navigator.clipboard.readText();
  } catch {
    return "";
  }
}
