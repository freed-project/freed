export const NAV_INDICATOR_SPRING = {
  type: "spring" as const,
  stiffness: 500,
  damping: 30,
};

export const NAV_INDICATOR_THICKNESS = {
  resting: 1,
  hovered: 2,
} as const;

export const NAV_INDICATOR_THICKNESS_TRANSITION = {
  duration: 0.18,
  ease: "easeOut" as const,
};
