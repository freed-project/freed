"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

const hidden = {
  opacity: 0,
  scale: 0.98,
  y: 12,
};

const visible = {
  opacity: 1,
  scale: 1,
  y: 0,
};

interface VisionRevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  enterOnLoad?: boolean;
}

export default function VisionReveal({
  children,
  className,
  delay = 0,
  enterOnLoad = false,
}: VisionRevealProps) {
  const reduceMotion = useReducedMotion();
  const initial = reduceMotion ? false : hidden;
  const transition = {
    delay: reduceMotion ? 0 : delay,
    duration: reduceMotion ? 0 : 0.65,
    ease: [0.22, 1, 0.36, 1] as const,
  };

  if (enterOnLoad) {
    return (
      <motion.div
        initial={initial}
        animate={visible}
        transition={transition}
        className={className}
        style={{ transformOrigin: "50% 20%" }}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={initial}
      whileInView={visible}
      viewport={{ once: true, amount: 0.12 }}
      transition={transition}
      className={className}
      style={{ transformOrigin: "50% 20%" }}
    >
      {children}
    </motion.div>
  );
}
