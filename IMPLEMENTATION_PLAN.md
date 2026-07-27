Worship Team Scheduler SaaS — Phased Implementation Plan
Phase 1: Foundation (DONE)
- Next.js 16 project initialization
- Tailwind CSS v4 + shadcn/ui v4 (base-ui, NOT radix)
- 19 shadcn components installed
- Core layout (Sidebar, Header, DashboardLayout)
- Landing page, Login, Register, Reset Password
- Green palette (#2C5F2D primary, #97BC62 secondary, #D4A574 accent)
- Outfit/Inter/JetBrains Mono typography
Phase 2: TypeScript Types (DONE)
- src/lib/types/database.ts — All 15 entity interfaces (Church, Member, Service, etc.)
- src/lib/types/scheduling.ts — Scheduling engine types (ScheduleContext, ValidationResult, ReplacementSuggestion, FairnessReport, DevotionSlot, etc.)
Phase 3: Scheduling Engine Core (DONE)
- src/lib/scheduling/engine.ts — SchedulingEngine class (main orchestrator)
- src/lib/scheduling/validator.ts — ScheduleValidator (9 rule checks)
- src/lib/scheduling/replacement.ts — ReplacementEngine (confidence scoring)
- src/lib/scheduling/fairness.ts — FairnessCalculator
- src/lib/scheduling/devotion-rotation.ts — DevotionRotation (sequential, not random)
- src/lib/scheduling/rules/index.ts — 10 rule executors (availability, assignment limit, backup count, leader count, cooldown, fairness, leader rotation, devotion sequence, dual role, instrument constraint)
Phase 4: UI Components (DONE)
- components/layout/ — Sidebar, Header, DashboardLayout
- components/dashboard/ — StatsCards, UpcomingServices
- components/schedule/ — ScheduleCard, ConflictList, ReplacementSuggestions
- components/members/ — MemberCard, AvailabilityCalendar
- components/ministries/ — MinistryConfig
- components/analytics/ — WorkloadChart, FairnessScore, AvailabilityHeatmap
- components/exports/ — ExportOptions
Phase 5: Pages & Routing (DONE)
Route
/
/login
/register
/reset-password
/dashboard
/schedule
/members
/availability
/ministries
/analytics
/exports
/settings
Phase 6: API Routes (DONE)
Endpoint
POST /api/schedule
GET /api/schedule
GET /api/members
POST /api/validation
GET/POST /api/availability
GET/POST /api/devotion
POST /api/export
Phase 7: Supabase Migrations (DONE)
Migration
001_core_schema.sql
002_member_management.sql
003_scheduling.sql
004_availability.sql
005_devotion_rotation.sql
006_ministry_rules.sql
007_audit_notifications.sql
008_rls_policies.sql
009_functions_triggers.sql
010_seed_data.sql
Phase 8: Supabase Integration (TODO)
- Set up Supabase project and .env variables
- Run migrations against Supabase
- Replace mock data in API routes with real Supabase queries
- Set up @supabase/ssr client helpers for App Router
- Verify RLS policies work with auth.uid()
- Create Supabase client utility (src/lib/supabase/client.ts, server.ts)
Phase 9: Authentication Integration (TODO)
- Wire up Supabase Auth (email/password, magic link)
- Create auth middleware for protected routes
- Update login/register/reset-password to use real auth
- Add role-based access control (admin, coordinator, member)
- Protect API routes with auth checks
- Handle auth state in layout and sidebar
Phase 10: Scheduling Engine → Live Data (TODO)
- Wire SchedulingEngine to query real members, availability, services
- Implement POST /api/schedule with full generation flow
- Add real-time validation before publishing
- Wire replacement suggestions to real member data
- Wire fairness reports to real assignment history
- Wire devotion rotation to devotion_rotation table
- Add audit log writes on all mutations
Phase 11: Frontend Polish (TODO)
- Form validation with error messages
- Loading states and skeleton screens
- Toast notifications for success/error
- Responsive design verification (mobile sidebar, cards)
- Confirm dialogs for destructive actions
- Search/filter on members and schedule pages
- Pagination for large datasets
Phase 12: Testing (TODO)
- Unit tests for scheduling engine rules
- Unit tests for validator
- Unit tests for replacement engine
- Integration tests for API routes
- E2E tests for critical flows (generate schedule, publish, assign)
Phase 13: Deployment & Launch (TODO)
- Deploy to Vercel
- Set up Supabase production project
- Configure environment variables
- Custom domain setup
- SSL/HTTPS verification
- Performance audit (Lighthouse)
- User documentation / onboarding guide