/**
 * Web Contact Picker API integration for the PWA.
 *
 * Available in:
 *   - Safari on iOS 14.5+
 *   - Chrome on Android
 *
 * Not available in any desktop browser — callers receive null, which causes
 * FriendEditor to fall back to a manual entry form.
 */

interface ContactPickerResult {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
}

/**
 * Returns true when the Contact Picker API is available in this browser.
 */
export function isContactPickerAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "contacts" in navigator &&
    "ContactsManager" in window
  );
}

/**
 * Opens the native contact picker and returns the selected contact's details.
 * Returns null when the API is unavailable or the user cancels.
 */
export async function pickContactViaWebApi(): Promise<ContactPickerResult | null> {
  if (!isContactPickerAvailable()) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contacts = await (navigator as any).contacts.select(
      ["name", "tel", "email", "address"],
      { multiple: false }
    );

    if (!contacts || contacts.length === 0) return null;

    const c = contacts[0];
    const name =
      Array.isArray(c.name) && c.name.length > 0
        ? String(c.name[0])
        : "Unknown";

    const phone =
      Array.isArray(c.tel) && c.tel.length > 0
        ? String(c.tel[0])
        : undefined;

    const email =
      Array.isArray(c.email) && c.email.length > 0
        ? String(c.email[0])
        : undefined;

    const address =
      Array.isArray(c.address) && c.address.length > 0
        ? formatAddress(c.address[0])
        : undefined;

    return { name, phone, email, address };
  } catch {
    // User cancelled or API threw — treat as no selection
    return null;
  }
}

// ContactAddress is a structured object in the Web API
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatAddress(addr: any): string {
  const parts: string[] = [
    addr.addressLine?.[0],
    addr.city,
    addr.region,
    addr.country,
  ].filter(Boolean);
  return parts.join(", ");
}
