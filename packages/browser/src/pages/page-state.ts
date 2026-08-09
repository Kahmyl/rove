export interface PageState {
  id: string;
  revision: number;
  mutationVersion: number;
  url: string;
  title?: string;
  active: boolean;
}

export function createPageState(id: string, url = "about:blank"): PageState {
  return { id, revision: 0, mutationVersion: 0, url, active: false };
}

export function recordMutation(state: PageState, material: boolean): PageState {
  return {
    ...state,
    mutationVersion: state.mutationVersion + 1,
    revision: state.revision + (material ? 1 : 0),
  };
}
