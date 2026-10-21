/**
 * Password hashing, in one place.
 *
 * Better Auth verifies passwords with Argon2id, so anything that writes a
 * password has to hash it the same way. Sharing the function stops the two
 * from drifting apart, which would silently lock people out.
 *
 * `Bun.password.hash` is asynchronous, so this is too.
 */
export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 65_536, timeCost: 3 });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}
