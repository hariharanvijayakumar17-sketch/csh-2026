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
 *
 * P3 addendum 3 (documented costs):
 *   N=16384 (2^14), r=8, p=1, keylen 64
 *   memory per hash = 128 * N * r = 16 MiB (bounded by UV_THREADPOOL_SIZE,
 *   default 4 threads → ≤ ~64 MiB concurrent worst case — see
 *   docs/evidence/p3-addendum-checks.txt for the limit discussion)
 */
export const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keyLen: 64 } as const;
const KEYLEN = SCRYPT_PARAMS.keyLen;

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
export const DUMMY_HASH =
  "scrypt$N=16384$r=8$p=1$00000000000000000000000000000000$70f6a44f7010cabb863ef5cc633fb220e9aa1cd447f3951e9f360c4b91b9d6c5d0fec314b16b9bf578c2c428069a1a8553913986e84789279b86df1b815dc97f";

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
