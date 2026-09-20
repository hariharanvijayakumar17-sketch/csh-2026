import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  opts: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, opts, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/**
 * Password hashing: node:crypto scrypt (DECISIONS D3 — zero native deps).
 * Format: scrypt$N=16384$r=8$p=1$<salt hex>$<hash hex>
 */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(
    password,
    salt,
    KEYLEN,
    SCRYPT_PARAMS
  )) as Buffer;
  return `scrypt$N=${SCRYPT_PARAMS.N}$r=${SCRYPT_PARAMS.r}$p=${SCRYPT_PARAMS.p}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split("$");
  // scrypt$N=..$r=..$p=..$salt$hash
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1].replace("N=", ""));
  const r = Number(parts[2].replace("r=", ""));
  const p = Number(parts[3].replace("p=", ""));
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");
  // Malformed/corrupt stored hash: reject (empty salt+hash would otherwise
  // make timingSafeEqual(empty, empty) === true).
  if (salt.length === 0 || expected.length === 0 || !Number.isInteger(N) || N <= 0)
    return false;
  const derived = (await scrypt(password, salt, expected.length, {
    N,
    r,
    p,
  })) as Buffer;
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * Used for unknown-email logins (brief S7): performs a real scrypt compare
 * against a fixed dummy hash so response timing does not reveal whether an
 * email exists. NEVER a real user's hash.
 */
const DUMMY_HASH =
  "scrypt$N=16384$r=8$p=1$00000000000000000000000000000000$000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

export async function dummyVerify(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH);
}

/** Password strength for bootstrap-admin (brief S6) and user changes. */
export function passwordStrengthIssues(pw: string): string[] {
  const issues: string[] = [];
  if (pw.length < 12) issues.push("at least 12 characters");
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw))
    issues.push("upper and lower case letters");
  if (!/\d/.test(pw)) issues.push("a digit");
  return issues;
}
