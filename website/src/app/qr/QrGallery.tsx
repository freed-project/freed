"use client";

import Image from "next/image";
import Link from "next/link";

const qrAsset = {
  asset: "/qr/classic-neon.svg",
};

export default function QrGallery() {
  return (
    <section className="relative min-h-screen overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(6,182,212,0.20),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.18),transparent_30%),linear-gradient(180deg,rgba(10,10,10,0.84),rgba(10,10,10,0.98))]" />
        <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:72px_72px]" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col bg-black/25 px-4 py-6 shadow-[0_25px_120px_rgba(0,0,0,0.45)] backdrop-blur-sm sm:px-6 sm:py-8 lg:px-10 lg:py-10">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-x-[14%] top-[14%] h-[40%] rounded-full blur-3xl bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.22),rgba(59,130,246,0.14)_38%,transparent_70%)]" />
        </div>

        <div className="relative flex flex-1 flex-col items-center justify-between">
          <header className="w-full text-center">
            <h1 className="mx-auto max-w-4xl text-5xl font-bold tracking-[-0.06em] text-white sm:text-6xl lg:text-7xl">
              Scan to take back your feed
            </h1>
          </header>

          <div className="relative mt-10 flex w-full flex-1 items-center justify-center py-6 sm:py-10">
            <div className="relative mx-auto w-full max-w-[46rem] rounded-[2.2rem] border border-cyan-300/14 bg-white/[0.07] p-4 shadow-[0_40px_130px_rgba(6,182,212,0.16)] sm:p-6 lg:p-7">
              <div className="absolute inset-0 rounded-[2.2rem] bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))]" />
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
              className="text-xl font-semibold tracking-[0.12em] text-white transition-opacity hover:opacity-80 sm:text-2xl"
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
