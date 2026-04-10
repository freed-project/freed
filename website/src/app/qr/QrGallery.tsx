"use client";

import Image from "next/image";
import Link from "next/link";

const qrAsset = {
  asset: "/qr/classic-neon.svg",
};

export default function QrGallery() {
  return (
    <section className="relative min-h-screen overflow-hidden">
      <div className="theme-shell absolute inset-0 pointer-events-none" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col bg-[color-mix(in_oklab,var(--theme-bg-root)_78%,transparent)] px-4 py-6 shadow-[0_25px_120px_rgba(0,0,0,0.22)] backdrop-blur-sm sm:px-6 sm:py-8 lg:px-10 lg:py-10">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-x-[14%] top-[14%] h-[40%] rounded-full blur-3xl" style={{ background: "radial-gradient(circle at center, rgb(var(--theme-accent-tertiary-rgb) / 0.18), rgb(var(--theme-accent-primary-rgb) / 0.12) 38%, transparent 70%)" }} />
        </div>

        <div className="relative flex flex-1 flex-col items-center justify-between">
          <header className="w-full text-center">
            <h1 className="mx-auto max-w-4xl text-5xl font-bold tracking-[-0.06em] text-[var(--theme-text-primary)] sm:text-6xl lg:text-7xl">
              Scan to take back your feed
            </h1>
          </header>

          <div className="relative mt-10 flex w-full flex-1 items-center justify-center py-6 sm:py-10">
            <div className="relative mx-auto w-full max-w-[46rem] rounded-[2.2rem] border border-[var(--theme-border-subtle)] bg-[var(--theme-bg-card)] p-4 shadow-[0_40px_130px_rgba(0,0,0,0.14)] sm:p-6 lg:p-7">
              <div className="absolute inset-0 rounded-[2.2rem] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--theme-text-primary)_10%,transparent),transparent)]" />
              <div className="relative rounded-[1.7rem] bg-white p-5 shadow-[0_20px_80px_rgba(15,23,42,0.22)] sm:p-8">
                <Image
                  src={qrAsset.asset}
                  alt="QR code linking to Freed home page"
                  width={666}
                  height={666}
                  unoptimized
                  className="aspect-square h-auto w-full rounded-[1.1rem]"
                />
              </div>
            </div>
          </div>

          <footer className="w-full pt-10 pb-6 text-center sm:pt-12 sm:pb-8">
            <Link
              href="/"
              className="text-xl font-semibold tracking-[0.12em] text-[var(--theme-text-primary)] transition-opacity hover:opacity-80 sm:text-2xl"
            >
              Freed.wtf
            </Link>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-text-secondary sm:text-lg">
              Built for humans, not algorithms.
            </p>
          </footer>
        </div>
      </div>
    </section>
  );
}
