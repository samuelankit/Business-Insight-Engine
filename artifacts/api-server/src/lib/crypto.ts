/**
 * Envelope encryption with per-record DEKs (Data Encryption Keys).
 *
 * Security model:
 * - Each record gets a unique 256-bit DEK
 * - The DEK is encrypted by a platform-level KEK (ENCRYPTION_KEY env var)
 * - Data is encrypted with the DEK using AES-256-GCM
 * - Rotating the KEK requires only re-encrypting DEKs, not all data
 *
 * Fix: Replaces single-key encryption with envelope encryption.
 */

import { randomBytes, createCipheriv, createDecipheriv, createHash } from "crypto";

let KEK_HEX = process.env["ENCRYPTION_KEY"];

if (!KEK_HEX || KEK_HEX.length !== 64) {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "ENCRYPTION_KEY env var must be a 64-character hex string (32 bytes).",
    );
  }
  // Development fallback — deterministic key derived from REPL_ID
  // WARNING: NOT secure for production — always set ENCRYPTION_KEY in production.
  const seed = process.env["REPL_ID"] ?? "gorigo-dev-fallback";
  KEK_HEX = createHash("sha256").update(seed).digest("hex");
  console.warn("[crypto] ENCRYPTION_KEY not set — using dev fallback. Set ENCRYPTION_KEY in production!");
}

const KEK = Buffer.from(KEK_HEX, "hex");

export interface EncryptedPayload {
  iv: string;
  ciphertext: string;
  authTag: string;
  encryptedDek: string;
}

/** Generate a fresh random DEK (Data Encryption Key) */
function generateDek(): Buffer {
  return randomBytes(32);
}

/** Encrypt the DEK with the platform KEK */
function encryptDek(dek: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEK, iv);
  const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
    authTag: authTag.toString("hex"),
  });
}

/** Decrypt the DEK using the platform KEK */
function decryptDek(encryptedDek: string): Buffer {
  const { iv, ciphertext, authTag } = JSON.parse(encryptedDek);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    KEK,
    Buffer.from(iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "hex")),
    decipher.final(),
  ]);
}

/**
 * Encrypt a plaintext string with envelope encryption.
 * Returns { encryptedPayload: string, encryptedDek: string }
 * Store both in the database.
 */
export function encrypt(plaintext: string): {
  encryptedPayload: string;
  encryptedDek: string;
} {
  const dek = generateDek();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dek, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  const encryptedPayload = JSON.stringify({
    iv: iv.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
    authTag: authTag.toString("hex"),
  });

  const encryptedDek = encryptDek(dek);
  return { encryptedPayload, encryptedDek };
}

/**
 * Decrypt a previously encrypted payload using its stored DEK.
 */
export function decrypt(encryptedPayload: string, encryptedDek: string): string {
  const { iv, ciphertext, authTag } = JSON.parse(encryptedPayload);
  const dek = decryptDek(encryptedDek);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    dek,
    Buffer.from(iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

/** Generate a cryptographically secure random token */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/** Generate an OAuth state parameter (CSRF protection) */
export function generateOAuthState(): string {
  return randomBytes(24).toString("base64url");
}

/** Generate a PKCE code verifier */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}
