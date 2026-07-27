Project Structure
worship-scheduler/
├── src/
│   ├── app/                          # 19 routes
│   │   ├── (auth)/                   # Login, Register, Reset Password
│   │   ├── (dashboard)/              # 8 main pages
│   │   │   ├── page.tsx              # Dashboard
│   │   │   ├── schedule/             # Schedule management
│   │   │   ├── members/              # Member management
│   │   │   ├── availability/         # Availability tracking
│   │   │   ├── ministries/           # Ministry configuration
│   │   │   ├── analytics/            # Analytics dashboard
│   │   │   ├── exports/              # Export center
│   │   │   └── settings/             # Church settings
│   │   └── api/                      # 6 API routes
│   ├── components/                   # 14 components
│   │   ├── layout/                   # Sidebar, Header, DashboardLayout
│   │   ├── dashboard/                # StatsCards, UpcomingServices
│   │   ├── schedule/                 # ScheduleCard, ConflictList, ReplacementSuggestions
│   │   ├── members/                  # MemberCard, AvailabilityCalendar
│   │   ├── ministries/               # MinistryConfig
│   │   ├── analytics/                # WorkloadChart, FairnessScore, AvailabilityHeatmap
│   │   └── exports/                  # ExportOptions
│   └── lib/
│       ├── scheduling/               # Core engine
│       │   ├── engine.ts             # SchedulingEngine
│       │   ├── validator.ts          # ScheduleValidator
│       │   ├── replacement.ts        # ReplacementEngine
│       │   ├── fairness.ts           # FairnessCalculator
│       │   ├── devotion-rotation.ts  # DevotionRotation
│       │   └── rules/                # Rule executors
│       ├── types/                    # TypeScript interfaces
│       └── utils/                    # Date utilities
Core Features Implemented
Scheduling Engine — Generates schedules respecting:
- Availability checks
- Assignment limits
- Role validation
- Backup singer requirements
- Leader count
- Cooldown rules
- Fairness balancing
- Leader rotation
Validation Engine — Classifies issues as:
- Critical (blocks publication)
- Warning (advisory)
- Suggestion (optimization)
Replacement Engine — Suggests alternatives based on:
- Availability
- Skill level
- Assignment count
- Cooldown history
- Confidence scoring
Fairness Calculator — Tracks:
- Per-member utilization
- Overall fairness score
- Workload distribution
Devotion Rotation — Sequential assignment respecting:
- Rotation history
- Member availability
- No immediate repetition
Build Output
- 20 routes generated
- 6 API endpoints functional
- TypeScript validated
- Static + Dynamic rendering




This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.


