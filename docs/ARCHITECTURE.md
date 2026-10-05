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

Pages: `/login /register /invite/[token] /dashboard /tasks /tasks/new /tasks/[id] /tasks/[id]/edit /team /campaigns`.

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
- `src/lib/storage.ts` is a small driver interface (`put/get/size/remove`); the local-disk driver (`STORAGE_DIR`, default `./uploads`) is the only one implemented. An S3-compatible driver is a drop-in replacement and is **not built yet**.
- Blobs are stored under random keys (`org/task/uuid.ext`); `TaskAttachment.fileUrl` holds that key, never a public URL. Every download goes through `GET /api/files/:id`, which re-checks task visibility, so files cannot be reached by guessing paths or from another organization.
- Uploads accept PDF/JPG/PNG/MP4/MOV/DOCX/XLSX only; extension **and** magic bytes must agree and the client MIME type is ignored. Names are sanitised (Arabic kept). Limit `MAX_UPLOAD_MB` (default 100). Responses send `nosniff`; only PDF/image/video render inline, Office files always download; inline images/video are served with a sandbox CSP. Single-range requests are supported so video can seek.
- Same name + kind on a task = next version (V1, V2…), race-safe via a unique index and retry. Deleting is soft: the row and blob stay so history and handover snapshots remain valid.
- Upload/delete: current owner, task creator, or `task:edit:any`; read: anyone who can see the task. Cross-site POST/DELETE are rejected (Origin check on top of SameSite=Lax).
- Upload bodies are buffered by the runtime before streaming to disk; run behind a proxy that enforces the same size limit.

### Comments & approvals (Phase 5)
- **Approval = moving forward out of a review/approval stage.** The handover that does it also writes a `TaskApproval` (who, which stage, when, comment) and a `task.approved` activity, and notifies whoever submitted the work (and the task creator after final approval). **Request changes** writes a `TaskApproval(CHANGES_REQUESTED)` plus the `TaskRevision`; the revision is marked resolved when the worker next hands over new work. Nothing is overwritten, so "who approved it and when" is always answerable.
- Reviewers see a review card with the latest deliverable (RAW for production review, FINAL after editing); at social approval it also shows thumbnail, caption, hashtags, platform and publish time. Button reads "Approve & hand over" / "Approve & Schedule".
- Comments: plain text, `@Full Name` mentions (picked from a menu or typed), avatars (initials), timestamps, file attachments bound to the comment, soft delete (author or Admin). Only people who can see the task can be mentioned, so a mention never leaks a task. Mentions notify (`MENTION`); other comments notify the owner and creator (`COMMENT`); nobody is notified twice or about their own comment. Comment attachments never count toward a handover's RAW/FINAL requirement.
- `/approvals` lists tasks waiting for you and (for roles that see all tasks) tasks waiting on others.

### Calendar (Phase 6)
- **Events are derived, never hand-entered.** `eventsForTask()` (pure, `src/lib/calendar.ts`) turns task state into events: shooting/photo shoot (`shootingAt`, 2h block, owned by the production assignee), publishing (`publishAt`), and one "Due" event for the current stage's deadline typed by stage (production → Shooting/Photography, editing → Editing or Design, review/approval → Review). Scheduled/published/completed tasks keep only their publishing event.
- `syncTaskCalendar()` deletes and rebuilds a task's events inside the same transaction as every change (create, edit, assign, handover, request changes, confirm assignment); deleting a task clears them. Because it is a rebuild, events cannot drift or duplicate (tested). Consequence: once a stage is finished its due-event disappears — the calendar shows what is current; history lives in the activity log. Run `npm run db:backfill-calendar` once to build events for tasks created before Phase 6.
- Visibility: roles with `calendar:view:all` see every event of tasks they can see (with a "mine only" toggle); everyone else sees only events assigned to them. Always organization-scoped.
- Views are server-rendered (`/calendar?view=month|week|day&date=YYYY-MM-DD&types=…&mine=1`) with custom components instead of FullCalendar: no client bundle, no hydration, fully linkable, and day arithmetic is done in the org timezone (`WEEK_START` sets the first weekday, default Sunday). Trade-off: no drag-and-drop rescheduling; dates are edited on the task.
- Every chip links to its task. The dashboard shows "Today" for the signed-in user.

### Production Brief PDF (Phase 7)
- `GET /api/tasks/:id/brief` (`?download=1` to force download) renders the **current** task with `@react-pdf/renderer` (no headless browser needed on the server). Sections follow the PRD: header, task/brand/campaign/type/platform/priority, dates, objective, audience, brief, insight, key message, CTA, caption, hashtags, **script split into scenes**, models, location, props, product, references, notes, assigned team (creator, current owner, everyone who held it), page footer with task code and page numbers. Empty optional sections are omitted. Visibility rules are the same as the task page.
- Scenes are parsed from `SCENE 01 – …`, `Scene 2:`, `Shot 3` or `مشهد ٣` headings (Arabic-Indic digits understood); text without headings becomes one SCRIPT block.
- **Arabic**: a bundled IBM Plex Sans Arabic (OFL, `assets/fonts/`, covers Latin and Arabic) is embedded; each line gets its own base direction from its first letter, so Arabic lines are shaped and right-aligned while English lines stay left-to-right. Emoji are removed from the PDF because the font has no emoji glyphs. Verified visually on rendered pages.
- **Share PDF** = signed, expiring (1–30 days), revocable link `/share/brief/<token>` that works without login: `HMAC-SHA256(payload{task, version, expiry})`, key derived from `SESSION_SECRET`. "Revoke all links" bumps `Task.briefShareVersion`, instantly invalidating every outstanding link; deleting the task also kills them. Only the creator or a manager can create/revoke; both are logged in the activity log. The public route is rate-limited, `noindex`, `no-store`, `no-referrer`, and always renders the *current* task (so it is not a frozen copy). Anyone holding a valid link can read the brief — the UI says so before copying.

### Notifications (Phase 8)
- **Inbox**: bell in the top bar (unread badge, latest 8, mark read / mark all read, click-through to the task) and a full `/notifications` page (unread filter, pagination, email opt-out). A person only ever reads their own rows; notifications of deleted tasks are hidden. "Realtime" is polling every 30 s while the tab is visible plus a refresh on tab focus — simple, proxy-friendly, no sockets to operate. SSE/WebSocket can replace the poll without touching the API shape.
- **Event notifications** are written in the same transaction as the change that causes them: new assignment, handover, revision requested, approved, mention, comment.
- **Time-based reminders** (`src/lib/reminders.ts`): deadline approaching (default 24 h, `DEADLINE_REMINDER_HOURS`), overdue (to owner and creator), scheduled content due (default 2 h before, plus a second "publish now" once the time has passed; `PUBLISH_REMINDER_HOURS`). Unassigned tasks notify their creator. Closed (published/completed), scheduled-for-deadline and deleted tasks are skipped, and deadlines that lapsed more than 30 days ago are ignored so a first run cannot flood people. Each notification carries a `dedupeKey` with a unique index per user, so the job is **idempotent** (run it as often as you like) and changing a deadline/publish date earns a fresh reminder.
- **Running the job**: `POST /api/cron/reminders` with `Authorization: Bearer $CRON_SECRET` (any scheduler, ~every 5 min), or `npm run reminders` from system cron. The endpoint is disabled (503) unless `CRON_SECRET` (16+ chars) is set; comparison is constant-time.
- **Email** is an optional digest sent by the same job: one email per person with their new, still-unread notifications from the last 24 h, only when `SMTP_URL` is set and the user has not opted out. Failures leave `emailedAt` empty and are retried on the next run. Latency therefore equals the cron interval.
- `TASK_REJECTED` exists in the enum but is not emitted: "request changes" is modelled as `REVISION_REQUESTED`.

### Templates & campaigns (Phase 9)
- **Built-in templates** (`src/lib/templates.ts`, pure data): Instagram Reel, Product Photography, Static Post, Carousel, Story, TikTok, UGC, Campaign Video, Product Shoot — one per content type. Each defines which of the 18 base fields the form shows, which are **required**, **extra fields** specific to that type (e.g. Photography: Background, Lighting, Angles, Shot list; Carousel: slide count + slide-by-slide copy; Reel: duration, music), the default platform, and starting text (Reel/TikTok/Campaign Video start with a `SCENE 01 – / 02 – / 03 –` script skeleton).
- **Flow**: `/tasks/new` shows a picker (built-ins, your custom templates, or Blank) → the form is generated from the template. The server re-resolves the template and **enforces** it, so a hand-crafted request cannot bypass it: the content type is locked to the template's, required fields (including extras) are checked with readable messages, extras are sanitised (only defined keys, trimmed, 5 000 chars). The template reference and extras are stored on the task (`templateRef`, `extra` JSON) and shown on the task page and in the PDF brief. Editing re-applies the same rules, merges extras without wiping untouched values, and never hides a field that already holds data.
- **Custom templates** (`ContentTemplate`, tenant-scoped, `template:manage` = Admin / Marketing Manager / Social Media Manager) extend a built-in with the organization's own starting text (e.g. house hashtags, CTA, props). Defaults for fields the base does not show are dropped. Deleting a custom template never touches existing tasks — they fall back to the free-form editor.
- **Hierarchy**: Brand → Campaign → content. Each **task is one piece of content** (Reel 01, Post 01…), so "content" and "task" are the same record; this keeps one owner, one workflow and one calendar entry per piece.
- **Campaign pages** (`/campaigns`, `/campaigns/[id]`): progress bar split into Planning / Production / Editing / Review & approval / Scheduled / Published, % published, overdue count, content grouped by type, "+ Add content" (opens the template picker with the campaign preselected), edit (name, description, dates; unique per brand), archive (blocked while anything is still in progress; brands only when they have no campaigns). **Visibility**: managers see every campaign; everyone else sees only campaigns containing tasks they may see, and the counts/progress they get are computed from *their* visible tasks only.

## 6. Component structure
- `app/(auth)` — login, register, invite acceptance.
- `app/(app)` — authenticated shell (sidebar with role-filtered nav) + pages.
- `components/`: `ProgressBar`, `TaskForm` (template-driven), `NotificationBell`, `BriefPanel`, `CommentBox`, `CommentThread`, `ReviewCard`, `MediaView`, `FilesPanel` (client: upload, versions, preview), `HandoverPanel`, `ActionForm` (client; `useActionState` → inline errors), `Field/Input`, `Badges`, `TaskForm` (create/edit), `AssignForm`.
- Planned: `WorkflowTimeline`, `HandoverModal`, `FileList`, `CommentThread`, `ReviewPanel`, `CalendarView` (FullCalendar), `NotificationBell`.

## 7. Folder structure
```
prisma/            schema.prisma, migrations/, seed.ts
docs/              ARCHITECTURE.md
src/
  app/
    (auth)/        login, register, invite/[token]
    (app)/         dashboard, tasks, tasks/new, tasks/[id](/edit), team, campaigns
    actions/       auth.ts team.ts tasks.ts campaigns.ts   ("use server")
  components/
  lib/             db env session rbac workflow tasks task-schema datetime mailer activity rate-limit tokens
  middleware.ts    cookie gate + security headers
```

## Phase status
| Phase | Scope | Status |
|---|---|---|
| 1 | Auth, organization, invitations, RBAC | done |
| 2 | Tasks (create/edit/assign/list/filter/detail/activity/soft-delete); minimal brands & campaigns | done |
| 3 | Workflow engine + handovers (confirm, forward handover, revision loop) | done |
| 4 | Files: upload, preview, download, versions, handover file gates | done |
| 5 | Comments (@mentions, attachments), approval records, review card, Approvals page | done |
| 6 | Calendar (month/week/day), automatic events, dashboard "Today" | done |
| 7 | Production Brief PDF (Arabic + English), download/preview, expiring share links | done |
| 8 | Notification bell + inbox, deadline/overdue/publishing reminders, email digest | done |
| 9 | Templates (built-in + custom, template-specific fields), campaign pages with progress | done |
| 10 | Analytics | planned |

Known limits (later phases): rate limiter is in-memory per instance; one org-wide `APP_TIMEZONE`; notifications are stored but have no UI yet (Phase 8); no password reset yet; open sign-up creates a new organization (disable with `ALLOW_SIGNUP=false`).
