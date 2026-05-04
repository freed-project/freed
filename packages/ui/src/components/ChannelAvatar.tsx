import { useRef, useState } from "react";
import {
  channelInitialForName,
  createAvatarImageFailureStore,
} from "../lib/friend-avatar.js";

interface ChannelAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size: number;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
}

export function ChannelAvatar({
  name,
  avatarUrl,
  size,
  className = "",
  imageClassName = "",
  fallbackClassName = "",
}: ChannelAvatarProps) {
  const [, setFailureVersion] = useState(0);
  const failureStoreRef = useRef(createAvatarImageFailureStore());
  const resolvedUrl = avatarUrl || null;
  const showImage = !!resolvedUrl && !failureStoreRef.current.has(resolvedUrl);
  const initial = channelInitialForName(name);

  return (
    <div
      className={`theme-avatar-fallback relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-medium ${className}`.trim()}
      data-avatar-url={resolvedUrl ?? ""}
      data-avatar-name={name}
      style={{
        width: `${size}px`,
        height: `${size}px`,
      }}
    >
      {showImage ? (
        <img
          src={resolvedUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => {
            failureStoreRef.current.mark(resolvedUrl);
            setFailureVersion((version) => version + 1);
          }}
          className={`h-full w-full rounded-full object-cover ${imageClassName}`.trim()}
        />
      ) : (
        <span className={fallbackClassName}>{initial}</span>
      )}
    </div>
  );
}
