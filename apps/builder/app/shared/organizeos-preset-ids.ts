/**
 * The deterministic ids of an OrganizeOS org project's data presets, shared by
 * provisioning on the server (`shared/db/resource-presets.server.ts`,
 * `shared/db/signup-form-preset.server.tsx`) and the OrganizeOS panel in the
 * browser, which finds the Events preset and adds the Forms preset at insert
 * time (`builder/features/organizeos-panel`). Both sides must derive the same
 * id from the same name, so a preset the panel adds is the one a later
 * re-provision rewrites in place, never a second copy.
 *
 * One implementation on WebCrypto (`globalThis.crypto.subtle`), which the
 * browser and Node 22 both provide. It is async because `digest` is.
 */

// Fixed namespace for preset-derived ids. Do not change: it would orphan the
// presets already seeded into live projects.
const PRESET_NAMESPACE = "3f2a1b7c-8d5e-45a1-9b2c-6e0d1a2b3c4d";

const hexToBytes = (hex: string) => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

const namespaceBytes = hexToBytes(PRESET_NAMESPACE.replaceAll("-", ""));

/** RFC 4122 v5 (SHA-1, namespaced) UUID in the preset namespace. */
export const uuidV5 = async (name: string): Promise<string> => {
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(namespaceBytes.length + nameBytes.length);
  input.set(namespaceBytes);
  input.set(nameBytes, namespaceBytes.length);
  const digest = await globalThis.crypto.subtle.digest("SHA-1", input);
  const bytes = new Uint8Array(digest).slice(0, 16);
  // Set version (5) and the RFC 4122 variant.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

/**
 * The ids of a /v1 preset (`key` is its path name: "events", "forms", ...):
 * its GET Resource and the resource DataSource that binds it.
 */
export const getResourcePresetIds = async (
  projectId: string,
  key: string
): Promise<{ resourceId: string; bindingId: string }> => {
  const [resourceId, bindingId] = await Promise.all([
    uuidV5(`${projectId}:v1:${key}:resource`),
    uuidV5(`${projectId}:v1:${key}:binding`),
  ]);
  return { resourceId, bindingId };
};
