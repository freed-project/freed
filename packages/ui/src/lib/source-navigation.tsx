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
import {
  PROVIDER_PRESENTATION,
  type ProviderPresentationStage,
  type SettingsProviderId,
} from "./provider-presentation.js";

export interface SourceNavigationItem {
  id: string | undefined;
  label: string;
  icon: ReactNode;
  stage?: ProviderPresentationStage;
}

function providerSourceItem(
  id: SettingsProviderId,
  icon: ReactNode,
): SourceNavigationItem {
  return { id, icon, ...PROVIDER_PRESENTATION[id] };
}

export function getTopSourceItems(useShortLabels = false): readonly SourceNavigationItem[] {
  return [
    { id: undefined, label: useShortLabels ? "Feed" : "Unified Feed", icon: <AllIcon /> },
    { id: "rss", label: "Feeds", icon: <RssIcon /> },
    providerSourceItem("x", <XIcon />),
    providerSourceItem("facebook", <FacebookIcon />),
    providerSourceItem("instagram", <InstagramIcon />),
    providerSourceItem("linkedin", <LinkedInIcon />),
    providerSourceItem("substack", <SubstackIcon />),
    providerSourceItem("medium", <MediumIcon />),
    providerSourceItem("youtube", <YoutubeIcon />),
  ] as const;
}

export const TOP_SOURCE_ITEMS: readonly SourceNavigationItem[] = [
  ...getTopSourceItems(false),
] as const;

export const COMING_SOON_SOURCE_ITEMS: readonly SourceNavigationItem[] = [
  { id: "map", label: "Map", icon: <MapPinIcon /> },
] as const;
