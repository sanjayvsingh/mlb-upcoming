/**
 * MLB Tracker V2 - Client Side Logic
 */

const STATS_API_BASE = "https://statsapi.mlb.com/api/v1";

const MLB_OFFICIAL_NAMES = new Set([
    "Orioles", "Red Sox", "Yankees", "Rays", "Blue Jays",
    "White Sox", "Guardians", "Tigers", "Royals", "Twins",
    "Astros", "Angels", "Athletics", "Mariners", "Rangers",
    "Braves", "Marlins", "Mets", "Phillies", "Nationals",
    "Cubs", "Reds", "Brewers", "Pirates", "Cardinals",
    "Diamondbacks", "Rockies", "Dodgers", "Padres", "Giants"
]);

const CUSTOM_ELECTRIC_KEY = 'mlb_custom_electric';
const BROADCASTER_PREFS_KEY = 'mlb_broadcaster_prefs';

// Populated from electric.php (top 10 by formula) + user's custom starters from localStorage
let electricStarterIds  = new Set(); // MLB player IDs (numbers)
let electricStarterData = [];        // [{id, name, team, k9, kbb, score}] for modal display
let electricScoreMap    = new Map(); // id -> score for all GS>=3 pitchers
let allPitcherRoster    = null;      // [{id, name, team}] loaded lazily for search

// Broadcaster preferences (which featured broadcasters to show)
const BROADCASTERS = ['Special Events', 'Banana Ball', 'MLB Network', 'Sportsnet', 'TSN'];
function loadBroadcasterPrefs() {
    const stored = localStorage.getItem(BROADCASTER_PREFS_KEY);
    if (stored) return JSON.parse(stored);
    // Default: all enabled
    return Object.fromEntries(BROADCASTERS.map(b => [b, true]));
}
function saveBroadcasterPrefs(prefs) {
    localStorage.setItem(BROADCASTER_PREFS_KEY, JSON.stringify(prefs));
}

const TEAM_ABBR = {
    "Orioles": "BAL", "Red Sox": "BOS", "Yankees": "NYY", "Rays": "TBR", "Blue Jays": "TOR",
    "White Sox": "CHW", "Guardians": "CLE", "Tigers": "DET", "Royals": "KCR", "Twins": "MIN",
    "Astros": "HOU", "Angels": "LAA", "Athletics": "OAK", "Mariners": "SEA", "Rangers": "TEX",
    "Braves": "ATL", "Marlins": "MIA", "Mets": "NYM", "Phillies": "PHI", "Nationals": "WSN",
    "Cubs": "CHC", "Reds": "CIN", "Brewers": "MIL", "Pirates": "PIT", "Cardinals": "STL",
    "Diamondbacks": "ARI", "Rockies": "COL", "Dodgers": "LAD", "Padres": "SDP", "Giants": "SFG"
};

const ABBR_TO_TEAM = Object.fromEntries(Object.entries(TEAM_ABBR).map(([k, v]) => [v, k]));

const TEAM_FUN_SCORES = {
    "Dodgers": 5, "Athletics": 5, "Royals": 5, "Diamondbacks": 5, "Blue Jays": 5,
    "Red Sox": 4, "Braves": 4, "Mets": 4, "Reds": 4, "Phillies": 4,
    "Mariners": 4, "Cubs": 4, "Brewers": 4, "Orioles": 4,
    "Pirates": 3, "Tigers": 3, "Rangers": 3, "Padres": 3, "Rays": 3,
    "Yankees": 4, "Giants": 3, "Guardians": 2, "Twins": 2, "Astros": 2, "Cardinals": 2,
    "Angels": 1, "Rockies": 1, "White Sox": 1, "Marlins": 1, "Nationals": 1
};

function isOfficialMLBTeam(fullName) {
    return [...MLB_OFFICIAL_NAMES].some(n => fullName.includes(n));
}

function getLocalDateString(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Returns today's date, or a debug override via ?debugDate=YYYY-MM-DD
function getToday() {
    const params = new URLSearchParams(window.location.search);
    const debug = params.get('debugDate');
    if (debug) {
        const d = new Date(debug + 'T12:00:00'); // noon to avoid timezone edge cases
        if (!isNaN(d)) return d;
    }
    return new Date();
}

// Helper for caching heavy API requests
async function fetchJSONWithCache(url, ttlMs) {
    const cacheKey = `mlb_cache_${url}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            if (Date.now() - parsed.timestamp < ttlMs) {
                return parsed.data;
            }
        } catch (e) {}
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    try {
        localStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data }));
    } catch (e) {
        console.warn("Storage full", e);
    }
    return data;
}

// State
let myUnseenTeams = [...MLB_OFFICIAL_NAMES];
let allTeamsDetailed = []; // From standings
let standingsData = null; // Store raw standings for record and rank
let gamesData = { today: [], tomorrow: [], dayafter: [] };
let activeTab = 'today';
let filters = { bothUnseen: false, featured: false, electric: false, funGames: false, showcase: false };
let hotHitters = new Map();     // team nickname -> [{name, stat}]
let milestoneWatch = new Map(); // team nickname -> [{name, description}]
let cachedCountry = null;       // Result of geo-detection, shared across Canadian broadcaster fetches

// DOM Maps
const dom = {
    metricSeen: document.getElementById('metric-seen'),
    metricRemaining: document.getElementById('metric-remaining'),
    metricPercent: document.getElementById('metric-percent'),
    metric3Day: document.getElementById('metric-3day'),
    metricBoth: document.getElementById('metric-both'),
    metricToday: document.getElementById('metric-today'),
    metricFuture: document.getElementById('metric-future'),
    gamesContainer: document.getElementById('games-container'),
    divisionsContainer: document.getElementById('divisions-container'),
    sidebarRemaining: document.getElementById('sidebar-remaining'),
    sidebarCount: document.getElementById('sidebar-count')
};

async function init() {
    setupListeners();
    await loadEverything();
}

async function loadEverything() {
    try {
        loadStaticTeams();

        // Fire ALL network requests in parallel immediately
        const savedTeamsP = fetchSavedTeams();
        const standingsP = fetchStandings();
        const hotHittersP = fetchHotHittersAndMilestones();

        // Phase 1: Render games as soon as the schedule arrives
        // processGame works with defaults — unseen/fun scores may be approximate
        await fetchSchedule();
        renderSidebar();
        renderMetrics();
        renderTabs();
        renderGames();

        // Phase 2: Wait for enrichment data, then re-process for accurate scores
        await Promise.all([savedTeamsP, standingsP, hotHittersP]);
        reprocessAllGames();
        renderSidebar();
        renderMetrics();
        renderGames();

        // Phase 2.5: Apply Canadian, MLB Network, Banana Ball, and Electric starters (non-blocking)
        fetchSportsnetGames(); // No await — runs in background
        fetchTsnGames();       // No await — runs in background
        fetchMlbNetworkGames(); // No await — runs in background
        fetchBananaBallGames(); // No await — runs in background
        fetchElectricStarters(); // No await — runs in background

        // Phase 3: Fire Gemini in background (needs all enrichment data for prompt)
        const allGames = [...(gamesData.today || []), ...(gamesData.tomorrow || []), ...(gamesData.dayafter || [])];
        if (allGames.length > 0) {
            applyGeminiRecommendations(allGames); // No await — runs in background
        }
    } catch (e) {
        console.error("Load error:", e);
    } finally {
        // nothing — settings are opened via the gear icon in the header
    }
}

// Re-evaluate unseen status, fun scores, hot hitters, and milestones for all processed games
function reprocessAllGames() {
    [...gamesData.today, ...gamesData.tomorrow, ...gamesData.dayafter].forEach(g => {
        // Update unseen status
        g.away.unseen = g.away.official && isTeamMatch(g.away.name);
        g.home.unseen = g.home.official && isTeamMatch(g.home.name);
        g.bothUnseen = g.away.unseen && g.home.unseen;
        g.anyUnseen = g.away.unseen || g.home.unseen;

        // Recalculate electric status from current ID set
        if (!g.isBananaBall) {
            g.away.electric = !!(g.away.pitcherId && electricStarterIds.has(g.away.pitcherId));
            g.home.electric = !!(g.home.pitcherId && electricStarterIds.has(g.home.pitcherId));
            g.anyElectric   = g.away.electric || g.home.electric;
        }

        // Recalculate fun score from scratch
        const awayFun = TEAM_FUN_SCORES[g.away.nickname] || 0;
        const homeFun = TEAM_FUN_SCORES[g.home.nickname] || 0;
        let score = awayFun + homeFun;
        if (g.away.electric) score += 1;
        if (g.home.electric) score += 1;

        // Hot hitters
        const awayHH = (hotHitters.get(g.away.nickname) || []).map(h => ({...h, team: g.away.nickname}));
        const homeHH = (hotHitters.get(g.home.nickname) || []).map(h => ({...h, team: g.home.nickname}));
        g.hotHitterInfo = [...awayHH, ...homeHH];
        score += g.hotHitterInfo.reduce((sum, h) => sum + hotHitterBonus(h), 0);

        // Milestones
        const awayMS = (milestoneWatch.get(g.away.nickname) || []).map(m => ({...m, team: g.away.nickname}));
        const homeMS = (milestoneWatch.get(g.home.nickname) || []).map(m => ({...m, team: g.home.nickname}));
        g.milestoneInfo = [...awayMS, ...homeMS];
        score += g.milestoneInfo.length * 2;

        // Showcase bonus (preserve if already applied)
        if (g.isShowcase) score += 1;

        g.funScore = Math.ceil(score);
        g.isHighFun = Math.ceil(score) >= 8;
    });

    // Update allTeamsDetailed unseen status to match
    allTeamsDetailed.forEach(t => {
        t.unseen = isTeamMatch(t.name);
    });
}


function setupListeners() {
    document.getElementById('filter-fun').addEventListener('click', (e) => {
        filters.funGames = !filters.funGames;
        e.currentTarget.classList.toggle('active');
        renderGames();
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            const target = e.currentTarget;
            target.classList.add('active');
            activeTab = target.dataset.tab;
            renderGames();
        });
    });

    document.getElementById('filter-unseen').addEventListener('click', (e) => {
        filters.bothUnseen = !filters.bothUnseen;
        e.currentTarget.classList.toggle('active');
        renderGames();
    });

    document.getElementById('filter-broadcasts').addEventListener('click', (e) => {
        filters.featured = !filters.featured;
        e.currentTarget.classList.toggle('active');
        renderGames();
    });

    document.getElementById('filter-electric').addEventListener('click', (e) => {
        filters.electric = !filters.electric;
        e.currentTarget.classList.toggle('active');
        renderGames();
    });

    document.getElementById('filter-showcase').addEventListener('click', (e) => {
        filters.showcase = !filters.showcase;
        e.currentTarget.classList.toggle('active');
        renderGames();
    });

    document.getElementById('settings-btn')?.addEventListener('click', openElectricModal);
    document.getElementById('electric-modal-close')?.addEventListener('click', closeElectricModal);
    document.getElementById('electric-modal')?.addEventListener('click', function(e) {
        if (e.target === this) closeElectricModal();
    });
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') closeElectricModal();
    });

    // Event delegation for toggling team seen state
    dom.divisionsContainer.addEventListener('dblclick', (e) => {
        const teamItem = e.target.closest('.team-checklist-item');
        if (teamItem) {
            const teamName = teamItem.dataset.teamName;
            if (teamName) toggleTeamSeen(teamName);
            window.getSelection().removeAllRanges(); // clear accidental text selection
        }
    });
}

/// 1. Google Sheet Fetcher Helper
async function fetchGoogleSheet() {
    try {
        const res = await fetch('sheet.php', {
            headers: { 'X-CSRF-Token': window.CSRF_TOKEN }
        });
        if (!res.ok) {
            console.warn("Sheet fetch failed (Status: " + res.status + ")");
            myUnseenTeams = [...MLB_OFFICIAL_NAMES];
            return;
        }
        const data = await res.json();
        if (data.stale) {
            console.warn('[Sheet] Serving stale cache — fetch failed.');
        } else if (data.from_cache) {
            console.log('[Sheet] Loaded from cache.');
        }
        myUnseenTeams = data.teams || [...MLB_OFFICIAL_NAMES];
    } catch (e) {
        console.error("Failed to load spreadsheet.", e);
        myUnseenTeams = [...MLB_OFFICIAL_NAMES];
    }
}

// 2. Saved Teams (Owner vs Friends)
async function fetchSavedTeams() {
    const urlParams = new URLSearchParams(window.location.search);
    
    // Check for owner initialization
    if (urlParams.get('u') === 's') {
        localStorage.setItem('mlbTrackerOwner', 'true');
        urlParams.delete('u');
        const newUrl = window.location.origin + window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
        window.history.replaceState({}, document.title, newUrl);
    }
    
    const isOwner = localStorage.getItem('mlbTrackerOwner') === 'true';
    const seenParam = urlParams.get('seen');
    
    // Rule 1: Shared Links (?seen=)
    if (seenParam !== null) {
        // Electric starters from a share link apply to everyone, including owners
        const electricParam = urlParams.get('electric');
        if (electricParam) {
            const sharedIds = electricParam.split(',').map(s => parseInt(s.trim(), 10)).filter(id => !isNaN(id));
            if (sharedIds.length > 0) {
                await applySharedElectricStarters(sharedIds);
            }
        }
        urlParams.delete('seen');
        urlParams.delete('electric');
        const newUrl = window.location.origin + window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
        window.history.replaceState({}, document.title, newUrl);

        if (isOwner) {
            // Owners ignore the shared seen list — games always come from the Google Sheet
            await fetchGoogleSheet();
            return;
        }

        // Non-owners: apply the shared seen list
        const seenList = seenParam.split(',').map(s => {
            const code = s.trim().toUpperCase();
            return (ABBR_TO_TEAM[code] || s.trim()).toLowerCase();
        });
        myUnseenTeams = [...MLB_OFFICIAL_NAMES].filter(t => !seenList.includes(t.toLowerCase()));
        localStorage.setItem('mlbTrackerSeen', JSON.stringify(seenList));
        return;
    }
    
    // Rule 2: Owners always get the Google Sheet
    if (isOwner) {
        await fetchGoogleSheet();
        return;
    }
    
    // Rule 3: Friends get their personal Local Storage
    const localSeen = localStorage.getItem('mlbTrackerSeen');
    if (localSeen) {
        try {
            const seenList = JSON.parse(localSeen);
            myUnseenTeams = [...MLB_OFFICIAL_NAMES].filter(t => !seenList.includes(t.toLowerCase()));
            return;
        } catch(e) {}
    }
    
    // Rule 4: Blank Slate for new friends
    myUnseenTeams = [...MLB_OFFICIAL_NAMES];
}

// 2. Load 30 Teams Statically
function loadStaticTeams() {
    const MLB_TEAMS_STATIC = {
        "AL East": ["Orioles", "Red Sox", "Yankees", "Rays", "Blue Jays"],
        "AL Central": ["White Sox", "Guardians", "Tigers", "Royals", "Twins"],
        "AL West": ["Astros", "Angels", "Athletics", "Mariners", "Rangers"],
        "NL East": ["Braves", "Marlins", "Mets", "Phillies", "Nationals"],
        "NL Central": ["Cubs", "Reds", "Brewers", "Pirates", "Cardinals"],
        "NL West": ["Diamondbacks", "Rockies", "Dodgers", "Padres", "Giants"]
    };
    
    allTeamsDetailed = [];
    for (const [div, teams] of Object.entries(MLB_TEAMS_STATIC)) {
        teams.forEach(tName => {
            allTeamsDetailed.push({
                name: tName,
                division: div,
                unseen: isTeamMatch(tName),
                wins: 0,
                losses: 0,
                rank: 99
            });
        });
    }
}

// +1 for primary category, +0.5 per additional category
function hotHitterBonus(h) {
    return 1 + ((h.extras?.length || 0) * 0.5);
}

// 2.5 Hot Hitters & Milestone Watch
async function fetchHotHittersAndMilestones() {
    const year = getToday().getFullYear();

    // --- HOT HITTERS: season leaders in HR, SLG, and OPS ---
    try {
        // Use a smaller pool early in the season when sample sizes are tiny
        const now = getToday();
        const may1 = new Date(now.getFullYear(), 4, 1); // month is 0-indexed
        const leaderLimit = now < may1 ? 3 : 5;

        const url = `${STATS_API_BASE}/stats/leaders?leaderCategories=homeRuns,sluggingPercentage,onBasePlusSlugging&statGroup=hitting&limit=${leaderLimit}&season=${year}`;
        const TTL_12H = 12 * 60 * 60 * 1000;
        const data = await fetchJSONWithCache(url, TTL_12H);
        const CAT_PRIORITY = { homeRuns: 0, sluggingPercentage: 1, onBasePlusSlugging: 2 };
        const sortedLeaders = [...(data.leagueLeaders || [])].sort((a, b) =>
            (CAT_PRIORITY[a.leaderCategory] ?? 9) - (CAT_PRIORITY[b.leaderCategory] ?? 9)
        );
        sortedLeaders.forEach(cat => {
            (cat.leaders || []).forEach(leader => {
                const nickname = findNicknameFromApiName(leader.team?.name);
                if (!nickname) return;
                if (!hotHitters.has(nickname)) hotHitters.set(nickname, []);
                const rawVal = leader.value || '0';
                let statLabel;
                if (cat.leaderCategory === 'homeRuns') {
                    statLabel = `${rawVal} HR`;
                } else if (cat.leaderCategory === 'sluggingPercentage') {
                    statLabel = `${parseFloat(rawVal).toFixed(3).replace(/^0/, '')} SLG`;
                } else {
                    statLabel = `${parseFloat(rawVal).toFixed(3).replace(/^0/, '')} OPS`;
                }
                // Deduplicate across categories; track extra categories on the primary entry
                const existing = hotHitters.get(nickname);
                const entry = existing.find(h => h.name === leader.person.fullName);
                if (entry) {
                    if (!entry.extras) entry.extras = [];
                    entry.extras.push(statLabel);
                } else {
                    existing.push({ name: leader.person.fullName, stat: statLabel });
                }
            });
        });
    } catch(e) {
        console.warn('Hot hitters fetch failed:', e);
    }

    // --- MILESTONES: career leaders approaching round-number thresholds ---
    const MILESTONE_DEFS = [
        { category: 'homeRuns',   group: 'hitting',  targets: [500, 600, 700], window: 1,  unit: 'career home runs' },
        { category: 'hits',       group: 'hitting',  targets: [3000, 4000],    window: 2,  unit: 'career hits' },
        { category: 'strikeouts', group: 'pitching', targets: [3000],          window: 6,  unit: 'career strikeouts' }
    ];

    await Promise.all(MILESTONE_DEFS.map(async ({ category, group, targets, window, unit }) => {
        try {
            // Fetch top 100 career leaders; active players near milestones will surface naturally
            const url = `${STATS_API_BASE}/stats/leaders?leaderCategories=${category}&statGroup=${group}&statType=career&limit=100`;
            const TTL_12H = 12 * 60 * 60 * 1000;
            const data = await fetchJSONWithCache(url, TTL_12H);
            ((data.leagueLeaders?.[0]?.leaders) || []).forEach(leader => {
                const value = parseInt(leader.value, 10);
                for (const target of targets) {
                    const gap = target - value;
                    if (gap > 0 && gap <= window) {
                        const nickname = findNicknameFromApiName(leader.team?.name);
                        if (!nickname) return;
                        if (!milestoneWatch.has(nickname)) milestoneWatch.set(nickname, []);
                        milestoneWatch.get(nickname).push({
                            name: leader.person.fullName,
                            description: `${leader.person.fullName} needs ${gap} more to reach ${target.toLocaleString()} ${unit}`
                        });
                        break; // only flag the nearest milestone
                    }
                }
            });
        } catch(e) {
            console.warn(`Milestone fetch for ${category} failed:`, e);
        }
    }));
}

function findNicknameFromApiName(apiTeamName) {
    if (!apiTeamName) return null;
    const team = allTeamsDetailed.find(t => apiTeamName.includes(t.name) || t.name.includes(apiTeamName));
    return team?.name || null;
}

// 2.5 Standings -> Rank and Record
async function fetchStandings() {
    try {
        const year = getToday().getFullYear();
        const url = `${STATS_API_BASE}/standings?leagueId=103,104&season=${year}&standingsTypes=regularSeason`;
        const TTL_1H = 60 * 60 * 1000;
        const data = await fetchJSONWithCache(url, TTL_1H);
        
        if (data && data.records && data.records.length > 0) {
            standingsData = data.records;
            
            let anyTeamHasRecord = false;
            
            // Map stats back to allTeamsDetailed
            data.records.forEach(divRecord => {
                divRecord.teamRecords.forEach(tr => {
                    const apiName = tr.team.name;
                    const team = allTeamsDetailed.find(t => 
                        t.name.includes(apiName) || 
                        apiName.includes(t.name) ||
                        (t.name === "Diamondbacks" && apiName.toLowerCase().includes("d-back"))
                    );
                    if (team) {
                        team.wins = tr.wins;
                        team.losses = tr.losses;
                        team.rank = parseInt(tr.divisionRank);
                        if (tr.wins > 0 || tr.losses > 0) anyTeamHasRecord = true;
                    }
                });
            });

            // If ANY team has a record, then everyone should show a record (even if 0-0)
            if (anyTeamHasRecord || data.records.some(r => r.teamRecords.length > 0)) {
                allTeamsDetailed.forEach(t => {
                    t.hasRecord = true;
                });
            }
        }
    } catch (e) {
        console.error("Failed to fetch standings:", e);
    }
}

// 3. Schedule -> 3 Day Window
async function fetchSchedule() {
    try {
        const today = getToday();
        const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
        const dayAfter = new Date(today); dayAfter.setDate(today.getDate() + 2);

        const d0Str = getLocalDateString(today);
        const d1Str = getLocalDateString(tomorrow);
        const d2Str = getLocalDateString(dayAfter);
        
        const url = `${STATS_API_BASE}/schedule?sportId=1&startDate=${d0Str}&endDate=${d2Str}&hydrate=probablePitcher,broadcasts`;
        const res = await fetch(url);
        const data = await res.json();
        
        gamesData = { today: [], tomorrow: [], dayafter: [] };
        
        if (data.dates) {
            data.dates.forEach(dateObj => {
                const games = dateObj.games.map(processGame).sort((a,b) => a.date - b.date);
                
                if (dateObj.date === d0Str) gamesData.today = games;
                else if (dateObj.date === d1Str) gamesData.tomorrow = games;
                else if (dateObj.date === d2Str) gamesData.dayafter = games;
            });
        }
    } catch (e) {
        console.error("Failed to fetch schedule:", e);
    }
}

function processGame(game) {
    const away = game.teams.away.team.name;
    const home = game.teams.home.team.name;
    const awayOfficial = isOfficialMLBTeam(away);
    const homeOfficial = isOfficialMLBTeam(home);
    const awayUnseen = awayOfficial && isTeamMatch(away);
    const homeUnseen = homeOfficial && isTeamMatch(home);
    
    const awaySP        = game.teams.away.probablePitcher?.fullName || 'TBD';
    const homeSP        = game.teams.home.probablePitcher?.fullName || 'TBD';
    const awayPitcherId = game.teams.away.probablePitcher?.id ?? null;
    const homePitcherId = game.teams.home.probablePitcher?.id ?? null;

    const isElectricAway = !!(awayPitcherId && electricStarterIds.has(awayPitcherId));
    const isElectricHome = !!(homePitcherId && electricStarterIds.has(homePitcherId));

    let featuredNetworks = [];
    let allNetworks = [];
    if (game.broadcasts) {
        game.broadcasts.forEach(b => {
            // Filter duplicates out of the list for clean UI
            if (!allNetworks.includes(b.name)) allNetworks.push(b.name);
            const n = b.name.toLowerCase();
            if (n.includes('apple') || n.includes('peacock') || n.includes('netflix') || n.includes('free')) {
                if (!featuredNetworks.includes(b.name)) featuredNetworks.push(b.name);
            }
        });
    }
    
    // Static featured events (from featured-events.js)
    const gameDateStr = game.gameDate.substring(0, 10); // e.g. "2026-04-15"
    let featuredEventBonus = 0;
    FEATURED_EVENTS.forEach(event => {
        if (!event.dates.includes(gameDateStr)) return;
        if (event.teams === null) {
            // All games on this date are featured (e.g. Jackie Robinson Day)
            if (!featuredNetworks.includes(event.label)) {
                featuredNetworks.push(event.label);
                featuredEventBonus++;
            }
        } else {
            // Both specified teams must be in this matchup
            const teamsInGame = [away, home];
            const allMatch = event.teams.every(t => teamsInGame.some(name => name.includes(t) || t.includes(name)));
            if (allMatch && !featuredNetworks.includes(event.label)) {
                featuredNetworks.push(event.label);
                featuredEventBonus++;
            }
        }
    });

    // Calculate Fun Score
    const awayNickname = allTeamsDetailed.find(t => away.includes(t.name) || t.name.includes(away))?.name || away;
    const homeNickname = allTeamsDetailed.find(t => home.includes(t.name) || t.name.includes(home))?.name || home;
    const awayFun = TEAM_FUN_SCORES[awayNickname] || 0;
    const homeFun = TEAM_FUN_SCORES[homeNickname] || 0;
    let gameFunScore = awayFun + homeFun;
    if (isElectricAway) gameFunScore += 1;
    if (isElectricHome) gameFunScore += 1;

    // Hot Hitters bonus (+1 primary category, +0.5 per additional category, ceiling total)
    const awayHotHitters = (hotHitters.get(awayNickname) || []).map(h => ({...h, team: awayNickname}));
    const homeHotHitters = (hotHitters.get(homeNickname) || []).map(h => ({...h, team: homeNickname}));
    const allGameHotHitters = [...awayHotHitters, ...homeHotHitters];
    gameFunScore += allGameHotHitters.reduce((sum, h) => sum + hotHitterBonus(h), 0);

    // Milestone Watch bonus (+2 per milestone player in this game)
    const awayMilestones = (milestoneWatch.get(awayNickname) || []).map(m => ({...m, team: awayNickname}));
    const homeMilestones = (milestoneWatch.get(homeNickname) || []).map(m => ({...m, team: homeNickname}));
    const allGameMilestones = [...awayMilestones, ...homeMilestones];
    gameFunScore += allGameMilestones.length * 2;

    return {
        id: game.gamePk,
        date: new Date(game.gameDate),
        location: game.venue.name,
        funScore: Math.ceil(gameFunScore),
        isHighFun: gameFunScore >= 8,
        away: { name: away, nickname: awayNickname, unseen: awayUnseen, official: awayOfficial, sp: awaySP, pitcherId: awayPitcherId, electric: isElectricAway },
        home: { name: home, nickname: homeNickname, unseen: homeUnseen, official: homeOfficial, sp: homeSP, pitcherId: homePitcherId, electric: isElectricHome },
        bothUnseen: awayUnseen && homeUnseen,
        anyUnseen: awayUnseen || homeUnseen,
        anyElectric: isElectricAway || isElectricHome,
        allNetworks: allNetworks.length > 0 ? allNetworks.join(', ') : 'No TV Info',
        featuredNetworks: featuredNetworks,
        featuredEventBonus: featuredEventBonus,
        hotHitterInfo: allGameHotHitters,
        milestoneInfo: allGameMilestones
    };
}

// Rendering
function renderSidebar() {
    const divisions = {};
    let unseenCount = 0;
    
    // Check for teams with electric starters in the 3-day window
    const electricInfo = new Map(); // nickname -> { dateStr, pitcher }

    // Check for teams in featured events in the 3-day window
    const featuredTeamInfo = new Map(); // nickname -> event label
    [...gamesData.today, ...gamesData.tomorrow, ...gamesData.dayafter].forEach(g => {
        if (!g.featuredEventBonus) return;
        const eventLabel = g.featuredNetworks.find(n => FEATURED_EVENTS.some(e => e.label === n)) || 'Featured Event';
        if (g.away.nickname && !featuredTeamInfo.has(g.away.nickname)) featuredTeamInfo.set(g.away.nickname, eventLabel);
        if (g.home.nickname && !featuredTeamInfo.has(g.home.nickname)) featuredTeamInfo.set(g.home.nickname, eventLabel);
    });
    [...gamesData.today, ...gamesData.tomorrow, ...gamesData.dayafter].forEach(g => {
        const dateStr = formatDateForTab(g.date);
        
        // Find the nickname for away and home teams
        const awayNickname = g.away.nickname;
        const homeNickname = g.home.nickname;

        if (g.away.electric && awayNickname && !electricInfo.has(awayNickname)) {
            electricInfo.set(awayNickname, { date: dateStr, pitcher: g.away.sp });
        }
        if (g.home.electric && homeNickname && !electricInfo.has(homeNickname)) {
            electricInfo.set(homeNickname, { date: dateStr, pitcher: g.home.sp });
        }
    });
    
    allTeamsDetailed.forEach(team => {
        if (!divisions[team.division]) divisions[team.division] = [];
        divisions[team.division].push(team);
        if (team.unseen) unseenCount++;
    });
    
    // Header
    dom.sidebarRemaining.textContent = `${unseenCount} of 30 remaining`;
    dom.sidebarCount.textContent = unseenCount;
    
    // Metric Shelf Goal
    const seenCount = 30 - unseenCount;
    const percent = Math.round((seenCount/30)*100);
    dom.metricSeen.textContent = seenCount;
    dom.metricRemaining.textContent = `${unseenCount} teams remaining`;
    dom.metricPercent.textContent = `${percent}%`;
    dom.metricPercent.parentElement.style.setProperty('--progress', percent);
    if (seenCount === 30) dom.metricPercent.parentElement.style.borderColor = "var(--accent-green)";

    // Divisions HTML
    let html = '';
    const sortedDivs = ["AL East", "AL Central", "AL West", "NL East", "NL Central", "NL West"];
    sortedDivs.forEach(div => {
        // Sort by rank if we have it and it's not the default 99, else alphabetical
        const divTeams = divisions[div].sort((a,b) => {
            if (a.rank !== 99 && b.rank !== 99) return a.rank - b.rank;
            return a.name.localeCompare(b.name);
        });
        
        const unseenInDiv = divTeams.filter(t => t.unseen).length;
        
        html += `
            <div class="division-group">
                <div class="division-header">
                    <span>${escapeHTML(div)}</span>
                    <span class="division-counts">${unseenInDiv}/5 Unseen</span>
                </div>
                ${divTeams.map(t => {
                    const record = t.hasRecord ? `<span class="team-record">(${escapeHTML(t.wins)}-${escapeHTML(t.losses)})</span>` : '';
                    const info = electricInfo.get(t.name);
                    const electricIcon = info ? `<span class="material-icons sidebar-bolt" title="Electric starter: ${escapeHTML(info.pitcher)} (${escapeHTML(info.date)})">bolt</span>` : '';
                    const featuredLabel = featuredTeamInfo.get(t.name);
                    const featuredIcon = featuredLabel ? `<span class="material-icons sidebar-featured" title="Featured game: ${escapeHTML(featuredLabel)}">diamond</span>` : '';
                    return `
                        <div class="team-checklist-item ${t.unseen ? 'is-unseen' : 'is-seen'}" data-team-name="${escapeHTML(t.name)}" style="cursor: pointer; user-select: none;" title="Double-click to toggle seen state">
                            ${t.unseen ? '' : '<div class="custom-checkbox"><span class="material-icons">check</span></div>'}
                            ${escapeHTML(t.name)}${electricIcon}${featuredIcon}${record}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    });
    dom.divisionsContainer.innerHTML = html;
}

function toggleTeamSeen(teamName) {
    const isOwner = localStorage.getItem('mlbTrackerOwner') === 'true';
    const isUnseen = myUnseenTeams.some(u => u.toLowerCase() === teamName.toLowerCase());
    if (isUnseen) {
        myUnseenTeams = myUnseenTeams.filter(u => u.toLowerCase() !== teamName.toLowerCase());
    } else {
        myUnseenTeams.push(teamName);
    }
    
    // Friends save their state to localStorage
    if (!isOwner) {
        const seenTeams = [...MLB_OFFICIAL_NAMES].filter(t => !myUnseenTeams.some(u => u.toLowerCase() === t.toLowerCase()));
        localStorage.setItem('mlbTrackerSeen', JSON.stringify(seenTeams));
    }
    
    const teamObj = allTeamsDetailed.find(t => t.name === teamName);
    if (teamObj) teamObj.unseen = !isUnseen;
    
    // Re-evaluate game objects
    [...gamesData.today, ...gamesData.tomorrow, ...gamesData.dayafter].forEach(g => {
        g.away.unseen = isTeamMatch(g.away.name);
        g.home.unseen = isTeamMatch(g.home.name);
        g.bothUnseen = g.away.unseen && g.home.unseen;
        g.anyUnseen = g.away.unseen || g.home.unseen;
    });
    
    // Re-render affected parts
    renderSidebar();
    renderMetrics();
    renderGames();
}

function renderMetrics() {
    // Collect all games in 3-day
    const all = [...gamesData.today, ...gamesData.tomorrow, ...gamesData.dayafter];
    
    const anyUnseenCount = all.filter(g => g.anyUnseen).length;
    const bothUnseenCount = all.filter(g => g.bothUnseen).length;
    
    dom.metric3Day.textContent = anyUnseenCount;
    dom.metricBoth.textContent = bothUnseenCount;
    
    dom.metricToday.textContent = gamesData.today.length;
    dom.metricFuture.textContent = `${gamesData.tomorrow.length} tomorrow • ${gamesData.dayafter.length} day after`;
}

function renderTabs() {
    // Just populate dates dynamically onto the tabs
    const d0 = getToday();
    const d1 = new Date(d0); d1.setDate(d0.getDate() + 1);
    const d2 = new Date(d0); d2.setDate(d0.getDate() + 2);
    
    document.getElementById('tab-date-0').textContent = formatDateForTab(d0, "Today");
    document.getElementById('tab-date-1').textContent = formatDateForTab(d1, "Tomorrow");
    document.getElementById('tab-date-2').textContent = formatDateForTab(d2, "Day After");
    
    document.getElementById('badge-today').textContent = gamesData.today.length;
    document.getElementById('badge-tomorrow').textContent = gamesData.tomorrow.length;
    document.getElementById('badge-dayafter').textContent = gamesData.dayafter.length;
}

function renderGames() {
    const list = gamesData[activeTab] || [];
    const oneHourAgo = new Date(getToday() - 60 * 60 * 1000);
    
    // Apply filters
    const filtered = list.filter(g => {
        if (g.date < oneHourAgo) return false;
        if (g.isBananaBall) return !filters.funGames && !filters.bothUnseen && !filters.featured && !filters.electric && !filters.showcase;
        if (filters.bothUnseen && !g.bothUnseen) return false;
        if (filters.featured && g.featuredNetworks.length === 0) return false;
        if (filters.electric && !g.anyElectric) return false;
        if (filters.funGames && !g.isHighFun) return false;
        if (filters.showcase && !g.isShowcase) return false;
        return true;
    });
    
    if (filtered.length === 0) {
        dom.gamesContainer.innerHTML = `<div class="error-msg">No games match this filter.</div>`;
        return;
    }
    
    dom.gamesContainer.innerHTML = filtered.map(g => {
        const timeStr = escapeHTML(g.date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + ' ET');

        let badgesHtml;
        let pitcherSplitHtml;

        if (g.isBananaBall) {
            badgesHtml = `<div class="badge banana-badge" title="Banana Ball game on YouTube">🍌 YouTube</div>`;
            pitcherSplitHtml = `
                    <div class="pitcher-split">
                        <div>${escapeHTML(g.location)}</div>
                        <div></div>
                    </div>`;
        } else {
            const funTooltip = (() => {
                const components = [];
                const awayScore = TEAM_FUN_SCORES[g.away.nickname] || 0;
                const homeScore = TEAM_FUN_SCORES[g.home.nickname] || 0;
                const electric = (g.away.electric ? 1 : 0) + (g.home.electric ? 1 : 0);
                const hotBonus = g.hotHitterInfo.reduce((sum, h) => sum + hotHitterBonus(h), 0);
                const milestoneBonus = g.milestoneInfo.length * 2;
                if (awayScore > 0) components.push(`${awayScore} ${g.away.nickname}`);
                if (homeScore > 0) components.push(`${homeScore} ${g.home.nickname}`);
                if (electric > 0) components.push(`+${electric} Electric starter`);
                if (hotBonus > 0) components.push(`+${hotBonus % 1 === 0 ? hotBonus : hotBonus.toFixed(1)} Hot hitters`);
                if (milestoneBonus > 0) components.push(`+${milestoneBonus} Milestones`);
                if (g.isShowcase) components.push(`+1 Showcase game`);
                return `Fun score: ${g.funScore}${components.length > 0 ? ` (${components.join(', ')})` : ''}`;
            })();
            const hotHitterTooltip = g.hotHitterInfo.map(h => {
                const allStats = [h.stat, ...(h.extras || [])].join(' · ');
                return `${h.name} (${allStats})`;
            }).join(', ');
            const milestoneTooltip = g.milestoneInfo.map(m => m.description).join(' • ');
            const broadcasterPrefs = loadBroadcasterPrefs();
            const specialEventLabels = new Set(FEATURED_EVENTS.map(e => e.label));
            const filteredNetworks = g.featuredNetworks.filter(n => {
                const isSpecialEvent = specialEventLabels.has(n);
                if (isSpecialEvent) return broadcasterPrefs['Special Events'] !== false;
                return broadcasterPrefs[n] !== false;
            });
            badgesHtml = [
                `<div class="badge fun-badge" title="${escapeHTML(funTooltip)}"><span class="material-icons" style="color: inherit; font-size: 14px; vertical-align: middle; margin-right: 2px;">diamond</span>${escapeHTML(g.funScore)}</div>`,
                g.isShowcase ? `<div class="badge showcase-badge" title="${escapeHTML(g.showcaseReason)}"><span class="material-icons" style="font-size: 14px; vertical-align: middle; margin-right: 2px;">auto_awesome</span>SHOWCASE</div>` : '',
                g.bothUnseen ? `<div class="badge both-unseen-badge"><span class="material-icons" style="font-size: inherit; vertical-align: middle; margin-right: 4px;">star</span>BOTH UNSEEN</div>` : '',
                g.anyElectric ? `<div class="badge electric-badge mobile-only"><span class="material-icons" style="font-size: 14px; vertical-align: middle; margin-right: 2px;">bolt</span>ELECTRIC SP</div>` : '',
                g.hotHitterInfo.length > 0 ? `<div class="badge hot-hitter-badge" title="${escapeHTML(hotHitterTooltip)}"><span class="material-icons" style="color: inherit; font-size: 14px; vertical-align: middle; margin-right: 2px;">local_fire_department</span>HOT BATS</div>` : '',
                g.milestoneInfo.length > 0 ? `<div class="badge milestone-badge" title="${escapeHTML(milestoneTooltip)}"><span class="material-icons" style="color: inherit; font-size: 14px; vertical-align: middle; margin-right: 2px;">emoji_events</span>MILESTONE</div>` : '',
                ...filteredNetworks.map(n => `<div class="badge network-badge">${escapeHTML(n)}</div>`)
            ].join('');
            pitcherSplitHtml = `
                    <div class="pitcher-split">
                        <div class="${g.away.electric ? 'electric-sp' : ''}">
                            ${escapeHTML(g.away.sp)} ${g.away.electric ? '<span class="material-icons electric-star">bolt</span>' : ''}
                        </div>
                        <div class="${g.home.electric ? 'electric-sp' : ''}">
                            ${escapeHTML(g.home.sp)} ${g.home.electric ? '<span class="material-icons electric-star">bolt</span>' : ''}
                        </div>
                    </div>`;
        }

        return `
            <div class="game-card-row${g.isBananaBall ? ' banana-ball-card' : ''}">
                <div class="team-split">
                    <div class="matchup-team">
                        ${g.away.official ? (g.away.unseen ? `<span class="material-icons unseen-icon">visibility</span>` : `<span class="material-icons seen-icon">check</span>`) : ''}
                        <span class="team-name ${g.away.unseen ? 'unseen-text' : ''}">${escapeHTML(g.away.name)}</span>
                    </div>
                    <div class="matchup-team">
                        ${g.home.official ? (g.home.unseen ? `<span class="material-icons unseen-icon">visibility</span>` : `<span class="material-icons seen-icon">check</span>`) : ''}
                        <span class="team-name ${g.home.unseen ? 'unseen-text' : ''}">${escapeHTML(g.home.name)}</span>
                    </div>
                </div>
                ${pitcherSplitHtml}
                <div class="game-meta">
                    <div class="game-time">${timeStr}</div>
                    <div class="game-badges">
                        ${badgesHtml}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Utils
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isTeamMatch(name) {
    return myUnseenTeams.some(u => name.toLowerCase().includes(u.toLowerCase()) || u.toLowerCase().includes(name.toLowerCase()));
}
function formatDateForTab(d, prefix) {
    return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')}`;
}

function showToast(type) {
    const existing = document.getElementById('gemini-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'gemini-toast';
    toast.className = `toast-notification ${type === 'success' ? 'toast-success success-anim' : 'toast-error error-anim'}`;
    
    const icon = document.createElement('span');
    icon.className = 'material-icons toast-icon';
    icon.textContent = 'auto_awesome';

    const text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = type === 'success' ? 'Showcase Games Loaded' : 'Showcase Loading Error';

    toast.appendChild(icon);
    toast.appendChild(text);
    document.body.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, type === 'success' ? 3000 : 5000);
}

async function applyGeminiRecommendations(gamesList) {
    if (!gamesList || gamesList.length === 0) return;
    
    const params = new URLSearchParams(window.location.search);
    const debugDate = params.get('debugDate');

    // Build team context: standings, hot hitters, milestones
    const teamContext = {};
    allTeamsDetailed.forEach(t => {
        const abbr = TEAM_ABBR[t.name];
        if (!abbr) return;
        const ctx = {
            record: `${t.wins}-${t.losses}`,
            div: t.division,
            rank: t.rank !== 99 ? t.rank : null
        };
        const hh = hotHitters.get(t.name);
        if (hh && hh.length > 0) {
            ctx.hot = hh.map(h => `${h.name} (${[h.stat, ...(h.extras || [])].join(', ')}`);
        }
        const ms = milestoneWatch.get(t.name);
        if (ms && ms.length > 0) {
            ctx.milestones = ms.map(m => m.description);
        }
        teamContext[abbr] = ctx;
    });

    const payload = {
        debugDate: debugDate,
        teamContext: teamContext,
        games: gamesList.map(g => ({
            date: getLocalDateString(g.date),
            away: TEAM_ABBR[g.away.nickname || g.away.name] || g.away.nickname || g.away.name,
            home: TEAM_ABBR[g.home.nickname || g.home.name] || g.home.nickname || g.home.name,
            awaySp: g.away.sp,
            homeSp: g.home.sp
        }))
    };

    try {
        const res = await fetch('gemini.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': window.CSRF_TOKEN
            },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            console.warn("Gemini API call failed:", errData);
            showToast('error');
            return;
        }
        
        const text = await res.text();
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const data = JSON.parse(cleanText);
        
        if (data && data.games) {
            if (data.stale) {
                console.warn('[Gemini Proxy] Serving stale cache — API call failed.');
            } else if (data.from_cache) {
                console.log(`[Gemini Proxy] Results loaded from cache.`);
            }
            if (data.model_used) {
                console.log(`[Gemini Proxy] Response generated using model: ${data.model_used}`);
            }
            const allStorage = [gamesData.today, gamesData.tomorrow, gamesData.dayafter];
            data.games.forEach(reco => {
                const awayTeam = reco.a || reco.awayTeam;
                const homeTeam = reco.h || reco.homeTeam;
                const recoDate = reco.date || reco.d;
                const reason = reco.r || reco.reason;

                console.log(`Gemini reco: ${awayTeam} @ ${homeTeam} on ${recoDate} - ${reason}`);

                allStorage.forEach(dayList => {
                    if (!dayList) return;
                    const match = dayList.find(g => {
                        const aCode = TEAM_ABBR[g.away.nickname || g.away.name] || g.away.nickname || g.away.name;
                        const hCode = TEAM_ABBR[g.home.nickname || g.home.name] || g.home.nickname || g.home.name;
                        const isMatch = (aCode === awayTeam || aCode === TEAM_ABBR[awayTeam]) && 
                                        (hCode === homeTeam || hCode === TEAM_ABBR[homeTeam]);
                                        
                        if (!isMatch) return false;
                        
                        if (recoDate) {
                            return getLocalDateString(g.date) === recoDate;
                        }
                        return true;
                    });
                    
                    if (match) {
                        console.log(`Matched! Added to game ${match.id}`);
                        match.funScore += 1;
                        match.isHighFun = match.funScore >= 8;
                        match.isShowcase = true;
                        match.showcaseReason = reason;
                    }
                });
            });
            // Re-render once matches are applied
            renderGames();
            showToast('success');
        } else {
            showToast('error');
        }
    } catch (e) {
        console.warn("Skipping Gemini recommendations locally:", e);
        showToast('error');
    }
}

// Sportsnet name -> MLB nickname mapping
// Sportsnet uses city names (e.g., "Cleveland", "Toronto") while MLB API uses
// full names ("Cleveland Guardians"). This lookup handles ambiguous cities.
const SPORTSNET_TEAM_MAP = {
    'New York Yankees': 'Yankees',
    'New York Mets': 'Mets',
    'Chicago Cubs': 'Cubs',
    'Chicago White Sox': 'White Sox',
    'Los Angeles Dodgers': 'Dodgers',
    'Los Angeles Angels': 'Angels',
    'Los Angeles': 'Dodgers',
    'Cleveland': 'Guardians',
    'Toronto': 'Blue Jays',
    'Boston': 'Red Sox',
    'Houston': 'Astros',
    'Baltimore': 'Orioles',
    'Detroit': 'Tigers',
    'Minnesota': 'Twins',
    'Seattle': 'Mariners',
    'Texas': 'Rangers',
    'Oakland': 'Athletics',
    'Atlanta': 'Braves',
    'Miami': 'Marlins',
    'Philadelphia': 'Phillies',
    'Washington': 'Nationals',
    'Cincinnati': 'Reds',
    'Milwaukee': 'Brewers',
    'Pittsburgh': 'Pirates',
    'St. Louis': 'Cardinals',
    'Arizona': 'Diamondbacks',
    'Colorado': 'Rockies',
    'San Diego': 'Padres',
    'San Francisco': 'Giants',
    'Tampa Bay': 'Rays',
    'Kansas City': 'Royals',
    // Also map full team names
    'New York': 'Yankees' // Fallback — Sportsnet typically specifies "New York Yankees" or "New York Mets"
};

function sportsnetToNickname(snName) {
    if (!snName) return null;
    // Direct lookup first
    if (SPORTSNET_TEAM_MAP[snName]) return SPORTSNET_TEAM_MAP[snName];
    // Try partial matching
    for (const [key, val] of Object.entries(SPORTSNET_TEAM_MAP)) {
        if (snName.includes(key) || key.includes(snName)) return val;
    }
    // Last resort: check if the name IS a nickname already
    if (MLB_OFFICIAL_NAMES.has(snName)) return snName;
    return null;
}

async function detectCanada() {
    if (cachedCountry !== null) return cachedCountry === 'CA';
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const geoRes = await fetch('ipinfo.php', {
                headers: { 'X-CSRF-Token': window.CSRF_TOKEN },
                signal: AbortSignal.timeout(3000)
            });
            if (!geoRes.ok) { cachedCountry = ''; return false; }
            const geo = await geoRes.json();
            cachedCountry = geo.country_code || '';
            console.log(`[Geo] User detected in ${geo.country || cachedCountry}`);
            return cachedCountry === 'CA';
        } catch (e) {
            if (attempt < 2) {
                console.warn('[Geo] Detection timed out, retrying...');
            } else {
                cachedCountry = '';
                console.warn('[Geo] Detection failed:', e.message);
            }
        }
    }
    return false;
}

async function fetchSportsnetGames() {
    try {
        if (!(await detectCanada())) {
            console.log('[Sportsnet] Skipping — Sportsnet broadcasts are Canada-only');
            return;
        }

        const res = await fetch('sportsnet.php', {
            headers: { 'X-CSRF-Token': window.CSRF_TOKEN }
        });
        if (!res.ok) {
            console.warn('Sportsnet fetch failed:', res.status);
            return;
        }
        const data = await res.json();
        if (data.stale) {
            console.warn('[Sportsnet] Serving stale cache — API call failed.');
        } else if (data.from_cache) {
            console.log('[Sportsnet] Loaded from cache');
        }
        if (!data.games || data.games.length === 0) {
            console.log('[Sportsnet] No games found');
            return;
        }

        console.log(`[Sportsnet] ${data.games.length} broadcasts available`);

        const allSchedule = [...gamesData.today, ...gamesData.tomorrow, ...gamesData.dayafter];
        let matched = 0;
        const claimedIds = new Set(); // Track games already matched to avoid duplicates

        data.games.forEach(snGame => {
            const awayNick = sportsnetToNickname(snGame.away);
            const homeNick = sportsnetToNickname(snGame.home);
            if (!awayNick || !homeNick) {
                console.warn(`[Sportsnet] Could not map: ${snGame.away} @ ${snGame.home}`);
                return;
            }

            // Find an unclaimed matching game in the schedule
            const match = allSchedule.find(g => {
                if (claimedIds.has(g.id)) return false;
                const gAway = g.away.nickname;
                const gHome = g.home.nickname;
                if (gAway !== awayNick || gHome !== homeNick) return false;
                // If the Sportsnet broadcast has a date, only match games on that date
                if (snGame.date) {
                    const gameDate = getLocalDateString(g.date);
                    if (gameDate !== snGame.date) return false;
                }
                return true;
            });

            if (match) {
                claimedIds.add(match.id);
                // Add Sportsnet to featured networks if not already there
                if (!match.featuredNetworks.includes('Sportsnet')) {
                    match.featuredNetworks.push('Sportsnet');
                    matched++;
                }
                // Store the Sportsnet URL for potential linking
                if (snGame.url) {
                    match.sportsnetUrl = snGame.url;
                }
            }
        });

        if (matched > 0) {
            console.log(`[Sportsnet] Matched ${matched} games in 3-day window`);
            renderGames();
        }
    } catch (e) {
        console.warn('Sportsnet integration skipped:', e);
    }
}
async function fetchTsnGames() {
    try {
        if (!(await detectCanada())) {
            console.log('[TSN] Skipping — TSN broadcasts are Canada-only');
            return;
        }

        const res = await fetch('tsn.php', {
            headers: { 'X-CSRF-Token': window.CSRF_TOKEN }
        });
        if (!res.ok) {
            console.warn('[TSN] Fetch failed:', res.status);
            return;
        }
        const data = await res.json();
        if (data.stale) {
            console.warn('[TSN] Serving stale cache — fetch failed.');
        } else if (data.from_cache) {
            console.log('[TSN] Loaded from cache');
        }
        if (!data.games || data.games.length === 0) {
            console.log('[TSN] No games found');
            return;
        }

        console.log(`[TSN] ${data.games.length} broadcasts available`);

        const allSchedule = [...gamesData.today, ...gamesData.tomorrow, ...gamesData.dayafter];
        let matched = 0;
        const claimedIds = new Set();

        data.games.forEach(tsnGame => {
            const awayNick = sportsnetToNickname(tsnGame.away);
            const homeNick = sportsnetToNickname(tsnGame.home);
            if (!awayNick || !homeNick) {
                console.warn(`[TSN] Could not map: ${tsnGame.away} @ ${tsnGame.home}`);
                return;
            }

            const match = allSchedule.find(g => {
                if (claimedIds.has(g.id)) return false;
                if (g.away.nickname !== awayNick || g.home.nickname !== homeNick) return false;
                if (tsnGame.date) {
                    return getLocalDateString(g.date) === tsnGame.date;
                }
                return true;
            });

            if (match) {
                claimedIds.add(match.id);
                if (!match.featuredNetworks.includes('TSN')) {
                    match.featuredNetworks.push('TSN');
                    matched++;
                }
            }
        });

        if (matched > 0) {
            console.log(`[TSN] Matched ${matched} games in 3-day window`);
            renderGames();
        }
    } catch (e) {
        console.warn('[TSN] Integration skipped:', e);
    }
}

async function fetchMlbNetworkGames() {
    try {
        const res = await fetch('mlbnetwork.php', {
            headers: { 'X-CSRF-Token': window.CSRF_TOKEN }
        });
        if (!res.ok) {
            console.warn('MLB Network fetch failed:', res.status);
            return;
        }
        const data = await res.json();
        if (data.stale) {
            console.warn('[MLB Network] Serving stale cache — API call failed.');
        } else if (data.from_cache) {
            console.log('[MLB Network] Loaded from cache');
        }
        if (!data.games || data.games.length === 0) {
            console.log('[MLB Network] No games found');
            return;
        }

        console.log(`[MLB Network] ${data.games.length} broadcasts available`);

        const allSchedule = [...gamesData.today, ...gamesData.tomorrow, ...gamesData.dayafter];
        let matched = 0;
        const claimedIds = new Set(); // Track games already matched to avoid duplicates

        data.games.forEach(mlbnGame => {
            const awayNick = sportsnetToNickname(mlbnGame.away);
            const homeNick = sportsnetToNickname(mlbnGame.home);
            if (!awayNick || !homeNick) {
                console.warn(`[MLB Network] Could not map: ${mlbnGame.away} @ ${mlbnGame.home}`);
                return;
            }

            // Find an unclaimed matching game in the schedule
            const match = allSchedule.find(g => {
                if (claimedIds.has(g.id)) return false;
                const gAway = g.away.nickname;
                const gHome = g.home.nickname;
                if (gAway !== awayNick || gHome !== homeNick) return false;
                // If the MLB Network broadcast has a date, only match games on that date
                if (mlbnGame.date) {
                    const gameDate = getLocalDateString(g.date);
                    if (gameDate !== mlbnGame.date) return false;
                }
                return true;
            });

            if (match) {
                claimedIds.add(match.id);
                // Add MLB Network to featured networks if not already there
                if (!match.featuredNetworks.includes('MLB Network')) {
                    match.featuredNetworks.push('MLB Network');
                    matched++;
                }
            }
        });

        if (matched > 0) {
            console.log(`[MLB Network] Matched ${matched} games in 3-day window`);
            renderGames();
        }
    } catch (e) {
        console.warn('MLB Network integration skipped:', e);
    }
}

async function fetchBananaBallGames() {
    try {
        const res = await fetch('bananas.php', {
            headers: { 'X-CSRF-Token': window.CSRF_TOKEN }
        });
        if (!res.ok) {
            console.warn('[Bananas] Fetch failed:', res.status);
            return;
        }
        const data = await res.json();
        if (data.stale) console.warn('[Bananas] Serving stale cache.');
        else if (data.from_cache) console.log('[Bananas] Loaded from cache');
        if (!data.games || data.games.length === 0) {
            console.log('[Bananas] No YouTube games found');
            return;
        }

        console.log(`[Bananas] ${data.games.length} YouTube games available`);

        const today = getToday();
        const d0Str = getLocalDateString(today);
        const d1Str = getLocalDateString(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
        const d2Str = getLocalDateString(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2));

        let added = 0;
        data.games.forEach(bg => {
            const timeEt = bg.time_et || '19:00';
            const gameDate = new Date(`${bg.date}T${timeEt}:00`);
            const gameObj = {
                id: `banana_${bg.date}_${(bg.away + bg.home).replace(/\s+/g, '_')}`,
                date: gameDate,
                location: bg.venue || 'Banana Ball',
                isBananaBall: true,
                away: { name: bg.away || 'TBD', nickname: bg.away || 'TBD', official: false, unseen: false, sp: '', electric: false },
                home: { name: bg.home || 'TBD', nickname: bg.home || 'TBD', official: false, unseen: false, sp: '', electric: false },
                funScore: 0,
                isHighFun: false,
                bothUnseen: false,
                anyUnseen: false,
                anyElectric: false,
                isShowcase: false,
                allNetworks: 'YouTube',
                featuredNetworks: [],
                hotHitterInfo: [],
                milestoneInfo: []
            };

            if (bg.date === d0Str)      { gamesData.today.push(gameObj);    added++; }
            else if (bg.date === d1Str) { gamesData.tomorrow.push(gameObj); added++; }
            else if (bg.date === d2Str) { gamesData.dayafter.push(gameObj); added++; }
        });

        if (added > 0) {
            ['today', 'tomorrow', 'dayafter'].forEach(day => {
                gamesData[day].sort((a, b) => a.date - b.date);
            });
            console.log(`[Bananas] Added ${added} games to 3-day window`);
            renderGames();
        }
    } catch (e) {
        console.warn('[Bananas] Integration skipped:', e);
    }
}

// ── Electric Starters ────────────────────────────────────────────────────────

async function fetchElectricStarters() {
    try {
        const res = await fetch('electric.php');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.players) throw new Error('No players in response');

        electricStarterData = data.players;

        // Build score lookup for all GS>=3 pitchers
        electricScoreMap = new Map();
        if (data.scores) {
            Object.entries(data.scores).forEach(([id, score]) => electricScoreMap.set(Number(id), score));
        }

        // Rebuild ID set: formula top-10 + custom
        electricStarterIds = new Set();
        electricStarterData.forEach(p => electricStarterIds.add(p.id));

        const custom = loadCustomElectricStarters();
        custom.forEach(p => electricStarterIds.add(p.id));

        reprocessAllGames();
        renderGames();
        renderSidebar();
        console.log(`[Electric] Loaded ${electricStarterData.length} formula starters + ${custom.length} custom`);
    } catch (e) {
        console.warn('[Electric] Skipped:', e);
    }
}

function loadCustomElectricStarters() {
    try {
        return JSON.parse(localStorage.getItem(CUSTOM_ELECTRIC_KEY) || '[]');
    } catch (e) {
        return [];
    }
}

function saveCustomElectricStarters(list) {
    localStorage.setItem(CUSTOM_ELECTRIC_KEY, JSON.stringify(list));
}

function rebuildElectricIds() {
    electricStarterIds = new Set();
    electricStarterData.forEach(p => electricStarterIds.add(p.id));
    loadCustomElectricStarters().forEach(p => electricStarterIds.add(p.id));
    reprocessAllGames();
    renderGames();
    renderSidebar();
}

// ── Sharing ───────────────────────────────────────────────────────────────────

function buildShareUrl() {
    const seenTeams = [...MLB_OFFICIAL_NAMES].filter(t => !myUnseenTeams.some(u => u.toLowerCase() === t.toLowerCase()));
    const seenCodes = seenTeams.map(t => TEAM_ABBR[t] || t);
    let url = `${window.location.origin}${window.location.pathname}?seen=${seenCodes.join(',')}`;
    const customIds = loadCustomElectricStarters().map(p => p.id);
    if (customIds.length > 0) {
        url += `&electric=${customIds.join(',')}`;
    }
    return url;
}

async function applySharedElectricStarters(ids) {
    try {
        const res = await fetch('pitchers.php', { headers: { 'X-CSRF-Token': window.CSRF_TOKEN } });
        const data = await res.json();
        const roster = Array.isArray(data) ? data : (data.players || data.pitchers || []);
        const rosterMap = new Map(roster.map(p => [Number(p.id), p]));
        const existing = loadCustomElectricStarters();
        const existingIds = new Set(existing.map(p => p.id));
        let changed = false;
        ids.forEach(id => {
            if (!existingIds.has(id) && rosterMap.has(id)) {
                existing.push(rosterMap.get(id));
                changed = true;
            }
        });
        if (changed) saveCustomElectricStarters(existing);
    } catch(e) { /* non-critical */ }
}

// ── Electric Modal ────────────────────────────────────────────────────────────

function openElectricModal() {
    const modal = document.getElementById('electric-modal');
    if (!modal) return;
    renderElectricModal();
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    document.getElementById('pitcher-search-input')?.focus();
}

function closeElectricModal() {
    const modal = document.getElementById('electric-modal');
    if (!modal) return;
    modal.style.display = 'none';
    document.body.style.overflow = '';
    hidePitcherDropdown();
}

function renderElectricModal() {
    const body = document.getElementById('electric-modal-body');
    if (!body) return;

    const custom = loadCustomElectricStarters();

    const tableRows = electricStarterData.length
        ? electricStarterData.map((p, i) => `
            <tr>
                <td class="em-rank">${i + 1}</td>
                <td class="em-name">${escapeHTML(p.name)}</td>
                <td class="em-team">${escapeHTML(p.team)}</td>
                <td class="em-stat">${p.k9.toFixed(2)}</td>
                <td class="em-stat">${p.kbb.toFixed(2)}</td>
                <td class="em-score">${p.score.toFixed(2)}</td>
            </tr>`).join('')
        : '<tr><td colspan="6" class="em-loading">Loading…</td></tr>';

    const customChips = custom.length
        ? custom.map(p => {
            const score = electricScoreMap.get(p.id);
            const scoreTag = score != null ? `<span class="em-chip-score">${score.toFixed(2)}</span>` : '';
            return `
            <div class="custom-chip" data-id="${p.id}">
                <span>${escapeHTML(p.name)}</span>
                <span class="em-team-small">${escapeHTML(p.team)}</span>
                ${scoreTag}
                <button class="custom-chip-remove" data-id="${p.id}" title="Remove">×</button>
            </div>`;
        }).join('')
        : '<p class="em-empty">No custom starters yet.</p>';

    const STAT_ORDER = { 'HR': 0, 'SLG': 1, 'OPS': 2 };
    const hotBatsList = [];
    hotHitters.forEach((players, teamNick) => {
        players.forEach(p => hotBatsList.push({ ...p, team: teamNick }));
    });
    hotBatsList.sort((a, b) => {
        const suffixA = a.stat.split(' ').pop();
        const suffixB = b.stat.split(' ').pop();
        const orderDiff = (STAT_ORDER[suffixA] ?? 9) - (STAT_ORDER[suffixB] ?? 9);
        if (orderDiff !== 0) return orderDiff;
        return parseFloat(b.stat) - parseFloat(a.stat);
    });
    const hotBatsRows = hotBatsList.length
        ? hotBatsList.map(p => {
            const extras = (p.extras || []).map(e =>
                `<span class="em-hot-extra">${e}</span>`
            ).join('');
            return `
            <tr>
                <td class="em-name">${escapeHTML(p.name)}${extras}</td>
                <td class="em-team">${escapeHTML(p.team)}</td>
                <td class="em-stat em-hot-stat">${escapeHTML(p.stat)}</td>
            </tr>`;
        }).join('')
        : '<tr><td colspan="3" class="em-loading">Loading…</td></tr>';

    body.innerHTML = `
        <div class="settings-section-title">
            <span class="material-icons" style="font-size:16px;color:var(--accent-gold);vertical-align:middle;margin-right:5px">bolt</span>
            Electric Starters
        </div>
        <table class="electric-modal-table">
            <thead>
                <tr>
                    <th>#</th><th>Pitcher</th><th>Team</th>
                    <th title="Strikeouts per 9 innings">K/9</th>
                    <th title="Strikeout-to-walk ratio">K/BB</th>
                    <th title="Electric Score = (K/9 pct × 1.3) + K/BB pct">Score</th>
                </tr>
            </thead>
            <tbody>${tableRows}</tbody>
        </table>
        <div class="em-custom-section">
            <div class="em-custom-title">Custom Starters</div>
            <div id="custom-chips-list">${customChips}</div>
            <div class="pitcher-search-wrap">
                <input type="text" id="pitcher-search-input" placeholder="Search pitchers to add…" autocomplete="off">
                <div id="pitcher-search-results" class="pitcher-dropdown" style="display:none"></div>
            </div>
        </div>
        <div class="em-hot-bats-section">
            <div class="settings-section-title">
                <span class="material-icons" style="font-size:16px;color:#f97316;vertical-align:middle;margin-right:5px">local_fire_department</span>
                Hot Bats
            </div>
            <table class="electric-modal-table">
                <thead>
                    <tr><th>Player</th><th>Team</th><th>Stat</th></tr>
                </thead>
                <tbody>${hotBatsRows}</tbody>
            </table>
        </div>
        <div class="em-broadcaster-section">
            <div class="settings-section-title">
                <span class="material-icons" style="font-size:16px;color:#8b5cf6;vertical-align:middle;margin-right:5px">tv</span>
                Featured Broadcasts
            </div>
            <div class="em-broadcaster-list">
                ${BROADCASTERS.map(b => {
                    const prefs = loadBroadcasterPrefs();
                    const checked = prefs[b] ? 'checked' : '';
                    const displayLabel = b === 'Special Events' ? 'Special Events (Field of Dreams, etc.)' : b;
                    return `<label class="em-broadcaster-label">
                        <input type="checkbox" class="em-broadcaster-checkbox" data-broadcaster="${b}" ${checked}>
                        <span>${displayLabel}</span>
                    </label>`;
                }).join('')}
            </div>
        </div>
        <div class="em-sharing-section">
            <div class="settings-section-title" style="margin-bottom:0.5rem">
                <span class="material-icons" style="font-size:16px;color:var(--text-muted);vertical-align:middle;margin-right:5px">ios_share</span>
                Sharing
            </div>
            <div class="em-sharing-row">
                <button id="modal-share-btn" class="em-action-btn">
                    <span class="material-icons" style="font-size:16px;vertical-align:middle;margin-right:5px">share</span>Share My List
                </button>
                <button id="modal-reset-btn" class="em-action-btn em-action-btn--danger">
                    <span class="material-icons" style="font-size:16px;vertical-align:middle;margin-right:5px">refresh</span>Reset Progress
                </button>
            </div>
        </div>`;

    body.querySelectorAll('.custom-chip-remove').forEach(btn => {
        btn.addEventListener('click', () => removeCustomStarter(Number(btn.dataset.id)));
    });

    body.querySelectorAll('.em-broadcaster-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const prefs = loadBroadcasterPrefs();
            prefs[e.target.dataset.broadcaster] = e.target.checked;
            saveBroadcasterPrefs(prefs);
            renderGames();
        });
    });

    const searchInput = body.querySelector('#pitcher-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', onPitcherSearchInput);
        searchInput.addEventListener('keydown', onPitcherSearchKeydown);
    }

    const shareBtn = body.querySelector('#modal-share-btn');
    if (shareBtn) {
        shareBtn.addEventListener('click', () => {
            const url = buildShareUrl();
            navigator.clipboard.writeText(url).then(() => {
                const orig = shareBtn.innerHTML;
                shareBtn.innerHTML = '<span class="material-icons" style="font-size:16px;vertical-align:middle;margin-right:5px;color:var(--accent-green)">check</span>Copied!';
                setTimeout(() => shareBtn.innerHTML = orig, 2000);
            });
        });
    }

    const resetBtn = body.querySelector('#modal-reset-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (confirm('Clear all locally saved progress and tracking?')) {
                localStorage.clear();
                window.location.href = window.location.origin + window.location.pathname;
            }
        });
    }
}

let _pitcherHighlightIndex = -1;

function onPitcherSearchInput(e) {
    const q = e.target.value.trim();
    if (q.length < 2) { hidePitcherDropdown(); return; }
    showPitcherResults(q);
}

function onPitcherSearchKeydown(e) {
    const dd = document.getElementById('pitcher-search-results');
    if (!dd || dd.style.display === 'none') return;
    const items = dd.querySelectorAll('.pitcher-result-item');
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        _pitcherHighlightIndex = Math.min(_pitcherHighlightIndex + 1, items.length - 1);
        highlightPitcherResult(items);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _pitcherHighlightIndex = Math.max(_pitcherHighlightIndex - 1, 0);
        highlightPitcherResult(items);
    } else if (e.key === 'Enter' && _pitcherHighlightIndex >= 0) {
        e.preventDefault();
        items[_pitcherHighlightIndex]?.click();
    } else if (e.key === 'Escape') {
        hidePitcherDropdown();
    }
}

function highlightPitcherResult(items) {
    items.forEach((el, i) => el.classList.toggle('highlighted', i === _pitcherHighlightIndex));
    items[_pitcherHighlightIndex]?.scrollIntoView({ block: 'nearest' });
}

async function showPitcherResults(query) {
    if (!allPitcherRoster) {
        try {
            const res = await fetch('pitchers.php');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            allPitcherRoster = data.players || [];
        } catch (e) {
            console.warn('[Pitchers] Could not load roster:', e);
            return;
        }
    }

    const q = query.toLowerCase();
    const customIds = new Set(loadCustomElectricStarters().map(p => p.id));
    const formulaIds = new Set(electricStarterData.map(p => p.id));

    const matches = allPitcherRoster
        .filter(p => p.name.toLowerCase().includes(q))
        .slice(0, 10);

    if (matches.length === 0) { hidePitcherDropdown(); return; }

    const dd = document.getElementById('pitcher-search-results');
    if (!dd) return;
    _pitcherHighlightIndex = -1;

    dd.innerHTML = matches.map(p => {
        const alreadyCustom = customIds.has(p.id);
        const isFormula     = formulaIds.has(p.id);
        const tag = alreadyCustom ? ' <span class="em-tag-custom">custom</span>'
                  : isFormula     ? ' <span class="em-tag-formula">top 10</span>'
                  : '';
        return `<div class="pitcher-result-item${alreadyCustom ? ' already-added' : ''}"
                     data-id="${p.id}" data-name="${escapeHTML(p.name)}" data-team="${escapeHTML(p.team)}">
                    <span class="pr-name">${escapeHTML(p.name)}</span>
                    <span class="pr-team">${escapeHTML(p.team)}</span>${tag}
                </div>`;
    }).join('');

    dd.style.display = 'block';
    document.getElementById('pitcher-search-input')?.classList.add('has-results');

    dd.querySelectorAll('.pitcher-result-item:not(.already-added)').forEach(el => {
        el.addEventListener('click', () => {
            addCustomStarter({ id: Number(el.dataset.id), name: el.dataset.name, team: el.dataset.team });
            const input = document.getElementById('pitcher-search-input');
            if (input) input.value = '';
            hidePitcherDropdown();
        });
    });
}

function hidePitcherDropdown() {
    const dd = document.getElementById('pitcher-search-results');
    if (dd) dd.style.display = 'none';
    document.getElementById('pitcher-search-input')?.classList.remove('has-results');
    _pitcherHighlightIndex = -1;
}

function addCustomStarter(pitcher) {
    const list = loadCustomElectricStarters();
    if (list.some(p => p.id === pitcher.id)) return; // already there
    list.push(pitcher);
    saveCustomElectricStarters(list);
    rebuildElectricIds();
    renderElectricModal();
}

function removeCustomStarter(id) {
    const list = loadCustomElectricStarters().filter(p => p.id !== id);
    saveCustomElectricStarters(list);
    rebuildElectricIds();
    renderElectricModal();
}

document.addEventListener('DOMContentLoaded', init);
