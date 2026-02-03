"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useNewsletter } from "@/context/NewsletterContext";
import type { Post } from "@/content";

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

interface PostContentProps {
  post: Post;
}

export default function PostContent({ post }: PostContentProps) {
  const { openModal } = useNewsletter();

  return (
    <section className="py-24 sm:py-32 px-4 sm:px-6 md:px-12 lg:px-8">
      <div className="max-w-3xl mx-auto">
        {/* Back link */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-8"
        >
          <Link
            href="/updates"
            className="text-sm text-text-muted hover:text-glow-purple transition-colors"
          >
            ← Back to Updates
          </Link>
        </motion.div>

        <motion.article
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="prose prose-invert prose-base sm:prose-lg"
        >
          {/* Header */}
          <header className="mb-10 sm:mb-12 not-prose">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <time className="text-sm text-text-muted">
                {formatDate(post.date)}
              </time>
              {post.author && (
                <>
                  <span className="text-text-muted">•</span>
                  <span className="text-sm text-text-muted">{post.author}</span>
                </>
              )}
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-text-primary mb-4">
              {post.title}
            </h1>
            <p className="text-lg text-text-secondary">{post.description}</p>
            {post.tags && (
              <div className="flex flex-wrap gap-2 mt-4">
                {post.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-3 py-1 rounded-full bg-freed-surface border border-freed-border text-text-muted"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </header>

          {/* Content */}
          <div className="text-text-secondary space-y-6 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-text-primary [&_h2]:mt-10 [&_h2]:mb-4 [&_h3]:text-xl [&_h3]:font-bold [&_h3]:text-text-primary [&_h3]:mt-8 [&_h3]:mb-3 [&_a]:text-glow-purple [&_a]:hover:text-glow-blue [&_a]:transition-colors [&_strong]:text-text-primary [&_em]:text-text-primary [&_ul]:space-y-2 [&_ul]:pl-6 [&_ul]:list-disc [&_ol]:space-y-2 [&_ol]:pl-6 [&_ol]:list-decimal [&_li]:text-text-secondary [&_blockquote]:border-l-4 [&_blockquote]:border-glow-purple [&_blockquote]:pl-6 [&_blockquote]:italic [&_blockquote]:text-text-primary [&_blockquote]:my-8 [&_code]:bg-freed-surface [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:text-glow-purple [&_pre]:bg-freed-surface [&_pre]:p-4 [&_pre]:rounded-lg [&_pre]:overflow-x-auto">
            {post.content}
          </div>

          {/* Footer */}
          <footer className="mt-16 pt-8 border-t border-freed-border not-prose">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <p className="text-text-secondary text-sm mb-1">
                  Enjoyed this update?
                </p>
                <p className="text-text-muted text-sm">Subscribe for more.</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href="/feed.xml"
                  className="btn-secondary text-sm flex items-center gap-2"
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19 7.38 20 6.18 20C5 20 4 19 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1Z" />
                  </svg>
                  RSS
                </a>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={openModal}
                  className="btn-primary text-sm"
                >
                  Subscribe to Newsletter
                </motion.button>
              </div>
            </div>
          </footer>
        </motion.article>

        {/* Share */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-8 text-center"
        >
          <p className="text-text-muted text-sm">
            Share this post:{" "}
            <a
              href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(
                `https://freed.wtf/updates/${post.slug}`
              )}&text=${encodeURIComponent(post.title)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-glow-purple hover:text-glow-blue transition-colors"
            >
              X
            </a>
            {" • "}
            <button
              onClick={() =>
                navigator.clipboard.writeText(
                  `https://freed.wtf/updates/${post.slug}`
                )
              }
              className="text-glow-purple hover:text-glow-blue transition-colors"
            >
              Copy link
            </button>
          </p>
        </motion.div>
      </div>
    </section>
  );
}
