"use client";

import Image from "next/image";
import Link from "next/link";

const qrAsset = {
  asset: "/qr/classic-neon.svg",
};

export default function QrGallery() {
  return (
    <section className="relative min-h-[100dvh] overflow-y-auto overflow-x-hidden bg-[var(--theme-bg-root)]">
      <div className="theme-shell absolute inset-0 pointer-events-none" />

      <div
        className="relative z-10 mx-auto flex min-h-[100dvh] max-w-7xl flex-col px-4 sm:px-6 lg:px-8"
      >
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-x-[14%] top-[14%] h-[40%] rounded-full blur-3xl" style={{ background: "radial-gradient(circle at center, rgb(var(--theme-accent-tertiary-rgb) / 0.18), rgb(var(--theme-accent-primary-rgb) / 0.12) 38%, transparent 70%)" }} />
        </div>

        <div
          className="relative grid min-h-[100dvh] w-full items-center"
          style={{ gridTemplateRows: "minmax(clamp(0.75rem,2.6dvh,2rem),1fr) auto minmax(clamp(0.75rem,2.6dvh,2rem),1fr) auto minmax(clamp(0.75rem,2.6dvh,2rem),1fr) auto minmax(clamp(0.75rem,2.6dvh,2rem),1fr)" }}
        >
          <div aria-hidden="true" />

          <header className="w-full text-center">
            <h1 className="theme-display-large mx-auto max-w-5xl text-[clamp(2.15rem,6vw,5.1rem)] font-black leading-[0.88] tracking-[-0.065em]">
              <span className="gradient-text inline-block">Scan to take back your feed</span>
            </h1>
          </header>

          <div aria-hidden="true" />

          <div className="relative flex w-full items-center justify-center">
            <div className="relative mx-auto aspect-square w-[clamp(10rem,min(84vw,50dvh,31rem),31rem)] min-w-0 rounded-[2rem] bg-white p-[clamp(0.1rem,0.3dvh,0.18rem)] shadow-[0_24px_56px_rgba(0,0,0,0.1)] sm:w-[clamp(10rem,min(78vw,48dvh,32rem),32rem)]">
              <div className="relative size-full rounded-[1.75rem] bg-white">
                <Image
                  src={qrAsset.asset}
                  alt="QR code linking to Freed home page"
                  width={666}
                  height={666}
                  unoptimized
                  className="size-full rounded-[1.65rem]"
                />
              </div>
            </div>
          </div>

          <div aria-hidden="true" />

          <footer className="w-full text-center">
            <Link
              href="/"
              className="inline-flex items-baseline gap-0.5 transition-opacity hover:opacity-80"
            >
              <span className="relative text-[clamp(1.15rem,2vw,1.5rem)] font-bold text-text-primary font-logo">
                FREED
                <span
                  className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                  style={{
                    background: "var(--theme-logo-spectrum)",
                  }}
                />
              </span>
              <span className="text-[clamp(0.8rem,1.2vw,1rem)] font-bold gradient-text font-logo">
                .WTF
              </span>
            </Link>
            <p className="mx-auto mt-[clamp(0.35rem,1.2dvh,0.7rem)] max-w-2xl text-[clamp(0.9rem,1.35vw,1rem)] leading-[1.45] text-text-secondary">
              Built for humans, not algorithms.
            </p>
          </footer>

          <div aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
