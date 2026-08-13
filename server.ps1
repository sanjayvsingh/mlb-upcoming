$port = 8002
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Prefixes.Add("http://localhost:$port/")

try {
    $listener.Start()
    Write-Host "Starting local preview server at http://localhost:$port/"
    Write-Host "Press Ctrl+C to close."
    
    while ($listener.IsListening) {
        try {
            $context = $listener.GetContext()
            $response = $context.Response
            
            $localPath = $context.Request.Url.LocalPath.TrimStart('/')
            if ([string]::IsNullOrEmpty($localPath) -or $localPath -eq 'index.html') {
                $localPath = "index.php"
            }
            
            if ($context.Request.HttpMethod -eq 'OPTIONS') {
                $origin = $context.Request.Headers["Origin"]
                if ($origin -match "http://localhost:8002|http://127.0.0.1:8002|https://mlb.sanvash.com") {
                    $response.AddHeader("Access-Control-Allow-Origin", $origin)
                }
                $response.AddHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
                $response.AddHeader("Access-Control-Allow-Headers", "Content-Type, X-App-Token")
                $response.StatusCode = 200
                $response.Close()
                continue
            }

            if ($localPath -eq 'gemini.php' -and $context.Request.HttpMethod -eq 'POST') {
                $origin = $context.Request.Headers["Origin"]
                if ($origin -match "http://localhost:8002|http://127.0.0.1:8002|https://mlb.sanvash.com") {
                    $response.AddHeader("Access-Control-Allow-Origin", $origin)
                }
                
                $response.ContentType = "application/json"
                $cacheValid = $false
                
                $reader = New-Object System.IO.StreamReader($context.Request.InputStream)
                $inputJson = $reader.ReadToEnd()
                $inputObj = $inputJson | ConvertFrom-Json
                
                $debugDate = $null
                if ($inputObj.debugDate) {
                    $debugDate = $inputObj.debugDate
                }

                $safeDebugDate = ""
                if ($debugDate) {
                    $safeDebugDate = $debugDate -replace '[^0-9-]', ''
                }
                
                $cacheFileName = "gemini_cache.json"
                if ($safeDebugDate) {
                    $cacheFileName = "gemini_cache_$safeDebugDate.json"
                }
                $cacheFile = Join-Path $PSScriptRoot $cacheFileName
                
                if (Test-Path $cacheFile) {
                    $lastWrite = (Get-Item $cacheFile).LastWriteTime
                    if ((Get-Date) - $lastWrite -lt (New-TimeSpan -Hours 6)) {
                        $cacheValid = $true
                    }
                }

                if ($cacheValid) {
                    $content = [System.IO.File]::ReadAllBytes($cacheFile)
                    try {
                        $cacheStr = [System.Text.Encoding]::UTF8.GetString($content)
                        $cacheObj = ConvertFrom-Json $cacheStr
                        $cacheObj | Add-Member -MemberType NoteProperty -Name "from_cache" -Value $true
                        $content = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $cacheObj -Depth 5 -Compress))
                    } catch {}
                    $response.ContentLength64 = $content.Length
                    $response.OutputStream.Write($content, 0, $content.Length)
                } else {
                    $configFile = Join-Path $PSScriptRoot "config.php"
                    $geminiApiKey = ""
                    if (Test-Path $configFile) {
                        $configContent = Get-Content $configFile -Raw
                        if ($configContent -match "'gemini_api_key'\s*=>\s*'([^']+)'") {
                            $geminiApiKey = $matches[1]
                        }
                    }
                    if (-not $geminiApiKey) {
                        $errorBytes = [System.Text.Encoding]::UTF8.GetBytes('{"error": "Gemini API key not found in config.php"}')
                        $response.StatusCode = 500
                        $response.ContentLength64 = $errorBytes.Length
                        $response.OutputStream.Write($errorBytes, 0, $errorBytes.Length)
                    } else {
                        $teamCtx = @{}
                        if ($inputObj.teamContext) {
                            $inputObj.teamContext.PSObject.Properties | ForEach-Object {
                                $teamCtx[$_.Name] = $_.Value
                            }
                        }
                        
                        function Get-Ordinal($n) {
                            $s = @('th','st','nd','rd')
                            $v = [int]$n % 100
                            $suffix = $s[($v - 20) % 10]
                            if (-not $suffix) { $suffix = $s[$v] }
                            if (-not $suffix) { $suffix = $s[0] }
                            return "$n$suffix"
                        }
                        
                        $gamesList = ""
                        if ($inputObj.games) {
                            foreach ($g in $inputObj.games) {
                                $dateStr = ""
                                if ($g.date) { $dateStr = $g.date }
                                
                                # Enrich away team info
                                $awayInfo = $g.away
                                if ($teamCtx.ContainsKey($g.away)) {
                                    $tc = $teamCtx[$g.away]
                                    $awayInfo += " ($($tc.record)"
                                    if ($tc.rank) { $awayInfo += ", $(Get-Ordinal $tc.rank) $($tc.div)" }
                                    $awayInfo += ")"
                                }
                                
                                # Enrich home team info
                                $homeInfo = $g.home
                                if ($teamCtx.ContainsKey($g.home)) {
                                    $tc = $teamCtx[$g.home]
                                    $homeInfo += " ($($tc.record)"
                                    if ($tc.rank) { $homeInfo += ", $(Get-Ordinal $tc.rank) $($tc.div)" }
                                    $homeInfo += ")"
                                }
                                
                                $line = "- [$dateStr] $awayInfo @ $homeInfo | Pitchers: $($g.awaySp) vs $($g.homeSp)"
                                
                                # Hot hitters
                                $hotParts = @()
                                if ($teamCtx.ContainsKey($g.away) -and $teamCtx[$g.away].hot) {
                                    $hotParts += $teamCtx[$g.away].hot
                                }
                                if ($teamCtx.ContainsKey($g.home) -and $teamCtx[$g.home].hot) {
                                    $hotParts += $teamCtx[$g.home].hot
                                }
                                if ($hotParts.Count -gt 0) {
                                    $line += " | Hot: $($hotParts -join ', ')"
                                }
                                
                                # Milestones
                                $mileParts = @()
                                if ($teamCtx.ContainsKey($g.away) -and $teamCtx[$g.away].milestones) {
                                    $mileParts += $teamCtx[$g.away].milestones
                                }
                                if ($teamCtx.ContainsKey($g.home) -and $teamCtx[$g.home].milestones) {
                                    $mileParts += $teamCtx[$g.home].milestones
                                }
                                if ($mileParts.Count -gt 0) {
                                    $line += " | Milestone: $($mileParts -join '; ')"
                                }
                                
                                $gamesList += "$line`n"
                            }
                        }
                        
                        $startDateLabel = "today"
                        if ($safeDebugDate) {
                            $startDateLabel = $safeDebugDate
                        }
                        
                        $prompt = "You are an MLB analyst. Below is a list of all MLB games over the next three days (starting $startDateLabel), with each team's current record, division standing, probable pitchers, hot hitters, and milestone watches.`n`nEvaluate ALL of the games below and select the five most compelling to watch. Prioritize:`n- Meaningful rivalry or divisional matchups with playoff implications`n- Exceptional or historic pitching duels`n- Players chasing milestones or on hot streaks`n- Comeback stories, prospect debuts, or unusual storylines`n`nYou MUST ONLY choose from the games listed below. You MUST include the exact date for each pick.`nReturn ONLY valid JSON in this format: {`"games`":[{`"date`":`"YYYY-MM-DD`",`"a`":`"AWAY_TEAM_CODE`",`"h`":`"HOME_TEAM_CODE`",`"r`":`"1 sentence reason`"}]}`n`nGames:`n$gamesList"
                        
                        $primaryModel = "gemini-3-flash-preview"
                        $lightModel = "gemini-3.1-flash-lite"
                        $currentModel = $primaryModel
                        
                        if ($debugDate) {
                            $currentModel = $lightModel
                        }
                        
                        $bodyObj = @{
                            contents = @(
                                @{ parts = @( @{ text = $prompt } ) }
                            )
                            generationConfig = @{ response_mime_type = "application/json" }
                        }
                        $body = $bodyObj | ConvertTo-Json -Depth 5
                        
                        try {
                            Write-Host "Calling Gemini API ($startDateLabel)..."
                            $maxRetries = 3
                            $geminiResp = $null
                            
                            for ($i = 0; $i -lt $maxRetries; $i++) {
                                try {
                                    $uri = "https://generativelanguage.googleapis.com/v1beta/models/$currentModel`:`generateContent?key=$geminiApiKey"
                                    $geminiResp = Invoke-RestMethod -Uri $uri -Method Post -Body $body -ContentType "application/json"
                                    break
                                } catch {
                                    if (($_.Exception.Message -match "429" -or $_.Exception.Message -match "503") -and $currentModel -ne $lightModel) {
                                        # Fall back to light model
                                        $currentModel = $lightModel
                                        continue
                                    }
                                    
                                    if ($i -eq $maxRetries - 1) { throw }
                                    Start-Sleep -Seconds 2
                                }
                            }
                            
                            $geminiText = $geminiResp.candidates[0].content.parts[0].text
                            
                            # Inject model_used
                            $cleanText = $geminiText -replace '(?i)^```json\s*|\s*```$', ''
                            try {
                                $geminiObj = ConvertFrom-Json $cleanText
                                $geminiObj | Add-Member -MemberType NoteProperty -Name "model_used" -Value $currentModel
                                $geminiText = ConvertTo-Json $geminiObj -Depth 5 -Compress
                            } catch { 
                                # Ignore parse errors and just return raw text
                            }
                            
                            $responseBytes = [System.Text.Encoding]::UTF8.GetBytes($geminiText)
                            
                            [System.IO.File]::WriteAllBytes($cacheFile, $responseBytes)
                            
                            $response.ContentLength64 = $responseBytes.Length
                            $response.OutputStream.Write($responseBytes, 0, $responseBytes.Length)
                            Write-Host "Success!"
                        } catch {
                            Write-Host "Gemini API failed: $($_.Exception.Message)"
                            $errorMsg = "{ `"error`": `"Gemini API call failed.`", `"details`": `"$($_.Exception.Message)`" }"
                            $errorBytes = [System.Text.Encoding]::UTF8.GetBytes($errorMsg)
                            $response.StatusCode = 500
                            $response.ContentLength64 = $errorBytes.Length
                            $response.OutputStream.Write($errorBytes, 0, $errorBytes.Length)
                        }
                    }
                }
                $response.Close()
                continue
            }
            
            # Sportsnet scraper endpoint
            if ($localPath -eq 'sportsnet.php' -and $context.Request.HttpMethod -eq 'GET') {
                $origin = $context.Request.Headers["Origin"]
                if ($origin -match "http://localhost:8002|http://127.0.0.1:8002|https://mlb.sanvash.com") {
                    $response.AddHeader("Access-Control-Allow-Origin", $origin)
                }
                
                $response.ContentType = "application/json"

                $snCacheFile = Join-Path $PSScriptRoot "sportsnet_cache.json"
                $snCacheValid = $false

                if (Test-Path $snCacheFile) {
                    $snLastWrite = (Get-Item $snCacheFile).LastWriteTime
                    if ((Get-Date) - $snLastWrite -lt (New-TimeSpan -Hours 4)) {
                        $snCacheValid = $true
                    }
                }

                if ($snCacheValid) {
                    $snContent = [System.IO.File]::ReadAllBytes($snCacheFile)
                    try {
                        $snStr = [System.Text.Encoding]::UTF8.GetString($snContent)
                        $snObj = ConvertFrom-Json $snStr
                        $snObj | Add-Member -MemberType NoteProperty -Name "from_cache" -Value $true -Force
                        $snContent = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $snObj -Depth 5 -Compress))
                    } catch {}
                    $response.ContentLength64 = $snContent.Length
                    $response.OutputStream.Write($snContent, 0, $snContent.Length)
                } else {
                    try {
                        Write-Host "Fetching Sportsnet MLB schedule via API..."
                        $snApiBase = "https://production-cdn.d3-rgr-diva.com/api"
                        
                        try {
                            $snHomepage = Invoke-WebRequest -Uri "https://watch.sportsnet.ca/sportschedule" -UseBasicParsing -TimeoutSec 5 -UserAgent "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                            if ($snHomepage.Content -match "env\.CLIENT_SERVICE_CDN_URL='([^']+)'") {
                                $snApiBase = $matches[1].TrimEnd('/')
                            }
                        } catch {
                            Write-Host "Failed to dynamically discover API URL, using fallback."
                        }
                        
                        $snApiBase = "$snApiBase/sportschedules?competition=cp-mlb"

                        # Fetch today through day+3 to cover 3-day ET window
                        # (a game at 11 PM ET on day X is filed as day X+1 in UTC)
                        $snToday = Get-Date
                        $snDates = @()
                        for ($d = 0; $d -le 3; $d++) {
                            $snDates += $snToday.AddDays($d).ToString('yyyy-MM-dd')
                        }

                        $snGames = @()
                        $snSeenIds = @{}

                        foreach ($dateStr in $snDates) {
                            $snUrl = "$snApiBase&date=$dateStr&page_size=50"
                            try {
                                $snResp = Invoke-RestMethod -Uri $snUrl -UseBasicParsing -TimeoutSec 10 -UserAgent "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                            } catch {
                                Write-Host "  Sportsnet API failed for $dateStr`: $($_.Exception.Message)"
                                continue
                            }

                            if (-not $snResp.items) { continue }

                            foreach ($item in $snResp.items) {
                                if ($item.type -ne 'event') { continue }
                                $itemId = $item.id
                                if ($snSeenIds.ContainsKey($itemId)) { continue }
                                $snSeenIds[$itemId] = $true

                                $title = $item.title
                                $path = $item.path
                                $startUtc = $item.eventStartDate

                                if (-not $title -or -not $startUtc) { continue }

                                # Parse teams from title (e.g., "Toronto @ Tampa Bay")
                                $teamParts = $title -split '\s+@\s+', 2
                                if ($teamParts.Count -ne 2) { continue }

                                $snAway = $teamParts[0].Trim()
                                $snHome = $teamParts[1].Trim()

                                # Determine status
                                $videoStatus = $item.customFields.VideoStatus
                                $snStatus = if ($videoStatus -eq 'Live') { 'LIVE' } else { 'UPCOMING' }

                                # Convert UTC start time to Eastern for local date
                                $utcDt = [DateTime]::Parse($startUtc, $null, [System.Globalization.DateTimeStyles]::RoundtripKind)
                                $etZone = [TimeZoneInfo]::FindSystemTimeZoneById('Eastern Standard Time')
                                $etDt = [TimeZoneInfo]::ConvertTimeFromUtc($utcDt, $etZone)
                                $localDate = $etDt.ToString('yyyy-MM-dd')

                                $eventUrl = "https://watch.sportsnet.ca$path"

                                $snGames += @{
                                    away = $snAway
                                    home = $snHome
                                    status = $snStatus
                                    date = $localDate
                                    url = $eventUrl
                                }
                            }
                        }

                        $snResult = @{ games = $snGames; from_cache = $false }
                        $snJson = ConvertTo-Json $snResult -Depth 5 -Compress
                        
                        # Cache result
                        [System.IO.File]::WriteAllText($snCacheFile, $snJson, [System.Text.Encoding]::UTF8)
                        
                        $snBytes = [System.Text.Encoding]::UTF8.GetBytes($snJson)
                        $response.ContentLength64 = $snBytes.Length
                        $response.OutputStream.Write($snBytes, 0, $snBytes.Length)
                        Write-Host "Sportsnet: Found $($snGames.Count) games across $($snDates.Count) days"
                    } catch {
                        Write-Host "Sportsnet fetch failed: $($_.Exception.Message)"
                        $snError = '{"error":"Failed to fetch Sportsnet schedule","details":"' + ($_.Exception.Message -replace '"', "'") + '"}'
                        $snErrorBytes = [System.Text.Encoding]::UTF8.GetBytes($snError)
                        $response.StatusCode = 502
                        $response.ContentLength64 = $snErrorBytes.Length
                        $response.OutputStream.Write($snErrorBytes, 0, $snErrorBytes.Length)
                    }
                }
                $response.Close()
                continue
            }
            
            # MLB Network scraper endpoint
            if ($localPath -eq 'mlbnetwork.php' -and $context.Request.HttpMethod -eq 'GET') {
                $origin = $context.Request.Headers["Origin"]
                if ($origin -match "http://localhost:8002|http://127.0.0.1:8002|https://mlb.sanvash.com") {
                    $response.AddHeader("Access-Control-Allow-Origin", $origin)
                }
                
                $response.ContentType = "application/json"

                $mlbnCacheFile = Join-Path $PSScriptRoot "mlbnetwork_cache.json"
                $mlbnCacheValid = $false

                if (Test-Path $mlbnCacheFile) {
                    $mlbnLastWrite = (Get-Item $mlbnCacheFile).LastWriteTime
                    if ((Get-Date) - $mlbnLastWrite -lt (New-TimeSpan -Hours 24)) {
                        $mlbnCacheValid = $true
                    }
                }

                if ($mlbnCacheValid) {
                    $mlbnContent = [System.IO.File]::ReadAllBytes($mlbnCacheFile)
                    try {
                        $mlbnStr = [System.Text.Encoding]::UTF8.GetString($mlbnContent)
                        $mlbnObj = ConvertFrom-Json $mlbnStr
                        $mlbnObj | Add-Member -MemberType NoteProperty -Name "from_cache" -Value $true -Force
                        $mlbnContent = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $mlbnObj -Depth 5 -Compress))
                    } catch {}
                    $response.ContentLength64 = $mlbnContent.Length
                    $response.OutputStream.Write($mlbnContent, 0, $mlbnContent.Length)
                } else {
                    try {
                        Write-Host "Fetching MLB Network schedule..."
                        $mlbnUrl = "https://www.mlb.com/network/modules/shows/mlbn-live-games"
                        $mlbnHtml = Invoke-WebRequest -Uri $mlbnUrl -UseBasicParsing -TimeoutSec 10 -UserAgent "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                        
                        $mlbnGames = @()
                        
                        $pattern = '(?s)<tr[^>]*>\s*<td[^>]*>([^<]+)</td>\s*<td[^>]*>([^<]+)</td>\s*<td[^>]*>.*?<div[^>]*>([^<]+)</div>'
                        $htmlMatches = [regex]::Matches($mlbnHtml.Content, $pattern)
                        
                        foreach ($m in $htmlMatches) {
                            $dateStr = $m.Groups[1].Value.Trim()
                            $timeStr = $m.Groups[2].Value.Trim()
                            $desc = $m.Groups[3].Value.Trim()
                            
                            try {
                                $dtObj = [datetime]::ParseExact($dateStr, 'MM/dd/yyyy', $null)
                                $formattedDate = $dtObj.ToString('yyyy-MM-dd')
                            } catch {
                                continue
                            }
                            
                            $status = "UPCOMING"
                            if ($desc -match '\[LIVE\]') {
                                $status = "LIVE"
                            }
                            
                            $segments = $desc -split ' or '
                            foreach ($seg in $segments) {
                                $clean = $seg -replace '(?i)( from | on |\s*\(|\s*\[).*', ''
                                $mTeams = [regex]::Match($clean, '(?i)(.+?)\s+(?:at|@)\s+(.+)')
                                if ($mTeams.Success) {
                                    $mlbnGames += @{
                                        away = $mTeams.Groups[1].Value.Trim()
                                        home = $mTeams.Groups[2].Value.Trim()
                                        date = $formattedDate
                                        time = $timeStr
                                        status = $status
                                    }
                                }
                            }
                        }

                        $mlbnResult = @{ games = $mlbnGames; from_cache = $false }
                        $mlbnJson = ConvertTo-Json $mlbnResult -Depth 5 -Compress
                        
                        [System.IO.File]::WriteAllText($mlbnCacheFile, $mlbnJson, [System.Text.Encoding]::UTF8)
                        
                        $mlbnBytes = [System.Text.Encoding]::UTF8.GetBytes($mlbnJson)
                        $response.ContentLength64 = $mlbnBytes.Length
                        $response.OutputStream.Write($mlbnBytes, 0, $mlbnBytes.Length)
                        Write-Host "MLB Network: Found $($mlbnGames.Count) games"
                    } catch {
                        Write-Host "MLB Network fetch failed: $($_.Exception.Message)"
                        $mlbnErrorBytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Failed to fetch MLB Network schedule"}')
                        $response.StatusCode = 502
                        $response.ContentLength64 = $mlbnErrorBytes.Length
                        $response.OutputStream.Write($mlbnErrorBytes, 0, $mlbnErrorBytes.Length)
                    }
                }
                $response.Close()
                continue
            }

            # Electric starters endpoint
            if ($localPath -eq 'electric.php' -and $context.Request.HttpMethod -eq 'GET') {
                $origin = $context.Request.Headers["Origin"]
                if ($origin -match "http://localhost:8002|http://127.0.0.1:8002|https://mlb.sanvash.com") {
                    $response.AddHeader("Access-Control-Allow-Origin", $origin)
                }
                $response.ContentType = "application/json"

                $elecCacheFile = Join-Path $PSScriptRoot "electric_cache.json"
                $elecCacheValid = $false
                if (Test-Path $elecCacheFile) {
                    if ((Get-Date) - (Get-Item $elecCacheFile).LastWriteTime -lt (New-TimeSpan -Hours 24)) {
                        $elecCacheValid = $true
                    }
                }

                if ($elecCacheValid) {
                    $ec = [System.IO.File]::ReadAllBytes($elecCacheFile)
                    try {
                        $eo = ConvertFrom-Json ([System.Text.Encoding]::UTF8.GetString($ec))
                        $eo | Add-Member -MemberType NoteProperty -Name "from_cache" -Value $true -Force
                        $ec = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $eo -Depth 10 -Compress))
                    } catch {}
                    $response.ContentLength64 = $ec.Length
                    $response.OutputStream.Write($ec, 0, $ec.Length)
                } else {
                    try {
                        $season = (Get-Date).Year
                        $apiUrl = "https://statsapi.mlb.com/api/v1/stats?stats=season&group=pitching&season=$season&playerPool=All&limit=600"
                        Write-Host "Fetching electric starters for $season..."
                        $apiData = Invoke-RestMethod -Uri $apiUrl -TimeoutSec 10

                        $splits = $apiData.stats[0].splits

                        # Extract and filter: GS>=3 and valid K9 and KBB
                        $players = @()
                        foreach ($s in $splits) {
                            $gs  = [int]($s.stat.gamesStarted -replace '[^0-9]', '')
                            if ($gs -lt 3) { continue }
                            $k9  = try { [double]($s.stat.strikeoutsPer9Inn  -replace '[^0-9.]', '') } catch { 0 }
                            $kbb = try { [double]($s.stat.strikeoutWalkRatio -replace '[^0-9.]', '') } catch { 0 }
                            if ($k9 -eq 0 -or $kbb -eq 0) { continue }
                            $players += [PSCustomObject]@{
                                id   = $s.player.id
                                name = $s.player.fullName
                                team = $s.team.name
                                k9   = $k9
                                kbb  = $kbb
                            }
                        }

                        $n      = $players.Count
                        $k9List  = $players | ForEach-Object { $_.k9 }
                        $kbbList = $players | ForEach-Object { $_.kbb }

                        function Get-Percentile([double]$x, [double[]]$list) {
                            $cnt = ($list | Where-Object { $_ -le $x }).Count
                            return [Math]::Round($cnt / $list.Count, 4)
                        }

                        $scored = $players | ForEach-Object {
                            $k9p  = Get-Percentile $_.k9  $k9List
                            $kbbp = Get-Percentile $_.kbb $kbbList
                            [PSCustomObject]@{
                                id      = $_.id
                                name    = $_.name
                                team    = $_.team
                                k9      = $_.k9
                                kbb     = $_.kbb
                                k9_pct  = $k9p
                                kbb_pct = $kbbp
                                score   = [Math]::Round(($k9p * 1.3) + $kbbp, 4)
                            }
                        }

                        $top10 = $scored | Sort-Object score -Descending | Select-Object -First 10

                        $scoreMap = @{}
                        foreach ($sp in $scored) { $scoreMap["$($sp.id)"] = $sp.score }

                        $elecResult = @{ season = $season; total_qualified = $n; players = @($top10); scores = $scoreMap; from_cache = $false }
                        $elecJson   = ConvertTo-Json $elecResult -Depth 10 -Compress
                        [System.IO.File]::WriteAllText($elecCacheFile, $elecJson, [System.Text.Encoding]::UTF8)
                        Write-Host "Electric: scored $n qualified pitchers"

                        $elecPretty = ConvertTo-Json $elecResult -Depth 10
                        $elecBytes  = [System.Text.Encoding]::UTF8.GetBytes($elecPretty)
                        $response.ContentLength64 = $elecBytes.Length
                        $response.OutputStream.Write($elecBytes, 0, $elecBytes.Length)
                    } catch {
                        Write-Host "Electric fetch failed: $($_.Exception.Message)"
                        $eb = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$($_.Exception.Message -replace '"',"'")`"}")
                        $response.ContentLength64 = $eb.Length
                        $response.OutputStream.Write($eb, 0, $eb.Length)
                    }
                }
                $response.Close()
                continue
            }

            # TSN MLB schedule endpoint
            if ($localPath -eq 'tsn.php' -and $context.Request.HttpMethod -eq 'GET') {
                $origin = $context.Request.Headers["Origin"]
                if ($origin -match "http://localhost:8002|http://127.0.0.1:8002|https://mlb.sanvash.com") {
                    $response.AddHeader("Access-Control-Allow-Origin", $origin)
                }
                $response.ContentType = "application/json"

                $tsnCacheFile = Join-Path $PSScriptRoot "tsn_cache.json"
                $tsnCacheValid = $false
                if (Test-Path $tsnCacheFile) {
                    if ((Get-Date) - (Get-Item $tsnCacheFile).LastWriteTime -lt (New-TimeSpan -Hours 24)) {
                        $tsnCacheValid = $true
                    }
                }

                if ($tsnCacheValid) {
                    $tc = [System.IO.File]::ReadAllBytes($tsnCacheFile)
                    try {
                        $to = ConvertFrom-Json ([System.Text.Encoding]::UTF8.GetString($tc))
                        $to | Add-Member -MemberType NoteProperty -Name "from_cache" -Value $true -Force
                        $tc = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $to -Depth 5 -Compress))
                    } catch {}
                    $response.ContentLength64 = $tc.Length
                    $response.OutputStream.Write($tc, 0, $tc.Length)
                } else {
                    try {
                        Write-Host "Fetching TSN MLB schedule..."
                        $tsnHtml = (Invoke-WebRequest -Uri "https://www.tsn.ca/mlb/article/2025-mlb-on-tsn-schedule/" -UseBasicParsing -TimeoutSec 10 -UserAgent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36").Content

                        $tsnGames = @()
                        $year = (Get-Date).Year

                        # Find the first <table> and parse rows: Date | Time | Away | Home | Network
                        $tableMatch = [regex]::Match($tsnHtml, '(?is)<table[^>]*>(.*?)</table>')
                        if ($tableMatch.Success) {
                            $rows = [regex]::Matches($tableMatch.Groups[1].Value, '(?is)<tr[^>]*>(.*?)</tr>')
                            foreach ($row in $rows) {
                                $cols = [regex]::Matches($row.Groups[1].Value, '(?is)<td[^>]*>(.*?)</td>')
                                if ($cols.Count -lt 4) { continue }

                                $dateRaw = [regex]::Replace($cols[0].Groups[1].Value, '<[^>]+>', '').Trim()
                                $timeRaw = [regex]::Replace($cols[1].Groups[1].Value, '<[^>]+>', '').Trim()
                                $awayRaw = [regex]::Replace($cols[2].Groups[1].Value, '<[^>]+>', '').Trim()
                                $homeRaw = [regex]::Replace($cols[3].Groups[1].Value, '<[^>]+>', '').Trim()

                                # Strip "Sunday, " prefix and parse "May 3" -> YYYY-MM-DD
                                $cleanDate = $dateRaw -replace '^[a-zA-Z]+,\s*', ''
                                try {
                                    $dtParsed = [DateTime]::ParseExact("$cleanDate $year", 'MMMM d yyyy', [System.Globalization.CultureInfo]::InvariantCulture)
                                    $formattedDate = $dtParsed.ToString('yyyy-MM-dd')
                                } catch { continue }

                                if ($awayRaw -and $homeRaw -and $formattedDate) {
                                    $tsnGames += @{ away = $awayRaw; home = $homeRaw; date = $formattedDate; time = $timeRaw; status = 'UPCOMING' }
                                }
                            }
                        }

                        $tsnResult = @{ games = $tsnGames; from_cache = $false }
                        $tsnJson   = ConvertTo-Json $tsnResult -Depth 5 -Compress
                        [System.IO.File]::WriteAllText($tsnCacheFile, $tsnJson, [System.Text.Encoding]::UTF8)
                        Write-Host "TSN: Found $($tsnGames.Count) games"
                        $tsnBytes = [System.Text.Encoding]::UTF8.GetBytes($tsnJson)
                        $response.ContentLength64 = $tsnBytes.Length
                        $response.OutputStream.Write($tsnBytes, 0, $tsnBytes.Length)
                    } catch {
                        Write-Host "TSN fetch failed: $($_.Exception.Message)"
                        if (Test-Path $tsnCacheFile) {
                            $staleT = [System.IO.File]::ReadAllBytes($tsnCacheFile)
                            try {
                                $staleTO = ConvertFrom-Json ([System.Text.Encoding]::UTF8.GetString($staleT))
                                $staleTO | Add-Member -MemberType NoteProperty -Name "from_cache" -Value $true -Force
                                $staleTO | Add-Member -MemberType NoteProperty -Name "stale" -Value $true -Force
                                $staleT = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $staleTO -Depth 5 -Compress))
                            } catch {}
                            $response.ContentLength64 = $staleT.Length
                            $response.OutputStream.Write($staleT, 0, $staleT.Length)
                        } else {
                            $eb = [System.Text.Encoding]::UTF8.GetBytes('{"games":[],"error":"Failed to fetch TSN schedule"}')
                            $response.ContentLength64 = $eb.Length
                            $response.OutputStream.Write($eb, 0, $eb.Length)
                        }
                    }
                }
                $response.Close()
                continue
            }

            # Bananas (Savannah Bananas / Banana Ball) YouTube schedule endpoint
            if ($localPath -eq 'bananas.php' -and $context.Request.HttpMethod -eq 'GET') {
                $origin = $context.Request.Headers["Origin"]
                if ($origin -match "http://localhost:8002|http://127.0.0.1:8002|https://mlb.sanvash.com") {
                    $response.AddHeader("Access-Control-Allow-Origin", $origin)
                }
                $response.ContentType = "application/json"

                $bananaCacheFile = Join-Path $PSScriptRoot "bananas_cache.json"
                $bananaCacheValid = $false
                if (Test-Path $bananaCacheFile) {
                    if ((Get-Date) - (Get-Item $bananaCacheFile).LastWriteTime -lt (New-TimeSpan -Hours 4)) {
                        $bananaCacheValid = $true
                    }
                }

                if ($bananaCacheValid) {
                    $bc = [System.IO.File]::ReadAllBytes($bananaCacheFile)
                    try {
                        $bo = ConvertFrom-Json ([System.Text.Encoding]::UTF8.GetString($bc))
                        $bo | Add-Member -MemberType NoteProperty -Name "from_cache" -Value $true -Force
                        $bc = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $bo -Depth 5 -Compress))
                    } catch {}
                    $response.ContentLength64 = $bc.Length
                    $response.OutputStream.Write($bc, 0, $bc.Length)
                } else {
                    try {
                        Write-Host "Fetching Savannah Bananas schedule..."
                        $bananaHtml = (Invoke-WebRequest -Uri "https://thesavannahbananas.com/schedule/" -UseBasicParsing -TimeoutSec 10 -UserAgent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36").Content

                        # Hours to add to convert a US tz label to Eastern during DST
                        # The site uses standard abbreviations (PST/CST) even in summer
                        function Get-BananaEtOffset($tz) {
                            switch ($tz.ToUpper().Trim()) {
                                'PDT' { return 3 } 'PST' { return 3 }
                                'MDT' { return 2 } 'MST' { return 2 }
                                'CDT' { return 1 } 'CST' { return 1 }
                                default { return 0 }
                            }
                        }
                        function Convert-BananaToEtTime($timeStr, $tzLabel) {
                            $clean = $timeStr.Trim().ToLower() -replace '\s', ''
                            try {
                                $dt = [DateTime]::ParseExact($clean, 'h:mmtt', [System.Globalization.CultureInfo]::InvariantCulture)
                                $dt = $dt.AddHours((Get-BananaEtOffset $tzLabel))
                                return $dt.ToString('HH:mm')
                            } catch { return $null }
                        }

                        $bananaGames = @()
                        $seenKeys   = @{}
                        $todayD     = (Get-Date).Date

                        # Page uses <div class="event_row" data-date="YYYY-MM-DD">
                        # Split on each event_row opening tag
                        $blocks = [regex]::Split($bananaHtml, '(?=<div[^>]+class="event_row"[^>]+data-date)')

                        foreach ($block in $blocks) {
                            if ($block -notmatch 'class="event_row"') { continue }

                            # Only rows with YouTube in the watch column
                            if ($block -notmatch '(?i)col_watch') { continue }
                            $watchBlock = [regex]::Match($block, '(?is)col_watch(.*?)col_status')
                            if (-not $watchBlock.Success) { continue }
                            if ($watchBlock.Value -notmatch '(?i)YouTube') { continue }

                            # Date from data-date attribute (already YYYY-MM-DD)
                            $dm = [regex]::Match($block, 'data-date="(\d{4}-\d{2}-\d{2})"')
                            if (-not $dm.Success) { continue }
                            $gameDate = $dm.Groups[1].Value
                            try {
                                $gameDt = [DateTime]::ParseExact($gameDate, 'yyyy-MM-dd', $null)
                                if ($gameDt -lt $todayD -or $gameDt -gt $todayD.AddDays(14)) { continue }
                            } catch { continue }

                            # Team names from img alt attributes
                            $altMx    = [regex]::Matches($block, 'alt="([^"]+)"')
                            $awayTeam = if ($altMx.Count -ge 1) { $altMx[0].Groups[1].Value.Trim() } else { '' }
                            $homeTeam = if ($altMx.Count -ge 2) { $altMx[1].Groups[1].Value.Trim() } else { '' }

                            # Time: e.g. "1:00pm PST" or "7:00pm CST"
                            $tm = [regex]::Match($block, '(\d{1,2}:\d{2}[ap]m)\s*([A-Z]{2,3}T)\b')
                            $timeEt = $null
                            if ($tm.Success) {
                                $timeEt = Convert-BananaToEtTime $tm.Groups[1].Value $tm.Groups[2].Value
                            }
                            if (-not $timeEt) { continue }

                            # Venue from col_stadium, stripping HTML and the @time part
                            $venue = ''
                            $vb = [regex]::Match($block, '(?is)col_stadium.*?<p>(.*?)</p>')
                            if ($vb.Success) {
                                $venue = [regex]::Replace($vb.Groups[1].Value, '<[^>]+>', ' ')
                                $venue = ([regex]::Replace($venue, '\s+', ' ')).Trim()
                                $venue = [regex]::Replace($venue, '\s*@\d.*', '').Trim()
                            }

                            $key = "$gameDate|$($awayTeam.ToLower())|$($homeTeam.ToLower())"
                            if ($seenKeys.ContainsKey($key)) { continue }
                            $seenKeys[$key] = $true

                            $bananaGames += @{ away = $awayTeam; home = $homeTeam; date = $gameDate; time_et = $timeEt; venue = $venue }
                        }

                        $bananaResult = @{ games = $bananaGames; from_cache = $false }
                        $bananaJson   = ConvertTo-Json $bananaResult -Depth 5 -Compress
                        [System.IO.File]::WriteAllText($bananaCacheFile, $bananaJson, [System.Text.Encoding]::UTF8)
                        Write-Host "Bananas: Found $($bananaGames.Count) YouTube games"
                        $bananaBytes = [System.Text.Encoding]::UTF8.GetBytes($bananaJson)
                        $response.ContentLength64 = $bananaBytes.Length
                        $response.OutputStream.Write($bananaBytes, 0, $bananaBytes.Length)
                    } catch {
                        Write-Host "Bananas fetch failed: $($_.Exception.Message)"
                        if (Test-Path $bananaCacheFile) {
                            $staleB = [System.IO.File]::ReadAllBytes($bananaCacheFile)
                            try {
                                $staleObj = ConvertFrom-Json ([System.Text.Encoding]::UTF8.GetString($staleB))
                                $staleObj | Add-Member -MemberType NoteProperty -Name "from_cache" -Value $true -Force
                                $staleObj | Add-Member -MemberType NoteProperty -Name "stale" -Value $true -Force
                                $staleB = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $staleObj -Depth 5 -Compress))
                            } catch {}
                            $response.ContentLength64 = $staleB.Length
                            $response.OutputStream.Write($staleB, 0, $staleB.Length)
                        } else {
                            $errMsg = $_.Exception.Message -replace '"', "'"
                            $eb = [System.Text.Encoding]::UTF8.GetBytes("{`"games`":[],`"error`":`"$errMsg`"}")
                            $response.ContentLength64 = $eb.Length
                            $response.OutputStream.Write($eb, 0, $eb.Length)
                        }
                    }
                }
                $response.Close()
                continue
            }

            # Pitcher roster endpoint (for Electric Starters modal autocomplete)
            if ($localPath -eq 'pitchers.php' -and $context.Request.HttpMethod -eq 'GET') {
                $origin = $context.Request.Headers["Origin"]
                if ($origin -match "http://localhost:8002|http://127.0.0.1:8002|https://mlb.sanvash.com") {
                    $response.AddHeader("Access-Control-Allow-Origin", $origin)
                }
                $response.ContentType = "application/json"

                $pitcherCacheFile = Join-Path $PSScriptRoot "pitchers_cache.json"
                $pitcherCacheValid = $false
                if (Test-Path $pitcherCacheFile) {
                    if ((Get-Date) - (Get-Item $pitcherCacheFile).LastWriteTime -lt (New-TimeSpan -Hours 24)) {
                        $pitcherCacheValid = $true
                    }
                }

                if ($pitcherCacheValid) {
                    $pc = [System.IO.File]::ReadAllBytes($pitcherCacheFile)
                    $response.ContentLength64 = $pc.Length
                    $response.OutputStream.Write($pc, 0, $pc.Length)
                } else {
                    try {
                        $season = (Get-Date).Year
                        $pitcherUrl = "https://statsapi.mlb.com/api/v1/stats?stats=season&group=pitching&season=$season&playerPool=All&limit=600"
                        Write-Host "Fetching pitcher roster for $season..."
                        $pitcherData = Invoke-RestMethod -Uri $pitcherUrl -TimeoutSec 20

                        $seenIds = @{}
                        $pitchers = @()
                        foreach ($s in $pitcherData.stats[0].splits) {
                            $playerId = $s.player.id
                            if ($seenIds.ContainsKey($playerId)) { continue }
                            $seenIds[$playerId] = $true
                            $pitchers += [PSCustomObject]@{
                                id   = $playerId
                                name = $s.player.fullName
                                team = if ($s.team.name) { $s.team.name } else { '' }
                            }
                        }
                        $pitchers = $pitchers | Sort-Object name

                        $pitcherResult = @{ players = @($pitchers) }
                        $pitcherJson   = ConvertTo-Json $pitcherResult -Depth 5 -Compress
                        [System.IO.File]::WriteAllText($pitcherCacheFile, $pitcherJson, [System.Text.Encoding]::UTF8)
                        Write-Host "Pitchers: cached $($pitchers.Count) players"

                        $pitcherBytes = [System.Text.Encoding]::UTF8.GetBytes($pitcherJson)
                        $response.ContentLength64 = $pitcherBytes.Length
                        $response.OutputStream.Write($pitcherBytes, 0, $pitcherBytes.Length)
                    } catch {
                        Write-Host "Pitchers fetch failed: $($_.Exception.Message)"
                        $errMsg = $_.Exception.Message -replace '"', "'"
                        $eb = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"$errMsg`",`"players`":[]}")
                        $response.StatusCode = 502
                        $response.ContentLength64 = $eb.Length
                        $response.OutputStream.Write($eb, 0, $eb.Length)
                    }
                }
                $response.Close()
                continue
            }

            # IP geolocation endpoint
            if ($localPath -eq 'ipinfo.php' -and $context.Request.HttpMethod -eq 'GET') {
                $origin = $context.Request.Headers["Origin"]
                if ($origin -match "http://localhost:8002|http://127.0.0.1:8002|https://mlb.sanvash.com") {
                    $response.AddHeader("Access-Control-Allow-Origin", $origin)
                }
                $response.ContentType = "application/json"

                try {
                    $configFile = Join-Path $PSScriptRoot "config.php"
                    $ipinfoToken = ""
                    if (Test-Path $configFile) {
                        $configContent = Get-Content $configFile -Raw
                        if ($configContent -match "'ipinfo_token'\s*=>\s*'([^']+)'") {
                            $ipinfoToken = $matches[1]
                        }
                    }

                    if (-not $ipinfoToken -or $ipinfoToken -eq 'YOUR_IPINFO_TOKEN_HERE') {
                        $errBytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"ipinfo token not configured in config.php"}')
                        $response.StatusCode = 500
                        $response.ContentLength64 = $errBytes.Length
                        $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
                    } else {
                        $clientIp = $context.Request.RemoteEndPoint.Address.ToString()
                        $ipinfoUrl = if ($clientIp -eq '127.0.0.1' -or $clientIp -eq '::1') {
                            "https://api.ipinfo.io/lite/me"
                        } else {
                            "https://api.ipinfo.io/lite/$clientIp"
                        }
                        Write-Host "Geo lookup: $ipinfoUrl"
                        $geoResp = Invoke-RestMethod -Uri $ipinfoUrl -Headers @{ Authorization = "Bearer $ipinfoToken" } -TimeoutSec 5
                        $geoJson = ConvertTo-Json $geoResp -Compress
                        $geoBytes = [System.Text.Encoding]::UTF8.GetBytes($geoJson)
                        $response.ContentLength64 = $geoBytes.Length
                        $response.OutputStream.Write($geoBytes, 0, $geoBytes.Length)
                        Write-Host "Geo: $($geoResp.country) ($($geoResp.country_code))"
                    }
                } catch {
                    Write-Host "ipinfo fetch failed: $($_.Exception.Message)"
                    $errBytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"geo detection failed"}')
                    $response.StatusCode = 502
                    $response.ContentLength64 = $errBytes.Length
                    $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
                }
                $response.Close()
                continue
            }

            # Unseen teams sheet endpoint
            if ($localPath -eq 'sheet.php' -and $context.Request.HttpMethod -eq 'GET') {
                $origin = $context.Request.Headers["Origin"]
                if ($origin -match "http://localhost:8002|http://127.0.0.1:8002|https://mlb.sanvash.com") {
                    $response.AddHeader("Access-Control-Allow-Origin", $origin)
                }
                $response.ContentType = "application/json"

                try {
                    $configFile = Join-Path $PSScriptRoot "config.php"
                    $sheetId = ""
                    if (Test-Path $configFile) {
                        $configContent = Get-Content $configFile -Raw
                        if ($configContent -match "'sheet_id'\s*=>\s*'([^']+)'") {
                            $sheetId = $matches[1]
                        }
                    }

                    if (-not $sheetId) {
                        $errBytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Sheet ID not configured in config.php"}')
                        $response.StatusCode = 500
                        $response.ContentLength64 = $errBytes.Length
                        $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
                    } else {
                        Write-Host "Fetching Google Sheet..."
                        $sheetUrl = "https://docs.google.com/spreadsheets/d/$sheetId/export?format=csv"
                        $csv = (Invoke-WebRequest -Uri $sheetUrl -UseBasicParsing -TimeoutSec 10 -UserAgent "Mozilla/5.0").Content
                        $lines = $csv -split "`n" | Select-Object -Skip 1
                        $teams = @()
                        foreach ($line in $lines) {
                            $line = $line.Trim()
                            if (-not $line) { continue }
                            $cols = $line -split ','
                            if ($cols.Count -gt 13 -and $cols[13].Trim().Trim('"') -ne '') {
                                $teams += $cols[13].Trim().Trim('"')
                            }
                        }
                        $result = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json @{ teams = $teams } -Compress))
                        $response.ContentLength64 = $result.Length
                        $response.OutputStream.Write($result, 0, $result.Length)
                        Write-Host "Sheet: $($teams.Count) unseen teams"
                    }
                } catch {
                    Write-Host "Sheet fetch failed: $($_.Exception.Message)"
                    $errBytes = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Failed to fetch sheet","teams":[]}')
                    $response.StatusCode = 502
                    $response.ContentLength64 = $errBytes.Length
                    $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
                }
                $response.Close()
                continue
            }

            # Serve index.php by stripping PHP tags and injecting a local CSRF token
            if ($localPath -eq 'index.php') {
                $response.ContentType = "text/html"
                $phpFile = Join-Path $PSScriptRoot "index.php"
                $html = [System.IO.File]::ReadAllText($phpFile, [System.Text.Encoding]::UTF8)
                # Remove the opening <?php ... ?> block
                $html = [regex]::Replace($html, '(?s)<\?php.*?\?>\s*', '')
                # Replace the CSRF echo with a static local token
                $html = $html -replace "<\?=\s*htmlspecialchars\([^)]+\)\s*\?>", 'local-dev-token'
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($html)
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
                $response.Close()
                continue
            }

            $filePath = Join-Path $PSScriptRoot $localPath

            # Block sensitive file extensions
            if ($filePath -match '\.(php|ps1|md|env|gitignore|git|log|json)$' -and $localPath -ne 'al_standings.json' -and $localPath -ne 'schedule.json' -and $localPath -ne 'season_leaders.json') {
                $response.StatusCode = 403
                $response.Close()
                continue
            }

            if (Test-Path $filePath -PathType Leaf) {
                $content = [System.IO.File]::ReadAllBytes($filePath)
                
                if ($filePath -match '\.html$') { $response.ContentType = "text/html"}
                elseif ($filePath -match '\.css$') { $response.ContentType = "text/css"}
                elseif ($filePath -match '\.js$') { $response.ContentType = "application/javascript"}
                
                $response.ContentLength64 = $content.Length
                $response.OutputStream.Write($content, 0, $content.Length)
            } else {
                $response.StatusCode = 404
            }
            $response.Close()
        } catch {
            Write-Host "Request handled but client connection failed or was closed: $($_.Exception.Message)"
            if ($null -ne $response) { try { $response.Close() } catch {} }
        }
    }
} catch {
    Write-Host "Server listener fatal error: $_"
} finally {
    if ($listener.IsListening) {
        $listener.Stop()
    }
}
