// Thin wrappers around the claude.ai runtime capabilities.
// Every capability may be absent (public link, saved copy, other host): callers get null.

function use(name) {
  try {
    if (!window.claude || typeof window.claude.use !== "function") return Promise.resolve(null);
    return window.claude.use(name).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

export const platform = {
  user: () => use("user"),
  artifact: () => use("artifact"),
  sample: () => use("sample"),
  downloads: () => use("downloads"),

  /** True when the viewer can edit this artifact (owner or editor on claude.ai). */
  async canManage() {
    const user = await use("user");
    if (!user) return false;
    try { return await user.canEdit(); } catch { return false; }
  },

  async viewerName() {
    const user = await use("user");
    if (!user) return "";
    try { return (await user.name()) || ""; } catch { return ""; }
  },
};
