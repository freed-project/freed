"use client";

import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useState, useCallback } from "react";
import { useNewsletter } from "@/context/NewsletterContext";
import type { Post } from "@/content";
import { MarketingPageShell } from "@/components/MarketingPageShell";

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
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(`https://freed.wtf/updates/${post.slug}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [post.slug]);

  return (
    <MarketingPageShell>
        {/* Back link */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-8"
        >
          <Link
            href="/updates"
            className="text-sm text-text-muted hover:text-[color:var(--theme-heading-accent)] transition-colors"
          >
            ‹ Back to Updates
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
                  {post.authorUrl ? (
                    <a
                      href={post.authorUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-text-muted hover:text-[color:var(--theme-heading-accent)] transition-colors"
                    >
                      {post.author}
                    </a>
                  ) : (
                    <span className="text-sm text-text-muted">
                      {post.author}
                    </span>
                  )}
                </>
              )}
            </div>
            <h1 className="theme-display-large text-3xl sm:text-4xl md:text-5xl font-bold text-text-primary mb-4">
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
          <div className="text-text-secondary space-y-6 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-text-primary [&_h2]:mt-10 [&_h2]:mb-4 [&_h3]:text-xl [&_h3]:font-bold [&_h3]:text-text-primary [&_h3]:mt-8 [&_h3]:mb-3 [&_a]:text-[color:var(--theme-heading-accent)] [&_a]:hover:text-text-primary [&_a]:transition-colors [&_strong]:text-text-primary [&_em]:text-text-primary [&_ul]:space-y-2 [&_ul]:pl-6 [&_ul]:list-disc [&_ol]:space-y-2 [&_ol]:pl-6 [&_ol]:list-decimal [&_li]:text-text-secondary [&_blockquote]:border-l-4 [&_blockquote]:border-[color:var(--theme-heading-accent)] [&_blockquote]:pl-6 [&_blockquote]:italic [&_blockquote]:text-text-primary [&_blockquote]:my-8 [&_code]:bg-freed-surface [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:text-[color:var(--theme-heading-accent)] [&_pre]:bg-freed-surface [&_pre]:p-4 [&_pre]:rounded-lg [&_pre]:overflow-x-auto">
            {post.content}
          </div>

          {/* Share */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-24 not-prose flex items-center justify-between"
          >
            <Link
              href="/updates"
              className="text-sm text-[color:var(--theme-heading-accent)] hover:text-text-primary transition-colors"
            >
              ‹ Back to Updates
            </Link>
            <p className="text-text-muted text-sm">
              <a
                href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(
                  `https://freed.wtf/updates/${post.slug}`,
                )}&text=${encodeURIComponent(post.title)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[color:var(--theme-heading-accent)] hover:text-text-primary transition-colors"
              >
                Share on X
              </a>
              <span className="mx-3 text-text-muted">•</span>
              <button
                onClick={handleCopy}
                className="relative cursor-pointer text-[color:var(--theme-heading-accent)] transition-colors hover:text-text-primary"
              >
                Copy link
                <AnimatePresence>
                  {copied && (
                    <motion.span
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="absolute -top-7 left-1/2 -translate-x-1/2 bg-freed-surface border border-freed-border text-text-primary text-xs px-2 py-1 rounded whitespace-nowrap"
                    >
                      Copied!
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            </p>
          </motion.div>

          {/* Footer */}
          <footer className="mt-8 pt-8 border-t border-freed-border not-prose">
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
                  target="_blank"
                  rel="noopener noreferrer"
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
    </MarketingPageShell>
  );
}
