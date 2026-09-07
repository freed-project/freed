"use client";

import type { ComponentPropsWithoutRef } from "react";
import { useTheme } from "@/context/ThemeContext";

export default function DemoLink(props: Omit<ComponentPropsWithoutRef<"a">, "href">) {
  const { themeId } = useTheme();
  return <a {...props} href={`https://demo.freed.wtf/?theme=${encodeURIComponent(themeId)}`} target="_blank" rel="noopener noreferrer" />;
}
