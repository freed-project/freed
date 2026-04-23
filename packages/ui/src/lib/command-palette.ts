export interface CommandPaletteConfirm {
  title: string;
  description: string;
  token: string;
  confirmLabel: string;
}

export interface CommandPaletteAction {
  id: string;
  title: string;
  section: string;
  keywords: string[];
  run: () => void | Promise<void>;
  availability?: () => boolean;
  confirm?: CommandPaletteConfirm;
  entity?: boolean;
  fallback?: boolean;
}

function normalizeQuery(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function includesMatch(candidates: readonly string[], query: string): boolean {
  return candidates.some((candidate) => candidate.toLocaleLowerCase().includes(query));
}

export function isCommandPaletteActionAvailable(
  action: CommandPaletteAction,
): boolean {
  return action.availability ? action.availability() : true;
}

export function dedupeCommandPaletteActions(
  actions: readonly CommandPaletteAction[],
): CommandPaletteAction[] {
  const seen = new Set<string>();
  const deduped: CommandPaletteAction[] = [];
  for (const action of actions) {
    if (seen.has(action.id)) continue;
    seen.add(action.id);
    deduped.push(action);
  }
  return deduped;
}

export function rankCommandPaletteAction(
  action: CommandPaletteAction,
  rawQuery: string,
): number {
  const query = normalizeQuery(rawQuery);
  if (!query) return action.fallback ? Number.NEGATIVE_INFINITY : 0;
  if (action.fallback) return -1;

  const title = action.title.toLocaleLowerCase();
  if (title === query) return action.entity ? 150 : 400;
  if (title.startsWith(query)) return action.entity ? 125 : 300;

  if (action.entity) {
    return includesMatch([action.title, ...action.keywords], query) ? 100 : 0;
  }

  return includesMatch([action.title, ...action.keywords], query) ? 200 : 0;
}

export function filterCommandPaletteActions(
  actions: readonly CommandPaletteAction[],
  rawQuery: string,
): CommandPaletteAction[] {
  const available = dedupeCommandPaletteActions(actions).filter(
    isCommandPaletteActionAvailable,
  );
  const query = normalizeQuery(rawQuery);

  if (!query) {
    return available.filter((action) => !action.fallback);
  }

  const ranked = available
    .map((action, index) => ({
      action,
      index,
      score: rankCommandPaletteAction(action, query),
    }))
    .filter(({ score }) => score > 0 || score === -1)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.index - right.index;
    });

  const fallback = ranked.filter(({ action }) => action.fallback);
  const regular = ranked.filter(({ action }) => !action.fallback);

  return [...regular, ...fallback].map(({ action }) => action);
}
