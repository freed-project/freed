import type { Metadata } from "next";
import RoadmapContent from "./RoadmapContent";

export const metadata: Metadata = {
  title: "Roadmap",
  description:
    "The FREED project roadmap. Where we are, where we're going, fully transparent. Track our progress from foundation to Friend Map.",
};

export default function RoadmapPage() {
  return <RoadmapContent />;
}
