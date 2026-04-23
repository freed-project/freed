import { useEffect, useState } from "react";

interface NavigatorWithUserAgentData extends Navigator {
  userAgentData?: {
    mobile?: boolean;
  };
}

function detectMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;

  const navigatorWithUserAgentData = navigator as NavigatorWithUserAgentData;
  if (typeof navigatorWithUserAgentData.userAgentData?.mobile === "boolean") {
    return navigatorWithUserAgentData.userAgentData.mobile;
  }

  const ua = navigator.userAgent ?? "";
  const platform = navigator.platform ?? "";
  const maxTouchPoints = navigator.maxTouchPoints ?? 0;
  const mobileUserAgent =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const iPadOsDesktopUserAgent =
    platform === "MacIntel" && maxTouchPoints > 1;

  return mobileUserAgent || iPadOsDesktopUserAgent;
}

export function useIsMobileDevice(): boolean {
  const [isMobileDevice, setIsMobileDevice] = useState(detectMobileDevice);

  useEffect(() => {
    setIsMobileDevice(detectMobileDevice());
  }, []);

  return isMobileDevice;
}
