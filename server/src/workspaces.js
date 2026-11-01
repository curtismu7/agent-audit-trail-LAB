// Workspace registry (rule 13): one in-memory runtime per workspace id, so one visitor's Reset or scenario runs never touch
// another's. The id comes from the X-Workspace-Id header (default 'default'). It is a label, not a credential: it grants
// nothing and nobody can read another workspace without guessing its id, and everything in it is synthetic anyway.
// Capped: past MAX_WORKSPACES the least recently used non-default workspace is dropped.
export const DEFAULT_WORKSPACE = 'default';
export const MAX_WORKSPACES = 50;
export const WORKSPACE_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function createWorkspaces({ defaultRuntime, create, max = MAX_WORKSPACES }) {
  const map = new Map([[DEFAULT_WORKSPACE, defaultRuntime]]); // Map keeps insertion order: oldest use first
  return {
    get(id = DEFAULT_WORKSPACE) {
      if (map.has(id)) { const rt = map.get(id); if (id !== DEFAULT_WORKSPACE) { map.delete(id); map.set(id, rt); } return rt; }
      while (map.size >= max) {
        const victim = [...map.keys()].find((k) => k !== DEFAULT_WORKSPACE);
        if (victim === undefined) break;
        map.delete(victim);
      }
      const rt = create();
      map.set(id, rt);
      return rt;
    },
    get size() { return map.size; },
    ids: () => [...map.keys()],
  };
}
