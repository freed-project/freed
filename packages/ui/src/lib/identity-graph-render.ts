import type { IdentityGraphLayoutNode } from "./identity-graph-layout.js";

export type GraphQualityMode = "interactive" | "settled";

export interface GraphLabelVisibilityArgs {
  node: IdentityGraphLayoutNode;
  scale: number;
  highlighted: Set<string>;
  selectedPersonId?: string | null;
  selectedAccountId?: string | null;
  qualityMode: GraphQualityMode;
}

export function isSelectedGraphNode(
  node: IdentityGraphLayoutNode,
  selectedPersonId?: string | null,
  selectedAccountId?: string | null,
): boolean {
  if (node.personId) return node.personId === selectedPersonId;
  if (node.accountId) return node.accountId === selectedAccountId;
  return false;
}

export function shouldShowGraphLabel({
  node,
  scale,
  highlighted,
  selectedPersonId,
  selectedAccountId,
  qualityMode,
}: GraphLabelVisibilityArgs): boolean {
  if (isSelectedGraphNode(node, selectedPersonId, selectedAccountId)) return true;
  if (highlighted.has(node.id)) return true;
  if (node.kind === "friend_person") return true;

  if (qualityMode === "interactive") {
    if (node.kind === "connection_person") return scale >= 0.7;
    if (node.kind === "account") {
      return !!node.linkedPersonId && scale >= 1.08 && node.labelPriority >= 56;
    }
    return false;
  }

  if (node.kind === "connection_person") return scale >= 0.55;
  if (node.kind === "account") return scale >= 0.92;
  return scale >= 1.22;
}

export function graphLabelSortValue(
  node: IdentityGraphLayoutNode,
  highlighted: Set<string>,
  selectedPersonId?: string | null,
  selectedAccountId?: string | null,
): number {
  const selected = isSelectedGraphNode(node, selectedPersonId, selectedAccountId) ? 10_000 : 0;
  const highlightedWeight = highlighted.has(node.id) ? 5_000 : 0;
  return selected + highlightedWeight + node.labelPriority * 20 + node.weight;
}
