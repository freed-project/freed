import type { ReactNode } from "react";
import {
  AllIcon,
  FacebookIcon,
  InstagramIcon,
  LinkedInIcon,
  MapPinIcon,
  RssIcon,
} from "../components/icons.js";

export interface SourceNavigationItem {
  id: string | undefined;
  label: string;
  icon: ReactNode;
}

export const TOP_SOURCE_ITEMS: readonly SourceNavigationItem[] = [
  { id: undefined, label: "All", icon: <AllIcon /> },
  { id: "rss", label: "Feeds", icon: <RssIcon /> },
  { id: "x", label: "X", icon: <span className="text-sm font-bold leading-none">X</span> },
  { id: "facebook", label: "Facebook", icon: <FacebookIcon /> },
  { id: "instagram", label: "Instagram", icon: <InstagramIcon /> },
  { id: "linkedin", label: "LinkedIn", icon: <LinkedInIcon /> },
] as const;

export const COMING_SOON_SOURCE_ITEMS: readonly SourceNavigationItem[] = [
  { id: "map", label: "Map", icon: <MapPinIcon /> },
] as const;
