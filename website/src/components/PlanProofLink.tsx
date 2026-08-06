import Link from "next/link";

const destinations = {
  plan: {
    href: "/roadmap",
    eyebrow: "Roadmap",
    label: "See what we intend to build",
    arrowDirection: "forward",
  },
  proof: {
    href: "/changelog",
    eyebrow: "Updates",
    label: "See what actually shipped",
    arrowDirection: "back",
  },
} as const;

type PlanProofLinkProps = {
  destination: keyof typeof destinations;
  className?: string;
};

function Arrow({ direction }: { direction: "forward" | "back" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
        direction === "forward"
          ? "group-hover:translate-x-0.5"
          : "rotate-180 group-hover:-translate-x-0.5"
      }`}
    >
      <path
        d="M4 10h12m-4-4 4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlanProofLink({
  destination,
  className = "",
}: PlanProofLinkProps) {
  const link = destinations[destination];

  return (
    <Link
      href={link.href}
      className={`group inline-flex items-center gap-3 rounded-full border border-freed-border bg-freed-surface/40 px-4 py-2.5 text-left text-text-secondary transition-colors hover:border-text-muted hover:bg-freed-surface/70 hover:text-text-primary ${className}`.trim()}
    >
      <Arrow direction={link.arrowDirection} />
      <span className="flex flex-col">
        <span className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
          {link.eyebrow}
        </span>
        <span className="text-sm font-medium">{link.label}</span>
      </span>
    </Link>
  );
}
