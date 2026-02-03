"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { posts } from "@/content";
import { useNewsletter } from "@/context/NewsletterContext";

function formatDate(dateString: string): string {
  // Parse as local date to avoid timezone shift
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function UpdatesContent() {
  const { openModal } = useNewsletter();

  return (
    <section className="py-24 sm:py-32 px-4 sm:px-6 md:px-12 lg:px-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12 sm:mb-16"
        >
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold mb-4 sm:mb-6">
            <span className="gradient-text">Updates</span>
          </h1>
          <p className="text-text-secondary text-lg sm:text-xl mb-6">
            Progress updates, technical deep-dives, and the occasional
            philosophical rant.
          </p>

          {/* RSS + Subscribe */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="/feed.xml"
              className="flex items-center gap-2 text-sm text-text-muted hover:text-glow-purple transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19 7.38 20 6.18 20C5 20 4 19 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1Z" />
              </svg>
              Subscribe via RSS
            </a>
            <span className="text-text-muted hidden sm:inline">•</span>
            <button
              onClick={openModal}
              className="text-sm text-glow-purple hover:text-glow-blue transition-colors"
            >
              Get email updates →
            </button>
          </div>
        </motion.header>

        {/* Posts List */}
        <div className="space-y-6">
          {posts.map((post, index) => (
            <motion.article
              key={post.slug}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
            >
              <Link
                href={`/updates/${post.slug}`}
                className="block glass-card p-6 sm:p-8 rounded-xl transition-all hover:scale-[1.01] group"
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
                  <time className="text-sm text-text-muted">
                    {formatDate(post.date)}
                  </time>
                  {post.tags && (
                    <div className="flex gap-2">
                      {post.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-xs px-2 py-0.5 rounded-full bg-freed-surface text-text-muted"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-text-primary mb-2 group-hover:text-glow-purple transition-colors">
                  {post.title}
                </h2>
                <p className="text-text-secondary">{post.description}</p>
                <span className="inline-block mt-4 text-sm text-glow-purple group-hover:translate-x-1 transition-transform">
                  Read more →
                </span>
              </Link>
            </motion.article>
          ))}
        </div>

        {/* Empty state */}
        {posts.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16"
          >
            <p className="text-text-secondary text-lg">
              No updates yet. Subscribe to be notified when we publish.
            </p>
          </motion.div>
        )}

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mt-16 text-center border-t border-freed-border pt-12"
        >
          <p className="text-text-secondary mb-4">
            Get updates delivered to your inbox.
          </p>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={openModal}
            className="btn-primary"
          >
            Subscribe to Newsletter
          </motion.button>
        </motion.div>
      </div>
    </section>
  );
}
