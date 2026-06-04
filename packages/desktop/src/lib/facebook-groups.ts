import type { FbGroupInfo, FeedItem } from "@freed/shared";

const RELATIVE_TIME_ONLY_RE =
  /^(?:\d+\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mos|month|months|y|yr|yrs|year|years)(?:\s+ago)?|just now)$/i;

const GENERIC_GROUP_LABEL_RE =
  /^(?:groups?|your groups|joined|join group|visit group|public group|private group|last active|new activity|notifications?|see all)$/i;

function cleanFacebookGroupName(name: string): string {
  return name
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .replace(/(\S)(last active\b)/i, "$1 $2")
    .trim()
    .replace(
      /^(?:\d+\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mos|month|months|y|yr|yrs|year|years)(?:\s+ago)?|just now)\s+(?=\S)/i,
      "",
    )
    .trim();
}

function isUsableFacebookGroupName(name: string, id: string): boolean {
  const cleaned = cleanFacebookGroupName(name);
  const cleanedLower = cleaned.toLowerCase();
  const idLower = id.trim().toLowerCase();

  if (cleaned.length < 2) return false;
  if (cleanedLower === idLower) return false;
  if (cleanedLower === decodeURIComponent(idLower)) return false;
  if (/^https?:\/\//i.test(cleaned)) return false;
  if (/^\d{5,}$/.test(cleaned)) return false;
  if (/^[\d\s,._-]+$/.test(cleaned)) return false;
  if (RELATIVE_TIME_ONLY_RE.test(cleaned)) return false;
  if (GENERIC_GROUP_LABEL_RE.test(cleaned)) return false;
  if (/^last active\b/i.test(cleaned)) return false;

  return true;
}

export function isMissingFacebookGroupName(group: Pick<FbGroupInfo, "id" | "name">): boolean {
  return !isUsableFacebookGroupName(group.name, group.id);
}

export function getFacebookGroupDisplayName(group: FbGroupInfo): string {
  const cleaned = cleanFacebookGroupName(group.name);
  if (isUsableFacebookGroupName(cleaned, group.id)) return cleaned;
  return "Facebook group";
}

interface FacebookGroupMergeResult {
  knownGroups: Record<string, FbGroupInfo>;
  changedCount: number;
  repairedNameCount: number;
}

export function mergeFacebookGroupRecords(
  existingGroups: Record<string, FbGroupInfo>,
  incomingGroups: readonly FbGroupInfo[],
): FacebookGroupMergeResult {
  const nextGroups = { ...existingGroups };
  let changedCount = 0;
  let repairedNameCount = 0;

  for (const incoming of incomingGroups) {
    const id = incoming.id.trim();
    if (!id) continue;

    const current = nextGroups[id];
    const incomingName = cleanFacebookGroupName(incoming.name);
    const incomingGroup: FbGroupInfo = {
      ...incoming,
      id,
      name: incomingName,
    };
    const incomingNameMissing = isMissingFacebookGroupName(incomingGroup);

    if (!current) {
      if (incomingNameMissing) continue;
      nextGroups[id] = incomingGroup;
      changedCount += 1;
      continue;
    }

    const currentGroup: FbGroupInfo = {
      ...current,
      name: cleanFacebookGroupName(current.name),
    };
    const currentNameMissing = isMissingFacebookGroupName(currentGroup);

    if (!incomingNameMissing && currentNameMissing) {
      nextGroups[id] = incomingGroup;
      changedCount += 1;
      repairedNameCount += 1;
      continue;
    }

    if (!incomingNameMissing && incomingName !== currentGroup.name) {
      nextGroups[id] = incomingGroup;
      changedCount += 1;
      continue;
    }

    if (incoming.url && incoming.url !== current.url) {
      nextGroups[id] = {
        ...currentGroup,
        url: incoming.url,
      };
      changedCount += 1;
    } else if (currentGroup.name !== current.name) {
      nextGroups[id] = currentGroup;
      changedCount += 1;
    }
  }

  return {
    knownGroups: nextGroups,
    changedCount,
    repairedNameCount,
  };
}

export function facebookGroupsFromFeedItems(items: readonly FeedItem[]): FbGroupInfo[] {
  const groups: FbGroupInfo[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (item.platform !== "facebook" || !item.fbGroup) continue;
    if (seen.has(item.fbGroup.id)) continue;
    if (isMissingFacebookGroupName(item.fbGroup)) continue;

    seen.add(item.fbGroup.id);
    groups.push({
      ...item.fbGroup,
      name: cleanFacebookGroupName(item.fbGroup.name),
    });
  }

  return groups;
}
