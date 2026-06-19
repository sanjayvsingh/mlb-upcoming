# MLB Tracker - Product Requirements Document

## 1. Summary

MLB Tracker is a real-time baseball game discovery platform that helps fans watch every MLB team at least once per season. The app fetches live data from the MLB Stats API, highlights games featuring unseen teams, leverages AI recommendations to surface compelling matchups, and integrates with Canadian broadcasters and alternative baseball leagues. Built with vanilla frontend and PHP backend proxies.

## 2. Contacts

| Name | Role | Notes |
|------|------|-------|
| Sanja Singh | Product Owner & Engineer | Owns master Google Sheet, drives feature prioritization |
| Backend Proxy Layer | Dependency | PHP scripts for Gemini, MLB Stats, broadcaster scraping |
| MLB Stats API | External | Free schedule/standings; no rate limit concerns |
| Google Gemini API | External | AI recommendations; fallback chain for 429/503 errors |
| ipinfo.io | External | IP geo-detection for Canadian gating; retry on timeout |

## 3. Background

**Context:** User manually tracked all 30 MLB teams via Google Sheet in 2024, struggled to identify unseen team games.

**Timing:** MLB 2026 season in full swing (June 18, 2026); peak engagement April-September; off-season planning October-March.

**What Made It Possible:**
- MLB Stats API free and unlimited
- Google Gemini API low-cost (~$0.075/call)
- Vanilla JS stack reduces deployment overhead
- Working prototype proves concept (96 commits)

## 4. Objective

### Goals
1. Reduce unseen team discovery from hours/week to minutes
2. Surface compelling games via AI + fun score formula (≥8)
3. Enable friend sharing via URL parameters

### Business Benefits
- **Time savings:** 5 hours/season per user
- **Engagement:** 40%+ CTR target on AI showcase games
- **Retention:** Seasonal goal drives repeat use
- **Viral:** URL sharing enables word-of-mouth growth

### Success Metrics (SMART OKRs)
- **KR1:** 100 daily active users by season end 2026
- **KR2:** 30% customize electric starters (power user adoption)
- **KR3:** 15% generate/share links (viral coefficient 0.3)
- **KR4:** 90% feature availability (99.9% uptime)
- **KR5:** <2s page load, <500ms API response

## 5. Market Segments

### Segment 1: Season Goal Completionists (Primary)
**Who:** Fans pursuing "see all 30 teams in one season"  
**Problem:** ESPN/MLB.com show all games; users manually track unseen teams  
**Job:** Quickly find games with unseen teams  
**Size:** 50K-100K annually in US/Canada  
**Behavior:** Check 2-3x daily, share links weekly

### Segment 2: Pitcher Enthusiasts (Secondary)
**Who:** Fans who follow specific pitchers  
**Problem:** Top 10 electric starters hidden across 2,400+ games  
**Job:** Watch elite pitchers without missing compelling games  
**Size:** 20K-50K (more niche)  
**Behavior:** Customize 5-10 pitchers, share with friends

### Segment 3: Canadian Cord-Cutters (Tertiary)
**Who:** Canadian fans watching TSN/Sportsnet  
**Problem:** No central TSN/Sportsnet schedule aggregator  
**Job:** Find broadcasts on preferred networks  
**Size:** 10K (geo-specific)  
**Behavior:** Check weekly during season

## 6. Value Propositions

### Value Curve: Before vs. After
| Factor | Before | After | Importance |
|--------|--------|-------|------------|
| Time to find unseen games | 30-60 min | 2-3 min | Critical |
| Accuracy | 85% (manual) | 100% | Critical |
| Broadcast visibility | 50% | 95% | High |
| Pitcher quality insight | Manual lookup | Automated score | Medium |
| Sharing with friends | Manual copy | One-click URL | Medium |
| Mobile access | Poor | Optimized | Medium |

### Competitive Differentiation
Only tool combining: unseen team tracking + AI recommendations + Canadian broadcaster coverage + electric starters + URL sharing.

| Feature | MLB Tracker | ESPN | MLB.com | ESPN+ |
|---------|-----------|------|---------|-------|
| Unseen highlighting | ✅ | ❌ | ❌ | ❌ |
| AI recommendations | ✅ | ✅ | ❌ | ❌ |
| Canadian broadcasts | ✅ | ❌ | ❌ | ❌ |
| Electric starters | ✅ | ❌ | ❌ | ❌ |
| URL sharing | ✅ | ❌ | ❌ | ❌ |

## 7. Solution

### 7.1 UX Overview
- **Header:** Logo, title, Settings gear icon
- **Main:** Metrics shelf (progress, counts), tabs (today/tomorrow/dayafter), filters, game grid
- **Sidebar:** Division standings (team records, unseen eye icons)
- **Settings Modal:** Electric starters, Hot Bats, Milestones, Share, Reset, Owner status

### 7.2 Key Features

**Feature 1: Real-Time Game Discovery**
- Fetch 3-day schedule from MLB Stats API with probable starters
- Display chronologically with matchup, time, broadcasters
- Cache for 1 hour
- <500ms API response time

**Feature 2: Unseen Team Tracking**
- Initialize all 30 teams as unseen in localStorage
- Toggle seen/unseen per team
- Optional sync to owner's Google Sheet
- 100% accuracy, persist across sessions

**Feature 3: Performance Metrics**
- Progress circle (% teams seen)
- Count unseen games in 3-day window
- Count both-unseen games
- Game counts per tab
- Mobile-responsive (side-by-side metrics on <768px)

**Feature 4: Fun Score Ranking**
- Base 5 + rivalry (+3), divisional (+1), electric starters (+1), hot bats (+2), milestones (+1)
- Threshold: ≥8
- Tooltip explains score breakdown
- Filter by score
- <100ms calculation time

**Feature 5: AI Showcase Recommendations**
- Call Gemini API with standings, hot hitters, milestones, matchups
- Return top 5 games with 1-2 sentence reason
- Cache 6 hours
- Fallback to gemini-3.1-flash-lite on 429/503
- Serve stale cache on fetch failure with warning

**Feature 6: Electric Starters**
- Calculate score: (K/9 percentile × 1.3) + K/BB percentile
- Requires GS ≥ 3
- Top 10 cached daily
- Allow custom additions (stored in localStorage)
- Share via URL with player IDs
- Match by MLB player ID (not name)

**Feature 7: Broadcasting Integration**
- Display network abbreviations from API
- Scrape and inject MLB Network (all users)
- Scrape Sportsnet (Canada-only, geo-gated)
- Scrape TSN (Canada-only, geo-gated)
- Scrape Banana Ball (14-day window, marked with 🍌)
- Single geo-detection call per load, retry once
- Stale cache fallback on failure

**Feature 8: Settings Modal**
- Custom electric starters with autocomplete search
- Hot Bats league leaders table
- Milestone Watch list
- Share button (copies URL with seen=CSV + electric=CSV)
- Reset button (clears localStorage with confirmation)
- Owner Mode indicator

**Feature 9: Security**
- Per-session CSRF tokens in window.CSRF_TOKEN
- Every request requires X-CSRF-Token header
- Secure + HttpOnly + SameSite=Lax cookies
- Origin validation (whitelist mlb.sanvash.com + local)
- .htaccess blocks config.php, legacy secrets, cache files
- Centralized secrets in config.php (gitignored)

**Feature 10: Mobile Responsive**
- Metrics shelf: 4-col desktop, 2-col tablet, 1-col mobile
- Unseen metrics side-by-side on mobile
- Game cards full-width on <768px
- Touch-friendly tap targets (44px+)
- Settings modal 90-95% width on mobile

**Feature 11: Observability**
- Console log cache hits/misses
- Console log Gemini model choice and fallbacks
- Console log geo-detection country_code and retries
- Console warn on stale cache with timestamp
- Debug mode warning about test quota consumption

**Feature 12: Data Sync & Sharing**
- Owner mode: Sheet fetch on every load (no cache)
- Shared team override via seen=CSV (session-only)
- Shared electric starters via electric=CSV (merge, don't replace)
- Sheet sync <2s
- Sheet.php proxies to Google Sheets API

### 7.3 Technology Stack

**Frontend:** HTML5, CSS3 (flexbox, grid, conic-gradient), JS ES6+, Material Icons

**Backend:** PHP 7.4+, proxy scripts for Gemini, MLB Stats, broadcasters, geo-detection, Sheets, CSRF

**External APIs:** MLB Stats (free), Gemini ($0.075/call), ipinfo.io ($1K/year), Google Sheets (free)

**Caching:**
- localStorage: User data, custom pitchers (no TTL)
- sessionStorage: Filters, active tab (session)
- API responses: Gemini 6h, Electric 24h, Broadcasters 4h, Roster 24h

**Deployment:** Apache + PHP 7.4+, .htaccess for security/CSP headers, HTTPS required

### 7.4 Assumptions to Validate

| Assumption | Validation | Risk |
|-----------|-----------|------|
| 50K-100K interested in "all 30 teams" | Survey /r/baseball, Discord | High |
| 2-3x daily checks during season | Analytics (future) | Medium |
| 30% customize pitchers | A/B test Settings UX | Medium |
| 40%+ CTR on AI showcase | Event tracking (future) | Medium |
| Gemini $0.075/call sustainable at 100K DAU | Financial modeling | Low |
| Users value 1-click sharing | UX testing | Medium |

## 8. Release

### Phase 1: Stabilization (June-July 2026)
- Mobile responsive refinements
- Geo-detection retry logic
- Hot Bats multi-category scoring
- Console observability logging
- 4 weeks, internal only

### Phase 2: Growth (August-September 2026)
- Share link analytics
- CSV export
- Pitcher comparison tool
- Community leaderboard
- 6 weeks, ~15% users generate links

### Phase 3: Planning (October-November 2026)
- 7-day window, calendar, full-season view
- Advanced filtering (division, record range, K/9 range)
- Saved viewing plans
- 8 weeks, 25% explore extended windows

### Phase 4: Personalization (December 2026-January 2027, Off-Season)
- Dark mode
- Custom fun score weighting
- Analytics dashboard
- Multi-account support
- 10 weeks, 50% enable dark mode

### Phase 5: Proactive (2027 Season, January-March)
- Game reminders (notifications 1h, 15m before)
- Friend groups
- Slack/Discord integrations
- 12 weeks, 30% enable notifications

---

## Financial Model

**Annual Costs (100K DAU, 180-day season):**
- Gemini API: $6,750
- ipinfo.io: $1,200
- Hosting: $0 (personal server)
- CDN (Material Icons): $0 (Google Fonts free)
- **Total: ~$8K/year**

**Future Revenue Options:** Freemium ($1-2/month Pro), B2B licensing, data licensing

---

**Document Owner:** Sanja Singh  
**Last Updated:** June 18, 2026  
**Status:** Ready for engineering review
