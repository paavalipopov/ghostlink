# Ghostlink security review and 0.8.1 handoff

Reviewed on November 11, 2026.

Reviewed release is Windows 0.8.0 at commit `6651101e01d2986104e3d3e987248a64d5a9f4b1`. The installed networking dependency is Trystero / `@trystero-p2p/core` 0.26.0.

The security fixes and version bump to 0.8.1 are pending. This document records the investigation and proposed implementation for later work.

## Findings

### High severity — authentication bypass through reused connections

An attacker who previously established a connection to the victim can enter another room in the same running app without knowing its new secret, under the responder handshake role.

Trystero advertises active room tokens over existing physical connections. Its password handshake verifies password knowledge in one direction. A malicious client can choose a peer ID that makes the victim take the responder role, send a challenge, and claim handshake readiness without proving knowledge of the new room password.

Leaving a room retains the underlying physical connection for approximately 123 seconds. Changing the secret within the running app can therefore leave a previously authorized malicious peer able to follow into the new room. Concurrent rooms in the same JavaScript context, including the panel's private test connection, also use this connection-sharing mechanism. The trackpad's movement preview itself uses local Tauri commands.

An isolated reproduction used the unmodified installed connection-sharing, room, and handshake code with an in-memory transport. After leaving an old room, the attacker learned the advertised new room token, passed admission, and delivered a movement message without using the new secret. A control test with the opposite handshake role rejected the attack.

Relevant locations are:

- `src/renderer/src/link.ts:116` configures the shared room password.
- `node_modules/@trystero-p2p/core/dist/handshake.mjs:5` implements the password handshake.
- `node_modules/@trystero-p2p/core/dist/handshake.mjs:112` selects the handshake role using peer IDs.
- `node_modules/@trystero-p2p/core/dist/shared-peer.mjs:84` advertises room presence.
- `node_modules/@trystero-p2p/core/dist/shared-peer.mjs:448` processes presence and attaches rooms.
- `node_modules/@trystero-p2p/core/dist/strategy.mjs:17` sets the physical connection retention period.

Until fixed, fully exit and reopen Ghostlink before generating a new secret to revoke a participant. Share the replacement secret only with the intended peers.

### High severity — insufficient connection and message budgets

The eight-pointer limit applies to displayed state. It does not limit WebRTC negotiations or established network peers.

Ghostlink leaves Trystero's receive budget at its 256 MiB default and has no application receive-rate limits. Large messages can consume memory and decoding work before Ghostlink validates their fields. Frequent small messages can repeatedly trigger React updates and native overlay IPC.

Unauthenticated signaling announcements can also trigger offer creation when an attacker can observe the victim's signaling topic. The encrypted password check occurs later. Many distinct advertised peer IDs can bypass per-peer deduplication and create additional pending state.

Bounded local tests confirmed:

- Twenty unauthenticated announcements caused twenty offer-allocation requests and twenty peer-state entries. RTC allocation was stubbed.
- The default receiver admitted a 64 MiB movement transfer. It was canceled before buffer allocation.
- Five hundred small movement messages reached the handler without a receive-rate cap.

Relevant locations are:

- `src/renderer/src/link.ts:129` registers movement and click actions without receive admission limits.
- `src/renderer/src/link.ts:149` limits displayed ghosts.
- `node_modules/@trystero-p2p/core/dist/action-wire.mjs:17` sets the default receive budget.
- `node_modules/@trystero-p2p/core/dist/action-receiver.mjs:341` allocates the incoming transfer buffer.
- `node_modules/@trystero-p2p/core/dist/signal-handler.mjs` creates offers from announcements before password proof.

### Medium severity — short secrets permit offline guessing

Custom secrets need only six non-space, non-hyphen characters. A secret deterministically selects the public signaling topic through fast hashes. An observer can test guesses against that topic offline, without a server-side attempt limit.

The local test recovered an example weak secret from a small candidate list. The dice-generated secret contains approximately 100 bits of randomness and offers substantially stronger protection against guessing. Secret strength does not fix the connection-reuse bypass.

See `src/shared/protocol.ts:109`, `:122`, and `:139`, plus Trystero's `strategy.mjs:39` and `crypto.mjs`.

## What peers and infrastructure can observe

- Room participants receive chosen usernames, normalized cursor positions, click timing, and connection metadata.
- Direct WebRTC connections expose public IP addresses to peers. Local address exposure depends on the browser and network configuration.
- Usernames are self-declared and provide no verified identity.
- The app's messages contain no screenshots, keyboard input, window contents, or absolute desktop coordinates.
- Public Nostr relays observe connection IPs, timing, signaling topics, and encrypted signaling. They can interfere with discovery.
- Default STUN servers include Google and Cloudflare.

Peer data uses WebRTC DTLS encryption. Signaling descriptions and candidates use password-derived AES-GCM over secure WebSockets. Tests rejected a wrong decryption password and tampered ciphertext. The authentication finding concerns admitting an unauthorized endpoint despite this encryption.

The reviewed message handlers validate coordinates and render names as React text. No direct application-level path from received pointer messages to program execution, file access, or real mouse injection was found. Browser-engine vulnerabilities remain outside the coverage of this review.

## Proposed 0.8.1 work

1. Require both parties to prove knowledge of the room secret on every room attachment, including reused connections. Bind authentication to the room, peer identities, fresh cryptographic nonces, and protocol roles. Treat room tokens and peer IDs as untrusted routing data.
2. Ensure revoking a room or changing its secret cannot leave an old peer authorized through a retained physical connection.
3. Enforce budgets for pending negotiations and established peers, accounting for the regular session and private test connection. Authenticate or limit signaling work before allocating expensive resources.
4. Add small movement and click payload limits before decoding, plus bounded incoming rates and bursts. Coalesce movement to the rendering cadence. Keep separate, sufficient bounds for legitimate internal authentication and WebRTC signaling.
5. Decide the custom-secret policy explicitly. The current six-character minimum is a product choice from earlier work. Generated secrets should remain the preferred option for security-sensitive use.
6. Update the Tauri version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock` to 0.8.1, then prepare security release notes.

Use a maintained dependency fix, a managed patch, or application-level integration rather than relying on manual edits inside `node_modules`.

## Verification for the fix

- Previously connected malicious peers cannot follow into a new room after a secret change.
- Both handshake roles reject peers that lack the new secret.
- Concurrent public and private test rooms remain isolated.
- Wrong passwords, modified proofs, replayed proofs, and cross-room proofs are rejected.
- Connection and signaling floods remain within the configured budgets.
- Oversized messages are rejected before large allocation or JSON decoding.
- Incoming message floods do not produce unbounded React updates or overlay IPC.
- Normal pointer sharing at 30 FPS, click blinks, reconnects, room changes, and the private trackpad still work.
- Check compatibility with older clients explicitly if the authentication protocol changes.
- Build and test the Windows installer and signed updater artifacts. Mixed-scale desktop testing was explicitly skipped by the user.

## Existing local investigation files

These files are under ignored `dist/` in the local migration worktree at `C:\Users\paava\.codex\worktrees\b4c0\ghostlink`. They are not tracked by Git and are not included by saving this report on `main`. A fresh checkout therefore does not contain these reproductions:

- `security-reused-room-check.mjs`
- `security-network-checks.mjs`
- `security-audit-osv.mjs`
- `security-npm-audit.json`
- `security-rust-advisories.json`

Run the bounded reproductions from that local worktree root:

```powershell
node dist/security-reused-room-check.mjs
node dist/security-reused-room-check.mjs control
node dist/security-network-checks.mjs
```

The first command currently confirms the bypass. After remediation, adapt it into a regression test that expects rejection.

The investigation sent no attack traffic to public relays or other computers. The authentication reproduction used an in-memory transport, and the large transfer was canceled before allocation. A real two-computer adversarial reproduction and full WebRTC fuzzing have not been performed.

## Dependency advisory checks

The npm audit reported one minimatch denial-of-service advisory propagating through thirteen development-tool packages. The Rust lockfile query covered 457 registry packages and reported the GLib `VariantStrIter` advisory plus an unmaintained `proc-macro-error` notice. Neither Rust package appears in the Windows target's dependency tree. These are additional maintenance items, separate from the reproduced networking flaws.

No production source changes or security fixes were made during this investigation. No upstream disclosure or public security issue was submitted.
