const PRIVATE_KEY_BEGIN_MARKERS = [
  "-----BEGIN PRIVATE KEY-----",
  "-----BEGIN RSA PRIVATE KEY-----",
  "-----BEGIN EC PRIVATE KEY-----",
  "-----BEGIN OPENSSH PRIVATE KEY-----",
] as const;

const PRIVATE_KEY_END_MARKERS = [
  "-----END PRIVATE KEY-----",
  "-----END RSA PRIVATE KEY-----",
  "-----END EC PRIVATE KEY-----",
  "-----END OPENSSH PRIVATE KEY-----",
] as const;

function markerLengthAt(
  input: string,
  index: number,
  markers: readonly string[],
): number {
  for (const marker of markers) {
    if (input.startsWith(marker, index)) return marker.length;
  }
  return 0;
}

function redactPrivateKeyBlocks(input: string): string {
  const chunks: string[] = [];
  let blockStart = -1;
  let copyStart = 0;
  let index = 0;

  while (index < input.length) {
    if (input.charCodeAt(index) !== 45) {
      index += 1;
      continue;
    }

    if (blockStart < 0) {
      const markerLength = markerLengthAt(
        input,
        index,
        PRIVATE_KEY_BEGIN_MARKERS,
      );
      if (markerLength > 0) {
        chunks.push(input.slice(copyStart, index));
        blockStart = index;
        index += markerLength;
        continue;
      }
    } else {
      const markerLength = markerLengthAt(
        input,
        index,
        PRIVATE_KEY_END_MARKERS,
      );
      if (markerLength > 0) {
        chunks.push("[REDACTED_PRIVATE_KEY]");
        index += markerLength;
        copyStart = index;
        blockStart = -1;
        continue;
      }
    }

    index += 1;
  }

  chunks.push(input.slice(blockStart >= 0 ? blockStart : copyStart));
  return chunks.join("");
}

const SECRET_ASSIGNMENT =
  /\b(auth(?:orization)?|token|auth[_-]?token|access[_-]?token|refresh[_-]?token|key|api[_-]?key|client[_-]?secret|password|passwd|cookie|session|secret|signature|sig)\b(?:\s*[:=]\s*|["']\s*:\s*["'])(?:Bearer\s+|Basic\s+)?["']?([^\s,"'};]+)/gi;

/**
 * Remove credentials and local identity details from diagnostics before they
 * leave the device. Callers at trust boundaries should apply this even when
 * the input was already redacted by a collector.
 */
export function redactSensitiveText(input: string): string {
  return redactPrivateKeyBlocks(input)
    .replace(
      /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.:-]+/gi,
      "Bearer [REDACTED]",
    )
    .replace(SECRET_ASSIGNMENT, "$1=[REDACTED]")
    .replace(
      /([?&](?:token|code|state|auth|key|api_key|client_secret|sig|signature|session|password)=)[^&\s#]+/gi,
      "$1[REDACTED]",
    )
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]")
    .replace(
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
      "[REDACTED_JWT]",
    )
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, "$1[REDACTED]@")
    .replace(/\/Users\/[^/\s]+/g, "/Users/[REDACTED]")
    .replace(/\/home\/[^/\s]+/g, "/home/[REDACTED]")
    .replace(/C:\\Users\\[^\\\s]+/gi, "C:\\Users\\[REDACTED]")
    .replace(
      /\b[A-Za-z0-9_+.-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
      "[REDACTED_EMAIL]",
    );
}
