"use client";

import { motion } from "framer-motion";

const steps = [
  {
    number: "01",
    title: "Download the App",
    description:
      "Native app for Mac, Windows, and Linux. Your escape pod from algorithmic purgatory.",
  },
  {
    number: "02",
    title: "Connect Your Accounts",
    description: "Sign into X, Facebook, Insta, and more. All sources unified.",
  },
  {
    number: "03",
    title: "Let It Rip",
    description:
      "Lives in your menu bar and captures all posts & updates to a secure vault on your machine.",
  },
  {
    number: "04",
    title: "Read Anywhere",
    description:
      "Phone syncs with desktop like magic. Your feed follows you. Their servers don't.",
  },
];

export default function HowItWorks() {
  return (
    <section className="relative overflow-hidden px-8 py-8 sm:px-6 sm:py-24 md:px-12 lg:px-8">
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, transparent, color-mix(in srgb, var(--theme-accent-secondary) 5%, transparent), transparent)",
        }}
      />

      <div className="max-w-6xl mx-auto relative z-10">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-8 text-center sm:mb-16"
        >
          <h2 className="theme-display-large mb-3 text-4xl font-bold md:text-5xl sm:mb-4">
            How It <span className="theme-heading-accent">Works</span>
          </h2>
          <p className="max-w-2xl mx-auto text-base text-text-secondary sm:text-lg">
            Four simple steps to digital sovereignty.
          </p>
        </motion.div>

        {/* Steps */}
        <div className="relative">
          <div
            className="hidden lg:block absolute top-1/2 left-0 right-0 h-px -translate-y-1/2"
            style={{
              background:
                "linear-gradient(to right, transparent, color-mix(in srgb, var(--theme-accent-secondary) 28%, transparent), transparent)",
            }}
          />

          <div className="grid grid-cols-1 gap-4 sm:gap-8 md:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <motion.div
                key={step.number}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.15 }}
                className="relative"
              >
                <div className="glass-card h-full p-5 sm:p-6">
                  <div className="relative z-10 mb-3 flex items-center gap-3 sm:mb-4 sm:block">
                    <span
                      className="shrink-0 text-3xl font-bold leading-none opacity-55 sm:text-5xl"
                      style={{ color: "var(--theme-heading-accent)" }}
                    >
                      {step.number}
                    </span>
                    <h3 className="text-lg font-semibold leading-tight text-text-primary sm:mt-4 sm:text-xl">
                      {step.title}
                    </h3>
                  </div>
                  <p className="text-sm text-text-secondary">
                    {step.description}
                  </p>
                </div>

                {/* Connector dot */}
                {index < steps.length - 1 && (
                  <div
                    className="hidden lg:block absolute top-1/2 -right-5 h-2 w-2 rounded-full glow-sm -translate-y-1/2 z-20"
                    style={{ background: "var(--theme-heading-accent)" }}
                  />
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
