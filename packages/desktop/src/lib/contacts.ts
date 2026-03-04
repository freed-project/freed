/**
 * Native macOS contact picker via Tauri.
 *
 * Calls the `pick_contact` Tauri command, which will present the system
 * CNContactStore picker once the `objc2-contacts` integration is complete.
 * Until then the command returns an error and this function returns null,
 * causing FriendEditor to fall back to manual entry.
 */

interface ContactPickerResult {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  nativeId?: string;
}

/**
 * Open the native macOS contact picker and return the selected contact.
 * Returns null if the user cancels, the command errors, or the integration
 * is not yet implemented.
 */
export async function pickContactViaTauri(): Promise<ContactPickerResult | null> {
  try {
    if (!window.__TAURI__) return null;
    const result = await window.__TAURI__.core.invoke<{
      name: string;
      phone: string | null;
      email: string | null;
      address: string | null;
      native_id: string | null;
    } | null>("pick_contact");

    if (!result) return null;

    return {
      name: result.name,
      phone: result.phone ?? undefined,
      email: result.email ?? undefined,
      address: result.address ?? undefined,
      nativeId: result.native_id ?? undefined,
    };
  } catch {
    // Command not yet implemented or user cancelled — treat as no selection.
    return null;
  }
}
