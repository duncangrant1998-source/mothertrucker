# Mother Trucker — Project Progress Log

**Project**: Truck navigation app for oversize/overweight (OS/OW) vehicle drivers in North America
**Status**: Phase 1 — Foundation & Core Routing (In Progress)
**Last Updated**: June 24, 2026

---

## Overview

Mother Trucker is a web-first navigation application designed specifically for owner-operator truck drivers hauling oversize and overweight loads in Canada (Phase 1) and North America (future expansion). The app provides truck-safe routing that accounts for bridge clearances, weight restrictions, seasonal limits, and provincial permit requirements.

---

## Phase 1 Milestones

| Milestone | Status | Description |
|-----------|--------|-------------|
| 1. Foundation | ✅ Complete | Tech stack setup, user auth, vehicle profiles |
| 2. Core Routing | 🔄 In Progress | Truck-safe routing with vehicle specs |
| 3. Driver Tools | ⏳ Planned | Weigh stations, permit info, saved routes |
| 4. MVP Launch | ⏳ Planned | Beta testing, legal docs, soft launch |

**Timeline**: ~10 weeks total

---

## Session 1 Progress — June 24, 2026

### What We...

# Mother Trucker — Project Progress

**App**: Truck navigation for oversize/overweight drivers in Canada
**Status**: Phase 1 in progress
**Last Updated**: June 24...
# Mother Trucker — Project Progress Log

**App**: Truck navigation for oversize/overweight owner-operator drivers in Canada
**GitHub Repo**: mothertrucker
**Tech Stack**: React + Vite, HERE Maps API, Supabase, Ontario 511 API
**Last Updated**: July 4, 2026

---

## App Vision

Mother Trucker is a web-first navigation application designed specifically for
owner-operator truck drivers hauling oversize (OS) and overweight (OW) loads
in Canada (Phase 1), with planned expansion to the United States (Phase 2).

The app provides truck-safe routing that accounts for bridge clearances, weight
restrictions, height limits, seasonal road restrictions, and provincial permit
requirements — features that standard navigation apps like Google Maps and Waze
do not offer.

**Target User**: Owner-operators hauling oversize and overweight loads
**Primary Market**: Canada (Phase 1), North America (Phase 2)
**Platform**: Web-first (iOS and Android to follow in later phases)

---

## Phase 1 Milestones

| Milestone | Description | Status |
|-----------|-------------|--------|
| 1. Foundation | Tech stack, auth, vehicle profiles | ✅ Complete |
| 2. Core Routing | Truck-safe routing with vehicle specs | ✅ Complete |
| 3. Driver Tools | Weigh stations, route options, navigation | 🔄 ~80% Complete |
| 4. MVP Launch | Beta testing, legal docs, soft launch | ⏳ Planned |

**Est. completion**: 2-3 weeks remaining

---

## Chapter 1 — Planning & Research
### (Pre-build)

**Key Decisions Made**
- Web-first approach chosen to minimize investment risk
- Canada-only for Phase 1 to reduce scope
- Target user: owner-operators (not fleet dispatchers)
- Cover both oversize AND overweight loads from day one

**Competitive Gap Identified**
- CoPilot, Trucker Path, Hammer GPS exist but don't focus on oversize/OW permit loads
- Mother Trucker differentiator: MTO inspection stations, permit visualization, seasonal restrictions

**Tech Stack**
- Frontend: React + Vite
- Maps: HERE Maps API (truck routing included)
- Backend: Supabase (auth + database)
- Data: Ontario 511 API for inspection stations
- Hosting: Vercel (planned)

---

## Chapter 2 — Foundation Build (Milestone 1)
### June 24, 2026

**Completed**
- ✅ React + Vite project setup
- ✅ HERE Maps integration with CDN
- ✅ Supabase database and authentication
- ✅ Email/password login and signup
- ✅ Vehicle profile form (height, width, length, weight, axles, load type)
- ✅ Vehicle profiles saved to Supabase with RLS
- ✅ GitHub repo initialized and commits working

**Files Created**
- src/components/Map.jsx
- src/components/VehicleProfile.jsx
- src/lib/supabase.js
- src/Auth.jsx
- src/App.jsx

---

## Chapter 3 — Core Routing & Features (Milestones 2 & 3)
### June 26, 2026

### Truck-Safe Routing ✅
- HERE Maps Routing API v8 with vehicle dimensions
- Routes respect height, width, length, weight, axle count
- Orange polyline display with start/end markers
- Distance (km) and duration (h:m) shown after routing
- Proper unit conversions for HERE Maps (kg→grams, m→cm)

### Smart Address Search ✅
- Real-time autocomplete dropdown as driver types
- Supports both street addresses AND business names
- Example: "Canadian Tire Motorsport Park" resolves correctly
- Search limited to Canada
- Fixed focus/blur race condition for reliable UX

### Multiple Route Options ✅
- 3 route alternatives calculated simultaneously:
  - **Fastest** route (may include tolls)
  - **No Tolls** route (toll avoidance)
  - **Shortest** route (minimize distance)
- Each option shows distance, time, toll indicator
- Cards selectable — click to draw that route
- Grey polylines show all options at once
- First (Fastest) selected by default

### Ontario MTO Inspection Stations ✅
- Integrated with live Ontario 511 API
- **32 MTO inspection stations** fetched and saved to Supabase
- Stations display only on the calculated route (bounding box query)
- Click markers to see: name, highway, direction, region, phone
- Distinct blue markers vs HERE weigh stations
- Proximity alerts when within 5km of a station
- Warning banner shows count of stations on route

**Database Tables**
- `vehicle_profiles` — user truck specs (RLS enabled)
- `inspection_stations` — 32 Ontario MTO stations with lat/lng

**API Integrations**
- HERE Maps Routing API v8
- HERE Maps Geocoding API
- HERE Maps Autosuggest API
- Ontario 511 Inspection Stations API (via Supabase Edge Function)

### Turn-by-Turn GPS Navigation 🔄 (In Progress)
- Geolocation API integration for live position tracking
- Map follows driver with zoomed-in view (level 16)
- Driver marker with direction rotation
- Turn-by-turn instruction panel (next maneuver + distance)
- Progress tracking through route segments
- MTO station proximity alerts (5km warning)
- Start/Stop Navigation buttons
- Off-route detection (100m tolerance) with recalculation
- Desktop testing ready (will fully test on mobile)

---

## Session Summary — July 4, 2026

**What We Built Today**
1. ✅ Scraped Ontario MTO inspection station data from 511 API
2. ✅ Created Supabase `inspection_stations` table with RLS
3. ✅ Built Edge Function to fetch/sync stations automatically
4. ✅ Integrated stations into Map.jsx with blue markers
5. ✅ Added proximity alerts (5km warning before station)
6. ✅ Implemented 3 route options (Fastest/No Tolls/Shortest)
7. ✅ Built turn-by-turn GPS navigation mode
8. ✅ Added live position tracking with map following driver

**Technical Highlights**
- Solved CORS issue by moving API fetch to Supabase Edge Function
- Implemented Haversine distance calculation for proximity alerts
- Used HERE Maps maneuver data for turn-by-turn instructions
- Built route option selection with polyline swapping

**Still To Do (Milestone 3)**
- [ ] Automatic station sync (remove manual button, auto-sync on profile save)
- [ ] Permit info cards (provincial requirements by route)
- [ ] Save route functionality (save routes for later)
- [ ] Truck stop/fuel POIs along route
- [ ] Mobile testing of turn-by-turn GPS
- [ ] Clean up UI — remove admin buttons, finalize styling

---

## Current Feature Set

| Feature | Status | Notes |
|---------|--------|-------|
| User auth | ✅ Complete | Email/password login |
| Vehicle profiles | ✅ Complete | Saved to Supabase |
| Truck routing | ✅ Complete | Respects all vehicle dimensions |
| Route options | ✅ Complete | Fastest/No Tolls/Shortest |
| MTO stations | ✅ Complete | 32 Ontario stations, live 511 API |
| Proximity alerts | ✅ Complete | 5km warning before stations |
| Turn-by-turn nav | ✅ Complete | Live tracking, instruction panel |
| Permit info | ⏳ Planned | Next priority |
| Save routes | ⏳ Planned | Next priority |
| Truck stops/fuel | ⏳ Planned | Nice-to-have |

---

## Next Steps

### Immediate (This Week)
- [ ] Auto-sync inspection stations on profile save
- [ ] Remove manual Sync button
- [ ] Add provincial permit info cards
- [ ] Build save route functionality

### Coming (Next Week)
- [ ] Add other provinces (Alberta, BC, etc.)
- [ ] Truck stop POIs (Petro, Pilot, etc.)
- [ ] Mobile device testing
- [ ] Styling refinement

### Phase 2
- [ ] iOS app (React Native)
- [ ] Android app (React Native)
- [ ] US expansion
- [ ] Fleet management features

---

## Technical Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React + Vite | UI and state management |
| Maps | HERE Maps API (CDN) | Routing, geocoding, display |
| Auth | Supabase | User login/signup |
| Database | Supabase PostgreSQL | Vehicle profiles, stations, routes |
| APIs | Ontario 511, HERE Maps | Real-time data |
| Hosting | Vercel (planned) | Production deployment |
| Version Control | GitHub | mothertrucker repo |

---

## Deployment Status

- ✅ Local development working
- ✅ Code committed to GitHub
- ⏳ Vercel deployment (not yet set up)
- ⏳ Mobile app stores (iOS/Android post-MVP)

---

## Key Metrics

- **Lines of code**: ~2000+ (React + HERE Maps integration)
- **Supabase tables**: 2 (vehicle_profiles, inspection_stations)
- **API integrations**: 4 (HERE routing, geocoding, autosuggest, Ontario 511)
- **Ontario MTO stations tracked**: 32
- **Route options calculated**: 3 per search
- **MVP completion estimate**: 85%

---

## Known Issues / Future Refinements

1. Turn-by-turn navigation tested on desktop (GPS simulated) — full mobile testing needed
2. Permit info cards not yet built — next priority
3. Only Ontario stations implemented — other provinces can be added later
4. UI styling is functional but basic — can be polished before launch
5. "Sync MTO Stations" admin button should be removed and made automatic

---

## How to Continue Building

**If picking up this project later:**
1. `git clone https://github.com/YOUR_USERNAME/mothertrucker`
2. `npm install`
3. `npm run dev`
4. Open `http://localhost:5173`
5. Check PROGRESS.md for what's been done
6. Use Claude Code for new features

**Current priorities:**
- Auto-sync stations on profile save
- Provincial permit info
- Save route functionality

---

**Status**: 🟡 Phase 1 — 85% complete. Core features working. Polish and edge cases remaining.
# Mother Trucker — Project Progress Log

**App**: Truck navigation for oversize/overweight owner-operator drivers in Canada
**GitHub Repo**: mothertrucker
**Tech Stack**: React + Vite, HERE Maps API, Supabase, Ontario 511 API, Resend
**Domain**: mothertrucker.ca
**Last Updated**: July 4, 2026 (Evening Session)

---

## App Vision

Mother Trucker is a web-first navigation application designed specifically for
owner-operator truck drivers hauling oversize (OS) and overweight (OW) loads
in Canada (Phase 1), with planned expansion to the United States (Phase 2).

The app provides truck-safe routing that accounts for bridge clearances, weight
restrictions, height limits, seasonal road restrictions, provincial permits,
and real-time MTO inspection station alerts — features that standard navigation
apps like Google Maps and Waze do not offer.

**Target User**: Owner-operators hauling oversize and overweight loads
**Primary Market**: Canada (Phase 1), North America (Phase 2)
**Platform**: Web-first (iOS and Android to follow in later phases)
**Professional Domain**: mothertrucker.ca

---

## Phase 1 Milestones

| Milestone | Description | Status |
|-----------|-------------|--------|
| 1. Foundation | Tech stack, auth, vehicle profiles | ✅ Complete |
| 2. Core Routing | Truck-safe routing with vehicle specs | ✅ Complete |
| 3. Driver Tools | MTO stations, route options, turn-by-turn, saved routes | ✅ Complete |
| 4. MVP Launch | Beta testing, legal docs, soft launch | 🔄 In Progress |

**Completion**: ~95% — Ready for beta testing

---

## Chapter 1 — Planning & Research
### (Pre-build)

**Competitive Gap Analysis**
- CoPilot Truck, Trucker Path, Hammer GPS exist but focus on general commercial trucking
- **Mother Trucker's unique value**: MTO mandatory inspection stations, permit visualization, seasonal restrictions, owner-operator focus

**Tech Stack Selected**
- Frontend: React + Vite
- Maps: HERE Maps API (truck routing included)
- Auth: Supabase
- Database: Supabase PostgreSQL
- Email: Resend + mothertrucker.ca domain
- Version Control: GitHub
- Hosting: Vercel (planned)

---

## Chapter 2 — Foundation Build (Milestone 1)
### June 24, 2026

**Completed**
- ✅ React + Vite project setup
- ✅ HERE Maps integration via CDN
- ✅ Supabase database and authentication
- ✅ Email/password login and signup
- ✅ Vehicle profile form (height, width, length, weight, axles, load type)
- ✅ Vehicle profiles persisted to Supabase with RLS
- ✅ GitHub repo initialized

**Database Tables Created**
- `vehicle_profiles` — user truck specifications

---

## Chapter 3 — Core Features (Milestones 2 & 3)
### June 26 - July 4, 2026

### Truck-Safe Routing ✅
- HERE Maps Routing API v8 with vehicle dimensions
- Routes respect: height, width, length, weight, axle count
- Orange polyline display with start/end markers
- Distance (km) and duration (h:m) displayed
- Proper unit conversions (kg→grams, m→cm for API)
- Geolocation tracking for live driver position

### Smart Address & Business Search ✅
- Real-time autocomplete dropdown
- Supports street addresses AND business names
- Example: "Canadian Tire Motorsport Park" resolves correctly
- Search limited to Canada
- Fixed focus/blur race condition for reliability

### Multiple Route Options ✅
- 3 simultaneous route calculations:
  - **Fastest** (may include tolls)
  - **No Tolls** (toll avoidance enabled)
  - **Shortest** (minimize distance)
- Each option shows: distance, time, toll indicator
- Selectable cards — click to redraw
- Grey polylines show all 3 options at once
- Fastest selected by default

### Ontario MTO Inspection Stations ✅
- **Live Ontario 511 API integration** — 32 stations pulled in real-time
- Stations display only on calculated route (bounding box query)
- Click markers to see: name, highway, direction, region, phone
- Distinct blue markers vs HERE weigh stations
- **Proximity alerts**:
  - 2 km away: Toast notification (15 sec auto-dismiss)
  - 500m away: Persistent banner with distance countdown
  - Auto-dismisses 100m after passing
- Color-coded alerts: Red for MTO stations

### Provincial Permit Info Cards ✅
- Ontario permit requirements displayed
- Links to provincial permit portals
- Escort requirements
- Seasonal restrictions info
- MTO contact: 1-866-MTO-5627
- Cards visible during route planning (hidden during navigation)

### Turn-by-Turn GPS Navigation ✅
- Geolocation API for live position tracking
- Map follows driver (zoomed level 16, centered above driver)
- Driver marker with direction rotation
- Turn-by-turn instruction panel showing:
  - Next maneuver
  - Distance to maneuver
  - Next-next maneuver preview
- Progress tracking through route segments
- Start/Stop Navigation buttons
- Off-route detection (100m tolerance) with recalculation prompt

### Navigation UI ✅
- **Top right options menu (⋮)**:
  - View Profile
  - MTO Contact Info
  - Speed Units (Auto-detect / km/h / mph)
- **Top right speed display**:
  - Current speed (from geolocation)
  - Speed limit of current road (from HERE Maps)
  - Placeholder if unavailable
  - Auto-detects region for unit conversion
- **Bottom right trip stats panel** (visible during navigation):
  - Remaining distance (km)
  - Estimated Time of Arrival (ETA)
  - Estimated time remaining
  - Real-time updates as driver progresses
- **HERE Maps controls repositioned** to bottom left (zoom, layer swatch, scale)

### Distance-Based Alerts ✅
- **2 km away**: Toast pop-up (top left, 15 sec auto-dismiss)
  - Shows "Incoming: [Station/Exit/Turn]"
- **500m away**: Persistent banner (top left)
  - Real-time distance countdown
  - Stays until driver passes point
  - Auto-dismisses 100m after passing
- Alert types: MTO stations, exits, maneuvers
- Color-coded: red for stations, yellow for exits, blue for turns

### Saved Routes ✅
- **Save Route button** after route calculation
- Driver names the route (e.g. "Toronto to Vancouver")
- Route data persisted to Supabase
- **Select Previous Route dropdown** showing:
  - Top 3 most-used routes (sorted by load_count)
  - "See more" link to view all routes
  - Search bar to filter saved routes
  - Each shows: name, start, destination, distance, last used
- **Load saved route** repopulates start/end locations and recalculates
- load_count increments each time route is loaded
- last_used timestamp updated automatically

**Database Tables**
- `saved_routes` — user's saved routes with frequency tracking

### Authentication & Security ✅
- Email/password login and signup
- Forgot Password feature (UI complete, email pending full setup)
- Supabase session management
- RLS (Row Level Security) on all user data tables
- Professional domain: mothertrucker.ca

### Email Setup (In Progress) 🔄
- Domain: **mothertrucker.ca** purchased from Namecheap ($16.40/year)
- Resend email service integrated
- DNS records partially verified:
  - ✅ DKIM verified
  - ⏳ MX record pending
  - ⏳ SPF record pending
- Once DNS fully propagates (~1-2 hours), password reset emails will deliver reliably
- Fallback: Supabase built-in email for critical auth emails (rate-limited)

---

## Current Feature Set

| Feature | Status | Notes |
|---------|--------|-------|
| User auth | ✅ Complete | Email/password, forgot password UI ready |
| Vehicle profiles | ✅ Complete | Saved to Supabase |
| Truck routing | ✅ Complete | Respects all vehicle dimensions |
| Route options | ✅ Complete | Fastest/No Tolls/Shortest |
| MTO stations | ✅ Complete | 32 Ontario stations, live 511 API |
| Proximity alerts | ✅ Complete | 2km & 500m distance-based |
| Turn-by-turn nav | ✅ Complete | Live tracking, full instruction panel |
| Navigation UI | ✅ Complete | Speed, ETA, trip stats, options menu |
| Provincial permits | ✅ Complete | Ontario info cards with contact |
| Saved routes | ✅ Complete | Full CRUD with frequency tracking |
| Email delivery | 🔄 In Progress | DNS verification pending (~1-2 hrs) |

---

## Database Schema

### vehicle_profiles
id          uuid primary key
user_id     uuid (references auth.users)
height      numeric (meters)
width       numeric (meters)
length      numeric (meters)
weight      numeric (kg)
axles       text
load_type   text
created_at  timestamp
updated_at  timestamp
RLS: Users see only their own profiles

### inspection_stations
id          uuid primary key
name        text
highway     text
direction   text
region      text
latitude    numeric
longitude   numeric
phone       text
information text
created_at  timestamp
RLS: Public read (no user-specific data)

### saved_routes
id          uuid primary key
user_id     uuid (references auth.users)
route_name  text
start_location text
end_location   text
start_lat   numeric
start_lng   numeric
end_lat     numeric
end_lng     numeric
distance    numeric (km)
duration    numeric (seconds)
load_count  integer (frequency tracking)
last_used   timestamp
created_at  timestamp
RLS: Users see only their own routes

---

## Next Steps

### Immediate (Before Beta Launch)
- [ ] Wait for DNS verification to complete on mothertrucker.ca
- [ ] Test password reset email once DNS verified
- [ ] Mobile device testing of GPS features
- [ ] Final UI polish/styling review
- [ ] Write Terms of Service and privacy policy
- [ ] Test with real drivers from your contacts

### Beta Testing Phase
- [ ] Deploy to Vercel
- [ ] Distribute app link to 3-5 driver contacts
- [ ] Collect feedback on:
  - Route accuracy
  - MTO station detection
  - GPS/navigation reliability
  - UI usability
  - Speed display accuracy
- [ ] Log all feedback and iterate

### Post-Beta (Phase 2)
- [ ] Add other provinces (Alberta, BC, etc.)
- [ ] Truck stop/fuel POI integration
- [ ] iOS app (React Native)
- [ ] Android app (React Native)
- [ ] US expansion with state-specific regulations
- [ ] Fleet management features
- [ ] Monetization (subscription pricing)

---

## Technical Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React + Vite | UI and state management |
| Maps | HERE Maps API (CDN) | Routing, geocoding, display |
| Auth | Supabase | User login/signup |
| Database | Supabase PostgreSQL | Profiles, routes, stations |
| APIs | Ontario 511, HERE Maps | Real-time data |
| Email | Resend + mothertrucker.ca | Password reset, notifications |
| Hosting | Vercel (planned) | Production deployment |
| Domain | mothertrucker.ca (Namecheap) | Professional branding |
| Version Control | GitHub | mothertrucker repo |

---

## Key Metrics

- **Code**: ~3000+ lines (React, HERE Maps, Supabase integration)
- **Supabase tables**: 3 (vehicle_profiles, inspection_stations, saved_routes)
- **API integrations**: 4 (HERE routing, geocoding, autosuggest, Ontario 511)
- **MTO stations tracked**: 32 live from Ontario
- **Route options per search**: 3
- **Alert thresholds**: 2 (2km and 500m)
- **MVP completion**: ~95%

---

**Status**: 🟢 Phase 1 MVP ~95% complete. Core features working. Ready for beta testing with real drivers.

**Next Action**: Deploy to Vercel and test with driver contacts.