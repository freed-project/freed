import styles from "./artwork.module.css";

export default function HeroArtwork() {
  return (
    <figure className={styles.flight}>
      <svg
        viewBox="0 0 500 460"
        role="img"
        aria-label="Stories fold into paper birds and take flight through an open frame"
      >
        <defs>
          <linearGradient id="flight-paper" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="var(--theme-text-primary)" />
            <stop offset="1" stopColor="var(--theme-text-secondary)" />
          </linearGradient>
          <linearGradient id="flight-wing">
            <stop stopColor="var(--theme-accent-secondary)" />
            <stop offset="1" stopColor="var(--theme-heading-accent)" />
          </linearGradient>
        </defs>
        <circle
          cx="290"
          cy="185"
          r="150"
          fill="var(--theme-heading-accent)"
          opacity=".06"
        />
        <path
          d="M115 352V151Q115 45 220 45Q325 45 325 151V350"
          fill="none"
          stroke="var(--theme-border-strong)"
          strokeWidth="2"
        />
        <path
          d="M135 352V155Q135 65 220 65Q305 65 305 155V350"
          fill="none"
          stroke="var(--theme-border-subtle)"
        />
        <path
          d="M70 376Q240 415 403 177"
          fill="none"
          stroke="var(--theme-heading-accent)"
          strokeDasharray="3 9"
          opacity=".6"
        />
        <g transform="translate(55 285) rotate(-14)">
          <rect
            width="126"
            height="88"
            rx="5"
            fill="var(--theme-bg-surface)"
            stroke="var(--theme-border-strong)"
          />
          <rect
            x="13"
            y="15"
            width="31"
            height="27"
            rx="3"
            fill="var(--theme-heading-accent)"
            opacity=".4"
          />
          <path
            d="M55 19H109M55 28H96M55 37H104M13 58H110M13 68H90"
            stroke="var(--theme-text-secondary)"
            strokeWidth="3"
            opacity=".5"
          />
        </g>
        <g transform="translate(150 226) rotate(-15)">
          <path d="M0 45L135 0L80 100L56 61Z" fill="url(#flight-paper)" />
          <path
            d="M56 61L135 0L74 72L80 100Z"
            fill="var(--theme-heading-accent)"
          />
          <path d="M0 45L135 0L56 61Z" fill="var(--theme-text-primary)" />
        </g>
        <g transform="translate(263 143) rotate(-9)">
          <path d="M0 30L140 0L83 79L60 46Z" fill="url(#flight-wing)" />
          <path
            d="M60 46L140 0L75 54L83 79Z"
            fill="var(--theme-bg-deep)"
            opacity=".55"
          />
          <path d="M0 30L140 0L60 46Z" fill="var(--theme-accent-secondary)" />
        </g>
        <g transform="translate(365 78) rotate(4)">
          <path d="M0 20L91 0L54 54L39 32Z" fill="url(#flight-paper)" />
          <path
            d="M39 32L91 0L48 38L54 54Z"
            fill="var(--theme-heading-accent)"
          />
        </g>
        <path
          d="M400 35v14m-7-7h14M62 206v10m-5-5h10M367 313v14m-7-7h14"
          stroke="var(--theme-text-secondary)"
          opacity=".5"
        />
      </svg>
    </figure>
  );
}
