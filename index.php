<?php
require_once 'token.php';
$csrf_token = csrf_generate();
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Baseball Games to Watch</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="app-layout">
        <!-- GLOBAL HEADER -->
        <header class="app-header">
            <div class="header-left">
                <div class="logo-area">
                    <span class="material-icons" style="color: #fff; font-size: 1.5rem;">sports_baseball</span>
                    <h1>Baseball Games to Watch</h1>
                </div>
            </div>
            <div class="header-right">
                <button id="settings-btn" class="btn settings-btn" title="Settings">
                    <span class="material-icons">settings</span>
                </button>
            </div>
        </header>

        <!-- MAIN LAYOUT (Left Content + Right Sidebar) -->
        <div class="main-container">
            <div class="content-left">

                <!-- METRICS SHELF -->
                <div class="metrics-shelf">
                    <div class="metric-card">
                        <div class="metric-icon-circle">
                            <span id="metric-percent">0%</span>
                        </div>
                        <div class="metric-info">
                            <span class="metric-label">SEASON GOAL</span>
                            <div class="metric-value"><span id="metric-seen">0</span> / 30 teams</div>
                            <span class="metric-sublabel" id="metric-remaining">0 teams remaining</span>
                        </div>
                    </div>
                    <div class="metric-card highlight-blue">
                        <div class="metric-info">
                            <span class="metric-label"><span class="material-icons">public</span> In 3-Day Window</span>
                            <div class="metric-value" id="metric-3day">0</div>
                            <span class="metric-sublabel">games with unseen teams</span>
                        </div>
                    </div>
                    <div class="metric-card highlight-green">
                        <div class="metric-info">
                            <span class="metric-label"><span class="material-icons unseen-icon">visibility</span> Both Teams Unseen</span>
                            <div class="metric-value" id="metric-both">0</div>
                            <span class="metric-sublabel">top priority matchups</span>
                        </div>
                    </div>
                    <div class="metric-card highlight-gold">
                        <div class="metric-info">
                            <span class="metric-label"><span class="material-icons">today</span> Today</span>
                            <div class="metric-value" id="metric-today">0</div>
                            <span class="metric-sublabel" id="metric-future">0 tomorrow • 0 day after</span>
                        </div>
                    </div>
                </div>

                <!-- TABS -->
                <div class="tabs-row">
                    <button class="tab-btn active" data-tab="today">
                        <span class="tab-date" id="tab-date-0">Day, Mon 00</span>
                        <span class="tab-title">Today</span>
                        <span class="tab-badge" id="badge-today">0</span>
                    </button>
                    <button class="tab-btn" data-tab="tomorrow">
                        <span class="tab-date" id="tab-date-1">Day, Mon 00</span>
                        <span class="tab-title">Tomorrow</span>
                        <span class="tab-badge" id="badge-tomorrow">0</span>
                    </button>
                    <button class="tab-btn" data-tab="dayafter">
                        <span class="tab-date" id="tab-date-2">Day, Mon 00</span>
                        <span class="tab-title">Day After</span>
                        <span class="tab-badge" id="badge-dayafter">0</span>
                    </button>
                </div>

                <!-- FILTERS -->
                <div class="filters-row">
                    <span class="filter-label"><span class="material-icons">filter_list</span> <span class="filter-text">Filter:</span></span>
                    <button class="filter-btn" id="filter-fun">
                        <span class="material-icons" style="color: var(--accent-blue); font-size: 18px; vertical-align: middle;">diamond</span> <span class="filter-text">Fun Games</span>
                    </button>
                    <button class="filter-btn" id="filter-unseen">
                        <span class="material-icons unseen-icon">visibility</span> <span class="filter-text">Both Teams Unseen</span>
                    </button>
                    <button class="filter-btn" id="filter-showcase">
                        <span class="material-icons" style="color: #f472b6;">auto_awesome</span> <span class="filter-text">Showcase</span>
                    </button>
                    <button class="filter-btn" id="filter-electric">
                        <span class="material-icons" style="color: var(--accent-gold);">bolt</span> <span class="filter-text">Electric Starters</span>
                    </button>
                    <button class="filter-btn" id="filter-broadcasts">
                        <span class="material-icons">tv</span> <span class="filter-text">Featured Broadcasts</span>
                    </button>
                </div>

                <!-- GAMES LIST -->

                <div class="games-list" id="games-container">
                    <div class="loading-state">Loading matchups...</div>
                </div>

            </div>

            <!-- RIGHT SIDEBAR: TEAMS CHECKLIST -->
            <aside class="sidebar-right">
                <div class="sidebar-header">
                    <div class="sidebar-title">
                        <h3>Standings</h3>
                        <span class="sidebar-subtitle" id="sidebar-remaining">0 of 30 remaining</span>
                    </div>
                    <div class="sidebar-circle-badge" id="sidebar-count">0</div>
                </div>
                <div class="divisions-container" id="divisions-container">
                    <div class="loading-state">Loading standings...</div>
                </div>
            </aside>
        </div>
        <footer class="app-footer">
            <div class="footer-content">
                <span class="material-icons" style="color: var(--accent-gold); font-size: 14px; vertical-align: middle;">bolt</span>
                <span id="pauly-sheep">Electric Starters from Pauly Sheep</span>
                <span class="footer-separator">&bull;</span>
                <span class="material-icons" style="color: var(--accent-blue); font-size: 14px; vertical-align: middle;">diamond</span>
                <span>from <a href="https://www.joeposnanski.com/p/the-most-fun-teams-in-baseball" target="_blank" rel="noopener noreferrer" class="footer-link">Joe Posnanski</a></span>
            </div>
        </footer>
    </div>
    <!-- Settings Modal -->
    <div id="electric-modal" class="modal-overlay" style="display:none" role="dialog" aria-modal="true" aria-labelledby="electric-modal-title">
        <div class="modal-box" role="document">
            <div class="modal-header">
                <span class="material-icons modal-header-icon" style="color: var(--text-muted)">settings</span>
                <span id="electric-modal-title" class="modal-title">Settings</span>
                <button id="electric-modal-close" class="modal-close-btn" aria-label="Close">
                    <span class="material-icons">close</span>
                </button>
            </div>
            <div id="electric-modal-body" class="modal-body">
                <p class="em-loading">Loading…</p>
            </div>
        </div>
    </div>

    <!-- Welcome Modal -->
    <div id="welcome-modal" class="modal-overlay" style="display:none" role="dialog" aria-modal="true" aria-labelledby="welcome-modal-title">
        <div class="modal-box welcome-modal-box" role="document">
            <div class="modal-header">
                <span class="material-icons modal-header-icon" style="color: var(--accent-green)">sports_baseball</span>
                <span id="welcome-modal-title" class="modal-title">Welcome to Baseball Games to Watch</span>
                <button id="welcome-modal-close" class="modal-close-btn" aria-label="Close">
                    <span class="material-icons">close</span>
                </button>
            </div>
            <div class="modal-body welcome-modal-body">
                <div class="welcome-illustration">
                    <span class="material-icons welcome-hero-icon">sports_baseball</span>
                </div>
                <h2>Track and watch all 30 MLB teams</h2>
                <p>This app helps recommend games to watch over the next three days with a goal of seeing all teams play in the season.</p>
                
                <div class="welcome-instruction-card">
                    <div class="welcome-instruction-item">
                        <span class="welcome-instruction-num">1.</span>
                        <div class="instruction-text">
                            Mark a team as seen by double-clicking on their name under <strong>Standings</strong>.
                        </div>
                    </div>
                    <div class="welcome-instruction-item">
                        <span class="welcome-instruction-num">2.</span>
                        <div class="instruction-text">
                            Customize options under the <span class="material-icons welcome-gear-icon">settings</span> menu.
                        </div>
                    </div>
                </div>

                <div class="welcome-action-area">
                    <button id="welcome-get-started-btn" class="welcome-btn-primary">Get Started</button>
                </div>
            </div>
        </div>
    </div>

    <script>window.CSRF_TOKEN = '<?= htmlspecialchars($csrf_token, ENT_QUOTES, 'UTF-8') ?>';</script>
    <script src="featured-events.js"></script>
    <script src="app.js"></script>
</body>
</html>
