import { useState, useRef, useCallback, type ReactNode } from "react";

interface PullToRefreshProps {
  children: ReactNode;
  onRefresh: () => Promise<void>;
  threshold?: number; // Pull distance to trigger refresh
}

export function PullToRefresh({
  children,
  onRefresh,
  threshold = 80,
}: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const isPulling = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Only enable pull-to-refresh at the top of scroll
    if (containerRef.current && containerRef.current.scrollTop === 0) {
      startY.current = e.touches[0].clientY;
      isPulling.current = true;
    }
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isPulling.current || isRefreshing) return;

      const currentY = e.touches[0].clientY;
      const diff = currentY - startY.current;

      // Only pull down, not up
      if (diff > 0) {
        // Apply resistance to make it feel natural
        const resistance = Math.min(diff * 0.5, threshold * 1.5);
        setPullDistance(resistance);

        // Prevent default scroll when pulling
        if (containerRef.current && containerRef.current.scrollTop === 0) {
          e.preventDefault();
        }
      }
    },
    [isRefreshing, threshold]
  );

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current) return;
    isPulling.current = false;

    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(50); // Keep indicator visible during refresh

      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, threshold, isRefreshing, onRefresh]);

  const progress = Math.min(pullDistance / threshold, 1);
  const showIndicator = pullDistance > 10 || isRefreshing;

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull indicator */}
      <div
        className="flex justify-center items-center transition-all duration-200 overflow-hidden"
        style={{
          height: showIndicator ? pullDistance : 0,
          opacity: showIndicator ? 1 : 0,
        }}
      >
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center ${
            isRefreshing ? "animate-spin" : ""
          }`}
          style={{
            transform: `rotate(${progress * 360}deg)`,
            background: `conic-gradient(from 0deg, #8b5cf6 ${progress * 100}%, transparent ${progress * 100}%)`,
          }}
        >
          <div className="w-6 h-6 rounded-full bg-[#0a0a0a]" />
        </div>
      </div>

      {/* Content with transform for pull effect */}
      <div
        className="transition-transform duration-200"
        style={{
          transform:
            pullDistance > 0 && !isRefreshing
              ? `translateY(${pullDistance * 0.3}px)`
              : "translateY(0)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
