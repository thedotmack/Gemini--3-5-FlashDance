# Security Specification: Choreography Studio

This specification establishes the Data Invariants, the "Dirty Dozen" malicious payloads, and the validation tests for the Choreography Studio Firestore database.

---

## 1. Data Invariants

### User Collection (`/users/{userId}`)
- **Identity Integrity**: A user profile's document ID must match the creator's authenticated User ID (`request.auth.uid`). No spoofing of profiles.
- **Immortal Fields**: `createdAt` and `email` must be immutable after creation.
- **Pillars & Constraints**:
  - `displayName` must be a string up to 100 characters.
  - `email` must match a valid format and the authenticated user's email.
  - `createdAt` and `updatedAt` must be set via `request.time` (Server Timestamps).

### Sessions Collection (`/sessions/{sessionId}`)
- **Relational Integrity**: Every session document belongs to a specific user. The `userId` field inside the session MUST match the authenticated creator's UID (`request.auth.uid`).
- **Strict Keys**: No "Ghost Fields" (unauthorized parameters) allowed during creation or update.
- **Immortal Fields**: `userId`, `createdAt`, and `id` must be immutable.
- **Temporal Enforcement**: `createdAt` and `updatedAt` on writes must validate to the current transaction timestamp (`request.time`).
- **Valued Boundary Limits**:
  - Steps array must contain exactly 4 to 6 steps (`size() >= 4 && size() <= 6`).
  - Positional joints must stay within canvas limits (X: `5` to `95`, Y: `5` to `115`).
  - Strings cannot be empty or exceed safe lengths to prevent Denial of Wallet storage abuse.

---

## 2. The "Dirty Dozen" Rogue Payloads

These 12 payloads attempt to bypass authorization checkpoints:

1. **The Spoofing Creator**:
   - Write to `/sessions/malicious-session` as Alice, but setting `userId = "bob"`.
   - *Should Fail*: Denied by Identity Integrity Check.
2. **The Unauthorized Reader**:
   - Read `/sessions/alice-session` while not signed in or logged in as Bob.
   - *Should Fail*: Denied by Query Enforcer / Owner Read filter.
3. **The Rogue Administrator**:
   - Save profile with `"role" = "admin"` or `"isAdmin" = true` in user profile.
   - *Should Fail*: Forbid Self-Assigned Roles/elevated privileges on standard profiles.
4. **The Ghost Field Injection**:
   - Save session with normal fields plus `{ "ghostField": "maliciousValue" }` to bypass size/keys check.
   - *Should Fail*: Strict schema validation rejects undefined properties on document create/update.
5. **The Time Machine Attack**:
   - Set client-side `createdAt` or `updatedAt` to a historical or future date (e.g., `2099-01-01`).
   - *Should Fail*: Requires exact server timestamp equality via `request.time`.
6. **The Body Disassembly Attack**:
   - Create step with `leftShoulder` joint positions completely out of bounds or missing properties (e.g., negative coords `{ x: -50, y: -200 }`).
   - *Should Fail*: Boundary checks require X [5, 95] and Y [5, 115].
7. **The Terminal State Lock Bypass**:
   - Update an archived, locked session to modify choreography structure without administrative override.
   - *Should Fail*: Terminal status blocking halts modification.
8. **The Oversized Storage Flooding**:
   - Save songTitle containing 10MB of repeating characters.
   - *Should Fail*: String size constraints (e.g., `songTitle.size() <= 200`) prevent runaway charges.
9. **The Unbounded Array Explosion (Steps)**:
   - Create a routine containing 500 choreography steps to exceed canvas or performance logic.
   - *Should Fail*: Steps array size constraint strictly gated at maximum 6 indices.
10. **The Unverified Identity Write**:
    - Write to `/sessions/session-id` with `email_verified` as `false` or from unverified anonymous account.
    - *Should Fail*: Standard writes require verified auth email.
11. **The PII Blanket Harvest**:
    - Bob tries to fetch a range of customer details/emails via loose list collection queries.
    - *Should Fail*: Loose read queries without index filter matching the requester's UID are rejected.
12. **The Sibling Detach/Orphan Attack**:
    - Trying to write high index numbers or non-matching IDs as step sequences.
    - *Should Fail*: Validated sequence indexing and strict type keys check on the array map elements.

---

## 3. Test Runner: `firestore.rules.test.ts`

```typescript
import { assertFails, assertSucceeds, initializeTestApp, clearFirestoreData } from '@firebase/rules-unit-testing';
import * as fs from 'fs';

const PROJECT_ID = 'gen-lang-client-0082238759';

describe('Firestore Security Rules', () => {
  beforeAll(async () => {
    // Load security rules
  });

  afterEach(async () => {
    await clearFirestoreData({ projectId: PROJECT_ID });
  });

  it('blocks Alice from writing a session with Bob as userId (The Spoofing Creator)', async () => {
    const db = initializeTestApp({ projectId: PROJECT_ID, auth: { uid: 'alice', email_verified: true } }).firestore();
    const docRef = db.collection('sessions').doc('sess-001');
    await assertFails(docRef.set({
      id: 'sess-001',
      userId: 'bob', // Bad! Spoofing Bob
      userId_verified: true,
      routine: {
        songTitle: 'Test Song',
        artist: 'Test Artist',
        styleDescription: 'Hip hop style',
        difficulty: 'Beginner',
        steps: []
      },
      createdAt: db.FieldValue.serverTimestamp(),
      updatedAt: db.FieldValue.serverTimestamp()
    }));
  });

  it('prevents standard users from nominating themselves as Admin (The Rogue Administrator)', async () => {
    const db = initializeTestApp({ projectId: PROJECT_ID, auth: { uid: 'user1', email_verified: true } }).firestore();
    const docRef = db.collection('users').doc('user1');
    await assertFails(docRef.set({
      userId: 'user1',
      isAdmin: true, // Bad! Self-elevating privileges
      email: 'user1@example.com',
      createdAt: db.FieldValue.serverTimestamp(),
      updatedAt: db.FieldValue.serverTimestamp()
    }));
  });

  it('rejects custom fields outside schema (The Ghost Field Injection)', async () => {
    const db = initializeTestApp({ projectId: PROJECT_ID, auth: { uid: 'alice', email_verified: true } }).firestore();
    const docRef = db.collection('sessions').doc('sess-002');
    await assertFails(docRef.set({
      id: 'sess-002',
      userId: 'alice',
      routine: {
        songTitle: 'Valid Song',
        artist: 'Author',
        styleDescription: 'Vibe list',
        difficulty: 'Intermediate',
        steps: []
      },
      ghostField: 'malicious-injected', // Bad! External field
      createdAt: db.FieldValue.serverTimestamp()
    }));
  });
});
```
