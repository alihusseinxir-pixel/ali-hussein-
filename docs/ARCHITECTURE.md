# BASMA MARKETING — Architecture

Marketing Workflow & Content Management System. This is the design baseline (the "before coding" deliverables).
Phases 1–2 are implemented; the rest is designed here and built in order.

## 1. System architecture

```
Browser ── Next.js 15 (App Router, React 19, Tailwind)
              │  Server Components read via src/lib/*  (always tenant-scoped)
              │  Server Actions mutate (src/app/actions/*): zod validation → RBAC → service
              ▼
        src/lib services ── Prisma ── PostgreSQL
              ├─ session.ts   signed (HS256) httpOnly cookie; user re-read from DB on every request
              ├─ rbac.ts      permission matrix (single source of truth for UI + server)
              ├─ workflow.ts  pure state machine (no I/O)
              ├─ tasks.ts     task commands/queries, ALL through visibleTasksWhere(actor)
              └─ mailer.ts    SMTP via nodemailer; console fallback in dev
   Later: S3-compatible storage (files), Puppeteer/React-PDF (brief PDF), SSE/WebSocket (realtime), cron (deadline notifications)
```

Principles
- **Tenancy first**: every query includes `organizationId`; foreign ids (brand, campaign, assignee) are verified to belong to the actor's org before use.
- **Authorization in the service layer**, not only the UI. Pages hide buttons; services enforce.
- **History is append-only**: assignments, handoffs, approvals, revisions, activity logs are never overwritten. Tasks/users/brands soft-delete (`deletedAt`).
- **No arbitrary stage changes**: stage only changes through the workflow engine (Phase 3), never via the edit form.

Deliberate deviations from the suggested stack
- Auth is in-house (bcrypt + signed JWT cookie via `jose`) instead of Auth.js v5 (still beta): smaller surface, easy to swap later.
- Roles are a Postgres enum + code-defined permission matrix instead of `roles`/`permissions` tables: roles are fixed by the PRD, and a typed matrix is testable. Tables can be added if per-org custom roles are ever needed.
- UI uses Tailwind with a few hand-written components; shadcn/ui can be layered in without changing data flow.

## 2. Database schema
See `prisma/schema.prisma` (complete for all phases, migrated). Entities:
`Organization, User, Invitation, Team, Brand, Campaign, ContentTemplate, TaskCounter, Task, TaskAssignment, TaskHandoff, TaskComment, TaskAttachment, TaskRevision, TaskApproval, CalendarEvent, Notification, ActivityLog`.

- `Task.taskCode` = `BASMA-<year>-<5 digits>`, unique per org, from `TaskCounter` via an atomic `upsert … increment` inside the create transaction (concurrency-tested).
- The "who" questions are answered from data: `createdById`, `currentAssigneeId`, `TaskAssignment` (previous owners, `assignedAt/releasedAt`), `TaskHandoff` (from/to/why/when/what), `TaskApproval` (who/when), `TaskRevision` (requested changes).
- `Invitation.tokenHash` stores a SHA-256 of the emailed token, so a DB leak cannot be used to join an org.
- Indexes on `(organizationId, stage)`, `(organizationId, currentAssigneeId)`, `(organizationId, deadline)`.

## 3. API structure
Server Actions (typed, CSRF-protected by Next) rather than a public REST API; a JSON layer can be added for integrations.

| Area | Action / route | Permission |
|---|---|---|
| Auth | `loginAction`, `registerAction` (new org + Admin), `logoutAction`, `acceptInviteAction` | public / session |
| Team | `inviteMemberAction`, `revokeInvitationAction`, `updateMemberAction` (role/status; last-admin guard) | `user:manage` |
| Brands/Campaigns | `createBrandAction`, `createCampaignAction` | `campaign:manage` |
| Tasks (P2) | `createTaskAction`, `updateTaskAction`, `assignTaskAction`, `deleteTaskAction` (soft) | `task:create`, `task:edit:any/own`, `task:assign`, `task:delete` |
| Workflow (P3) | `submitHandoverAction`, `acceptHandoverAction` | stage-owner roles |
| Files (P4) | `POST /api/tasks/:id/files` (multipart → S3), `GET /api/files/:id` (signed URL) | task visibility |
| Review (P5) | `approveAction`, `requestChangesAction` (note required) | `approval:internal` / `approval:final` |
| Calendar (P6) | `GET /api/calendar?from&to` | own, or `calendar:view:all` |
| PDF (P7) | `GET /api/tasks/:id/brief.pdf` | task visibility |
| Notifications (P8) | `markReadAction`, SSE `/api/notifications/stream` | own |

Pages: `/login /register /invite/[token] /dashboard /tasks /tasks/new /tasks/[id] /tasks/[id]/edit /campaigns /campaigns/[id] /calendar /approvals /files /templates /analytics /notifications /team`, plus `/share/brief/[token]` (public, signed).

## 4. Permission matrix (`src/lib/rbac.ts`)

| Permission | Admin | Mkt Mgr | Social Media | Videog. | Photog. | Editor | Designer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| user:manage, org:settings | ✔ | | | | | | |
| task:create | ✔ | ✔ | ✔ | | | | |
| task:view:all | ✔ | ✔ | ✔ | | | | |
| task:edit:any | ✔ | ✔ | | | | | |
| task:edit:own (creator) | | | ✔ | | | | |
| task:assign | ✔ | ✔ | ✔ | | | | |
| task:delete (soft) | ✔ | ✔ | | | | | |
| task:comment | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| campaign:manage | ✔ | ✔ | ✔ | | | | |
| template:manage | ✔ | ✔ | ✔ | | | | |
| approval:internal | ✔ | ✔ | ✔ | | | | |
| approval:final, publish:manage | ✔ | | ✔ | | | | |
| activity:view:all | ✔ | ✔ | | | | | |
| calendar:view:all | ✔ | ✔ | ✔ | | | | |
| analytics:view:all (others: own numbers only) | ✔ | ✔ | ✔ | | | | |

Visibility for roles without `task:view:all`: tasks they **created**, **currently own**, or **owned before** (read access is kept so history stays meaningful). Everything is additionally scoped to the organization.

## 5. Workflow state machine (`src/lib/workflow.ts`)

`IDEA → BRIEF → ASSIGNED → PRODUCTION → PRODUCTION_REVIEW → EDITING → EDITING_REVIEW → INTERNAL_APPROVAL → SOCIAL_APPROVAL → SCHEDULED → PUBLISHED → COMPLETED`

- The path depends on content type: video/photo content uses the full path; `STATIC_POST / CAROUSEL / STORY` skip PRODUCTION and PRODUCTION_REVIEW (`ASSIGNED → EDITING`).
- A transition is valid only if it is the **next stage on the path** or a **revision loop** (`PRODUCTION_REVIEW→PRODUCTION`; `EDITING_REVIEW | INTERNAL_APPROVAL | SOCIAL_APPROVAL → EDITING`). Nothing else.
- Tasks are created in `BRIEF`, or `ASSIGNED` when an eligible assignee is chosen. The first assignee's role is checked against the content type (Reel → Videographer, Product photography → Photographer, Static/Carousel/Story → Designer).
- **Phase 3 (implemented in `src/lib/handover.ts`)**. Every move writes a `TaskHandoff` plus a new `TaskAssignment` (the previous one is released, never edited) and an activity entry, atomically.
  - `ASSIGNED → next`: the assignee **confirms** the initial handover; that starts the work stage.
  - Forward handover guards: actor is the current owner (or Admin); actor holds the stage's exit permission (`exitPermission`: review → `approval:internal`, social approval → `approval:final`, scheduled/published → `publish:manage`); the receiver's role fits the next stage (`stageOwnerRoles`); instructions (unless handing to yourself); deliverables when leaving PRODUCTION/EDITING; a deadline for the next stage; `publishAt` before SCHEDULED; the actor has confirmed any handover they received.
  - Request changes (review stages only): note required; returns the task to whoever last did that work, writes a `TaskRevision`, notifies them.
  - Concurrency: the stage change is a compare-and-set on (stage, owner); of two simultaneous submissions exactly one wins (tested).
  - Each handover freezes a snapshot of brief/script/models/location/references (`payload.context`) alongside what was delivered.
  - Handing to yourself (e.g. Social Media scheduling their own content) is auto-confirmed.
  - Files gate (Phase 4): leaving PRODUCTION needs a `RAW` file, leaving EDITING a `FINAL` file, uploaded **since the previous handover** — so a revision needs a new version. The list of files delivered is frozen in the handover (`payload.files`).

### Files (Phase 4)
- `src/lib/storage.ts` is a small driver interface (`put/get/size/remove`, plus optional `direct` presigned-URL capabilities). `S3_BUCKET` (+ `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or an IAM role) selects S3 automatically; otherwise local disk (`STORAGE_DIR`). Any S3-compatible provider (Cloudflare R2, MinIO…) works by adding `S3_ENDPOINT` — no application code changes. **Direct flow on S3**: uploads are `init` (authorise + presigned PUT to a quarantined `pending/` key) → browser PUTs to the bucket → `complete` (re-authorise, verify exact size and real file type, move to the final key, record version); downloads are authorised on every request and answered with a 302 to a short-lived (`PRESIGN_TTL_SECONDS`, default 300 s) presigned GET whose type/disposition come from the app's whitelist. The bucket stays private. Full details, IAM policy, CORS, lifecycle and the verified/unverified list are in [STORAGE.md](STORAGE.md). `npm run storage:setup` applies Block Public Access, disables ACLs, CORS and lifecycle; `npm run storage:verify` live-tests the configuration; `npm run storage:migrate` copies existing local files to the bucket.
### Scripts (scene-by-scene)
- `ScriptScene` rows (ordered by `position`) hold each scene: duration, shot description (required), camera angle, visual action, dialogue/voice-over, on-screen text, audio, props, notes. `Task.hook` and `Task.contentPillar` were added to the content fields; the older free-text `Task.script` is kept and shown read-only when a task has no scenes yet.
- `Task.scriptStatus`: `DRAFT → IN_REVIEW → APPROVED → READY_FOR_PRODUCTION`, with `CHANGES_REQUESTED` (note required). Rules are pure in `src/lib/script-workflow.ts`; I/O in `src/lib/script.ts`. Editors (`task:edit:any`, or the creator with `task:edit:own`) submit and reopen; reviewers (`approval:internal`) approve or request changes. Approval is never implied: scenes are editable only in `DRAFT`/`CHANGES_REQUESTED`, so changing an approved script requires explicitly reopening it to draft.
- `ScriptRevision` is append-only: a full snapshot per save and per status change. Saves carry the version the client loaded and a stale version is rejected (optimistic concurrency); status changes are compare-and-set. Status changes are also written to `ActivityLog` (`script.status`), and requesting changes notifies the task creator.
- UI: `/tasks/[id]/script` (`src/components/ScriptEditor.tsx`).

### Shoot planning
- Tables: `ShootSession` (time range, call time, location, photographer / videographer / director, required items, shot list, prep notes, optional budget, status `PLANNED/COMPLETED/CANCELLED`), `ShootContent` (many content items per session), `ShootTalent` (models), `ShootChecklistItem` (phases `PRE_PRODUCTION`, `EQUIPMENT`, `SHOOT_DAY`, `HANDOVER`; seeded from `DEFAULT_CHECKLIST`, editable per session), plus reusable `Talent` and `Location` catalogs (archived, never hard-deleted). Equipment is a checklist phase rather than a catalog.
- Permission `shoot:manage` (Admin, Marketing Manager, Social Media Manager) creates/edits sessions, models, locations and checklist items. Crew (photographer, videographer, director on a session) see only their sessions and may tick its checklists; photographer/videographer slots only accept users with that role.
- Warnings are computed on read (`src/lib/shoot-checks.ts`, `findConflicts` in `src/lib/shoots.ts`), never block saving: missing location / crew / content / call time / shot list / items / models, and overlapping sessions that share a crew member, a model or the location (half-open intervals; cancelled sessions are ignored).
- UI: `/shoots` (weekly agenda), `/shoots/new`, `/shoots/[id]`, `/shoots/[id]/edit`, `/shoots/resources`. Calendar integration and shoot attachments are not part of this stage.
