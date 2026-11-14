# Firestore Security Specification (Phase 0)

## Data Invariants
1. A `/users/{userId}` document may only be read, created, updated, or deleted by the authenticated, email-verified user whose `request.auth.uid == userId` and `userId` matches `^[a-zA-Z0-9_\-]+$` (`<= 128` chars).
2. `list` queries on `/users` are strictly forbidden (`allow list: if false;`) to prevent any cross-user enumeration.
3. No PII (`email`, `phone`, `address`) is stored in `/users/{userId}`; unexpected "shadow" keys are rejected via `.keys().hasOnly(...)` on create and `affectedKeys().hasOnly(...)` on update.
4. `ownerId` must always match `request.auth.uid` on creation and cannot be modified on update.
5. `createdAt` must equal `request.time` on creation and is immutable on update; `updatedAt` must always equal `request.time`.
6. Nested objects (`profile`, `progress`, `docs`, `dates`) are strictly bounded in key count and string/array lengths to prevent resource-poisoning writes.

## Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated read/write**: Read or write `/users/uid123` with `request.auth == null`.
2. **Unverified email**: Write `/users/uid123` with `request.auth.token.email_verified == false`.
3. **Cross-user read (`get`)**: User `uidA` attempts `get(/users/uidB)`.
4. **Collection scraping (`list`)**: Authenticated user attempts `list(/users)`.
5. **Identity spoofing on create**: User `uidA` creates `/users/uidA` with `ownerId: "uidB"`.
6. **Shadow / ghost field injection**: User `uidA` writes `/users/uidA` including an extra key `isAdmin: true`.
7. **Oversized document ID poisoning**: Write to `/users/<1500-char-string>`.
8. **Invalid language enum**: Write `/users/uidA` with `language: "de"`.
9. **Client-forged `createdAt` timestamp**: Create `/users/uidA` with `createdAt` in the past instead of `request.time`.
10. **Mutating immutable `createdAt` / `ownerId` on update**: Update `/users/uidA` altering `createdAt` or `ownerId`.
11. **Oversized string / list DoS**: Write `/users/uidA` with `dates.arrival` > 20 chars or `profile.completed` array > 10 items.
12. **Client-forged `updatedAt`**: Update `/users/uidA` without `updatedAt == request.time`.
