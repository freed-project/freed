import { useAppStore } from "../../context/PlatformContext.js";
import { initialsForName } from "../../lib/friend-avatar.js";
import { createFriendAvatarPalette } from "../../lib/friend-avatar-style.js";

interface FriendAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size: number;
  className?: string;
}

export function FriendAvatar({
  name,
  avatarUrl,
  size,
  className = "",
}: FriendAvatarProps) {
  const themeId = useAppStore((state) => state.preferences.display.themeId);
  const palette = createFriendAvatarPalette(themeId);
  const initials = initialsForName(name);

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full ${className}`.trim()}
      data-avatar-url={avatarUrl ?? ""}
      data-avatar-name={name}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        border: `1px solid ${palette.borderStrong}`,
        boxShadow: `0 0 0 1px ${palette.borderSoft}, 0 0 18px ${palette.glowSoft}, var(--theme-marker-shadow-soft)`,
        background: `radial-gradient(circle at 30% 28%, ${palette.gradientStart}, ${palette.gradientMid} 34%, ${palette.gradientEnd} 100%)`,
      }}
    >
      {avatarUrl ? (
        <>
          <img
            src={avatarUrl}
            alt=""
            className="h-full w-full object-cover"
            style={{
              filter: "saturate(0.9) contrast(1.02) brightness(0.92)",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{ background: palette.imageOverlay }}
          />
          <div
            className="pointer-events-none absolute inset-[4px] rounded-full"
            style={{
              border: `1px solid ${palette.ring}`,
              background: `radial-gradient(circle at 30% 30%, ${palette.imageHighlight}, transparent 65%)`,
            }}
          />
        </>
      ) : (
        <div
          className="flex h-full w-full items-center justify-center font-semibold"
          style={{
            color: palette.text,
            textShadow: `0 0 14px ${palette.initialsShadow}`,
            fontSize: `${Math.max(14, Math.round(size * 0.38))}px`,
          }}
        >
          {initials}
        </div>
      )}
    </div>
  );
}
