import type { ReactNode } from "react";
import {
  AllIcon,
  FacebookIcon,
  InstagramIcon,
  LinkedInIcon,
  MapPinIcon,
  MediumIcon,
  RssIcon,
  SubstackIcon,
  XIcon,
  YoutubeIcon,
} from "../components/icons.js";

export interface SourceNavigationItem {
  id: string | undefined;
  label: string;
  icon: ReactNode;
  stage?: "beta";
}

export function getTopSourceItems(useShortLabels = false): readonly SourceNavigationItem[] {
  return [
    { id: undefined, label: useShortLabels ? "Feed" : "Unified Feed", icon: <AllIcon /> },
    { id: "rss", label: "Feeds", icon: <RssIcon /> },
    { id: "x", label: "X / Twitter", icon: <XIcon /> },
    { id: "facebook", label: "Facebook", icon: <FacebookIcon /> },
    { id: "instagram", label: "Instagram", icon: <InstagramIcon /> },
    { id: "linkedin", label: "LinkedIn", icon: <LinkedInIcon /> },
    { id: "substack", label: "Substack", icon: <SubstackIcon />, stage: "beta" },
    { id: "medium", label: "Medium", icon: <MediumIcon />, stage: "beta" },
    { id: "youtube", label: "YouTube", icon: <YoutubeIcon />, stage: "beta" },
  ] as const;
}

export const TOP_SOURCE_ITEMS: readonly SourceNavigationItem[] = [
  ...getTopSourceItems(false),
] as const;

export const COMING_SOON_SOURCE_ITEMS: readonly SourceNavigationItem[] = [
  { id: "map", label: "Map", icon: <MapPinIcon /> },
] as const;
