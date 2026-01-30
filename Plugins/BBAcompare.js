(function () {
    var CLIENT_VERSION = "1.9.6";
    console.log("BBA Compare version " + CLIENT_VERSION);

    // Helper function to convert hand to PBN format (from PBNcapture.js)
    function hand2PBN(t) {
        var n = replaceSuitSymbols(t, "").split("").reverse().join("");
        var s = n.substring(n.indexOf("S"), n.lastIndexOf("S") + 2).replaceAll(/[SHDC]/g, "");
        var h = n.substring(n.indexOf("H"), n.lastIndexOf("H") + 2).replaceAll(/[SHDC]/g, "");
        var d = n.substring(n.indexOf("D"), n.lastIndexOf("D") + 2).replaceAll(/[SHDC]/g, "");
        var c = n.substring(n.indexOf("C"), n.lastIndexOf("C") + 2).replaceAll(/[SHDC]/g, "");
        return `${s}.${h}.${d}.${c}`;
    }

    // Get dealer from DOM (vulPanelDealerClass) or fallback to board number
    function getDealerSeat() {
        // Try to get dealer from the vulnerability panel dealer indicator
        // Use jQuery like the rest of BBOAlert does
        var nd = getNavDiv();
        var dealerEl = $('.vulPanelDealerClass', nd).get(0);

        console.log("BBA Compare: Looking for dealer element, navDiv=" + (nd ? "found" : "null") +
                    ", dealerEl=" + (dealerEl ? "found" : "null"));

        if (dealerEl) {
            // The "D" marker position indicates dealer seat
            // Position is set via inline style: top/left values relative to parent
            var style = dealerEl.style;
            var top = parseFloat(style.top) || 0;
            var left = parseFloat(style.left) || 0;
            var parentEl = dealerEl.parentElement;
            var parentHeight = parentEl ? parentEl.offsetHeight : 150;
            var parentWidth = parentEl ? parentEl.offsetWidth : 150;

            // Get computed styles for transform and other properties
            var computedStyle = window.getComputedStyle(dealerEl);
            var transform = computedStyle.transform || 'none';
            var cssText = dealerEl.style.cssText;

            console.log("BBA Compare: Dealer marker - top=" + top + ", left=" + left +
                        ", parent=" + parentWidth + "x" + parentHeight +
                        ", transform=" + transform + ", cssText=" + cssText);

            // Check for transform-based positioning (BBO may use rotation to indicate position)
            var dealer = '';

            // Parse transform matrix to detect rotation
            // matrix(a, b, c, d, tx, ty) where rotation angle = atan2(b, a)
            if (transform && transform !== 'none') {
                var match = transform.match(/matrix\(([^)]+)\)/);
                if (match) {
                    var values = match[1].split(',').map(parseFloat);
                    var angle = Math.round(Math.atan2(values[1], values[0]) * 180 / Math.PI);
                    console.log("BBA Compare: Transform rotation angle = " + angle + " degrees");

                    // Map rotation angle to dealer seat
                    // 0° = default (North?), 90° = East?, 180° = South?, -90°/270° = West?
                    if (angle === 0) dealer = 'N';
                    else if (angle === 90 || angle === -270) dealer = 'E';
                    else if (angle === 180 || angle === -180) dealer = 'S';
                    else if (angle === -90 || angle === 270) dealer = 'W';
                }
            }

            // If transform didn't determine dealer, use position + dimensions
            if (!dealer) {
                // Get element dimensions - the D marker is a bar along one edge
                // N/S: horizontal bars (width > height)
                // E/W: vertical bars (height > width)
                var elWidth = parseFloat(style.width) || dealerEl.offsetWidth || 20;
                var elHeight = parseFloat(style.height) || dealerEl.offsetHeight || 20;
                var isHorizontal = elWidth > elHeight;

                console.log("BBA Compare: Element size - width=" + elWidth + ", height=" + elHeight +
                            ", isHorizontal=" + isHorizontal);

                // Determine dealer from position + orientation
                if (left > 50) {
                    dealer = 'E';  // Right edge, vertical bar
                } else if (top > 50) {
                    dealer = 'S';  // Bottom edge, horizontal bar
                } else if (isHorizontal) {
                    dealer = 'N';  // Top edge, horizontal bar
                } else {
                    dealer = 'W';  // Left edge, vertical bar
                }
            }

            if (dealer) {
                console.log("BBA Compare: Detected dealer from position: " + dealer);
                return dealer;
            }
        } else {
            console.log("BBA Compare: vulPanelDealerClass not found in DOM");
        }

        // Fallback: compute dealer from board number (1=N, 2=E, 3=S, 4=W)
        var boardNum = parseInt(getDealNumber(), 10);
        if (isNaN(boardNum) || boardNum < 1) {
            console.log("BBA Compare: Could not parse board number");
            return "";
        }
        var dealers = ['N', 'E', 'S', 'W'];
        var dealer = dealers[(boardNum - 1) % 4];
        console.log("BBA Compare: Fallback - computed dealer from board=" + boardNum + ": " + dealer);
        return dealer;
    }

    // Convert !S, !H, !D, !C notation to colored suit symbols
    function formatSuitSymbols(text) {
        if (!text) return '';
        return text
            .replace(/!S/gi, '<span style="color: #000;">♠</span>')
            .replace(/!H/gi, '<span style="color: #d00;">♥</span>')
            .replace(/!D/gi, '<span style="color: #d00;">♦</span>')
            .replace(/!C/gi, '<span style="color: #000;">♣</span>');
    }

    // Convert bid text like "1S", "2H" to use colored suit symbols
    function formatBidWithSymbols(bid) {
        if (!bid) return '';
        return bid
            .replace(/S$/, '<span style="color: #000;">♠</span>')
            .replace(/H$/, '<span style="color: #d00;">♥</span>')
            .replace(/D$/, '<span style="color: #d00;">♦</span>')
            .replace(/C$/, '<span style="color: #000;">♣</span>');
    }

    // Get vulnerability in standard format
    function getVulnerability() {
        var vul = areWeVulnerable() + areTheyVulnerable();
        if (vul == "@n@N") return "None";
        if (vul == "@v@N") {
            var ms = mySeat();
            return (ms == 'N' || ms == 'S') ? "NS" : "EW";
        }
        if (vul == "@n@V") {
            var ms = mySeat();
            return (ms == 'N' || ms == 'S') ? "EW" : "NS";
        }
        if (vul == "@v@V") return "Both";
        return "None";
    }

    // Plugin configuration
    var title = "BBA Auction Comparison";
    var cfg = {};
    cfg.Enable_Comparison = false;
    cfg.Show_Panel = true;
    cfg.BBA_Server_URL = "https://bba.harmonicsystems.com";
    cfg.API_Key = "";
    cfg.Scenario_Name = "";
    cfg.Compare_Now = false;

    // Comparison state
    var lastComparisonResult = null;
    var comparisonPanel = null;
    var lastComparedAuction = null;
    var savedPanelPosition = null;  // Remember panel position across updates

    // Convert PBN deal string to BSOL format
    // PBN: "N:AKQ.JT9.876.5432 JT9.AKQ.543.8765 876.543.AKQ.JT98 543.876.JT9.AKQ2"
    // BSOL: "N:AKQ.JT9.876.5432xJT9.AKQ.543.8765x876.543.AKQ.JT98x543.876.JT9.AKQ2"
    function pbnToBsolFormat(pbn) {
        // Replace spaces with 'x' between hands
        return pbn.replace(/ /g, 'x');
    }

    // Convert vulnerability to BSOL format
    function vulToBsolFormat(vul) {
        if (!vul || vul === 'None') return 'None';
        if (vul === 'Both' || vul === 'All') return 'All';
        return vul;  // NS or EW
    }

    // Fetch DD results from BSOL (Bridgewebs DD solver)
    async function fetchDDFromBSOL(pbn, vulnerability) {
        try {
            var dealstr = pbnToBsolFormat(pbn);
            var vul = vulToBsolFormat(vulnerability);
            var url = `https://dds.bridgewebs.com/cgi-bin/bsol2/ddummy?request=m&dealstr=${encodeURIComponent(dealstr)}&vul=${vul}&club=bbacompare`;

            console.log("BBA Compare: Fetching DD from BSOL: " + url);
            var startTime = Date.now();

            var response = await fetch(url);
            if (!response.ok) {
                console.log("BBA Compare: BSOL request failed with status " + response.status);
                return null;
            }

            var text = await response.text();
            var elapsed = ((Date.now() - startTime) / 1000).toFixed(3);
            console.log("BBA Compare: BSOL response received in " + elapsed + " sec");

            return parseBsolResponse(text);
        } catch (e) {
            console.log("BBA Compare: Error fetching DD from BSOL: " + e);
            return null;
        }
    }

    // Parse BSOL response into our DD format
    // BSOL returns JSON: {"sess":{"ddtricks":"99979999793436434364"},...}
    // ddtricks is a 20-char string: 5 chars per declarer (N,S,E,W), each char is tricks for C,D,H,S,NT
    function parseBsolResponse(text) {
        try {
            text = text.trim();

            // Parse as JSON
            var json;
            try {
                json = JSON.parse(text);
            } catch (e) {
                console.log("BBA Compare: BSOL response is not valid JSON: " + text);
                return null;
            }

            // Extract ddtricks from sess object
            if (!json.sess || !json.sess.ddtricks) {
                console.log("BBA Compare: BSOL response missing ddtricks: " + text);
                return null;
            }

            var ddtricks = json.sess.ddtricks;
            console.log("BBA Compare: BSOL ddtricks = " + ddtricks);

            if (ddtricks.length < 20) {
                console.log("BBA Compare: ddtricks too short: " + ddtricks.length);
                return null;
            }

            // Parse tricks character (0-9 = 0-9, a-d = 10-13)
            function parseTricks(char) {
                if (char >= '0' && char <= '9') return parseInt(char);
                if (char >= 'a' && char <= 'd') return 10 + (char.charCodeAt(0) - 'a'.charCodeAt(0));
                if (char >= 'A' && char <= 'D') return 10 + (char.charCodeAt(0) - 'A'.charCodeAt(0));
                return 0;
            }

            // ddtricks format: 20 chars = 4 declarers × 5 denominations
            // Declarer order: N, S, E, W (5 chars each)
            // Suit order within each group: NT, S, H, D, C (reverse of standard ranking)
            var dd = {};
            var declarers = ['N', 'S', 'E', 'W'];
            // Map position in ddtricks to our suit keys
            // Position 0=NT, 1=S, 2=H, 3=D, 4=C
            var suitOrder = ['NT', 'S', 'H', 'D', 'C'];

            for (var i = 0; i < 4; i++) {
                dd[declarers[i]] = {};
                for (var j = 0; j < 5; j++) {
                    dd[declarers[i]][suitOrder[j]] = parseTricks(ddtricks[i * 5 + j]);
                }
            }

            console.log("BBA Compare: Parsed DD results:", JSON.stringify(dd));
            return dd;
        } catch (e) {
            console.log("BBA Compare: Error parsing BSOL response: " + e);
            return null;
        }
    }

    // Parse contract from auction string
    // Returns { declarer: 'N', strain: 'NT', level: 3 } or null if passed out
    function parseContract(auction, dealer) {
        if (!auction || !dealer) return null;

        // Convert auction string to array of calls (each call is 2 chars)
        var calls = [];
        for (var i = 0; i < auction.length; i += 2) {
            calls.push(auction.substring(i, i + 2));
        }

        // Find the last non-pass bid (not --, Db, or Rd)
        var lastBidIdx = -1;
        var lastBid = null;
        for (var i = calls.length - 1; i >= 0; i--) {
            var call = calls[i];
            if (call !== '--' && call !== 'Db' && call !== 'Rd') {
                lastBidIdx = i;
                lastBid = call;
                break;
            }
        }

        if (!lastBid) return null;  // Passed out

        // Parse level and strain from bid (e.g., "3N" -> level=3, strain=NT)
        var level = parseInt(lastBid[0]);
        var strainChar = lastBid[1];
        var strain = strainChar === 'N' ? 'NT' : strainChar;

        // Determine declarer: first player of winning partnership to bid the strain
        var dealerOrder = ['N', 'E', 'S', 'W'];
        var dealerIdx = dealerOrder.indexOf(dealer);
        var bidderIdx = (dealerIdx + lastBidIdx) % 4;
        var bidder = dealerOrder[bidderIdx];

        // Winning partnership
        var isNS = (bidder === 'N' || bidder === 'S');

        // Find first player of that partnership to bid the strain
        var declarer = bidder;
        for (var i = 0; i <= lastBidIdx; i++) {
            var call = calls[i];
            if (call !== '--' && call !== 'Db' && call !== 'Rd') {
                var callStrain = call[1] === 'N' ? 'NT' : call[1];
                if (callStrain === strain) {
                    var callerIdx = (dealerIdx + i) % 4;
                    var caller = dealerOrder[callerIdx];
                    var callerIsNS = (caller === 'N' || caller === 'S');
                    if (callerIsNS === isNS) {
                        declarer = caller;
                        break;
                    }
                }
            }
        }

        return { declarer: declarer, strain: strain, level: level };
    }

    // Render DD table HTML with optional contract highlighting
    // userContract/bbaContract: { declarer: 'N', strain: 'NT', level: 3 } or null
    function renderDDTable(dd, userContract, bbaContract) {
        if (!dd) return '';

        var suitKeys = ['C', 'D', 'H', 'S', 'NT'];
        var seats = ['N', 'S', 'E', 'W'];

        // Colors matching the summary box
        var greenBg = '#d4edda';
        var greenText = '#155724';
        var redBg = '#f8d7da';
        var redText = '#721c24';

        var html = `
            <strong style="display: block; margin-bottom: 5px;">Double-Dummy Analysis:</strong>
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                <thead>
                    <tr style="background: #f0f0f0;">
                        <th style="border: 1px solid #ddd; padding: 4px;"></th>
                        <th style="border: 1px solid #ddd; padding: 4px; color: #000;">♣</th>
                        <th style="border: 1px solid #ddd; padding: 4px; color: #d00;">♦</th>
                        <th style="border: 1px solid #ddd; padding: 4px; color: #d00;">♥</th>
                        <th style="border: 1px solid #ddd; padding: 4px; color: #000;">♠</th>
                        <th style="border: 1px solid #ddd; padding: 4px;">NT</th>
                    </tr>
                </thead>
                <tbody>`;

        for (var i = 0; i < seats.length; i++) {
            var seat = seats[i];
            html += `<tr>
                <td style="border: 1px solid #ddd; padding: 4px; font-weight: bold; text-align: center; background: #f9f9f9;">${seat}</td>`;

            for (var j = 0; j < suitKeys.length; j++) {
                var suitKey = suitKeys[j];
                var tricks = dd[seat] ? dd[seat][suitKey] : '-';
                if (tricks === undefined || tricks === null) tricks = '-';

                // Check if this cell should be highlighted
                var cellStyle = 'border: 1px solid #ddd; padding: 4px; text-align: center;';
                var isUserContract = userContract && userContract.declarer === seat && userContract.strain === suitKey;
                var isBbaContract = bbaContract && bbaContract.declarer === seat && bbaContract.strain === suitKey;

                if (isUserContract && !isBbaContract) {
                    cellStyle += ` background: ${greenBg}; color: ${greenText}; font-weight: bold;`;
                } else if (isBbaContract && !isUserContract) {
                    cellStyle += ` background: ${redBg}; color: ${redText}; font-weight: bold;`;
                } else if (isUserContract && isBbaContract) {
                    // Same contract - show green
                    cellStyle += ` background: ${greenBg}; color: ${greenText}; font-weight: bold;`;
                }

                html += `<td style="${cellStyle}">${tricks}</td>`;
            }
            html += '</tr>';
        }

        html += `</tbody></table>`;
        return html;
    }

    // Check if auction is complete (ends with 3 passes)
    function isAuctionComplete(ctx) {
        return ctx && ctx.length >= 8 && ctx.endsWith('------');
    }

    // Plugin initialization
    addBBOalertEvent("onDataLoad", function () {
        if (addConfigBox(title, cfg) != null) {
            // Manual button trigger via checkbox toggle
            addBBOalertEvent("onAnyMutation", function () {
                if (cfg.Compare_Now) {
                    cfg.Compare_Now = false;
                    compareAuction();
                }
            });

            // Auto-refresh when a new bid is made - check if auction just completed
            addBBOalertEvent("onNewAuction", function () {
                var ctx = getContext();
                var boardNum = getDealNumber();
                var comparisonKey = boardNum + ":" + ctx;  // Include board number to handle same auctions on different boards
                console.log("BBA Compare: onNewAuction fired, ctx=" + ctx + ", board=" + boardNum + ", complete=" + isAuctionComplete(ctx) + ", lastCompared=" + lastComparedAuction);
                if (cfg.Enable_Comparison && cfg.Show_Panel) {
                    if (isAuctionComplete(ctx) && comparisonKey !== lastComparedAuction) {
                        console.log("BBA Compare: Triggering comparison from onNewAuction");
                        lastComparedAuction = comparisonKey;
                        compareAuction();
                    }
                }
            });

            // Also trigger on deal end (when result panel shows)
            addBBOalertEvent("onDealEnd", function () {
                var ctx = getContext();
                var boardNum = getDealNumber();
                var comparisonKey = boardNum + ":" + ctx;  // Include board number to handle same auctions on different boards
                console.log("BBA Compare: onDealEnd fired, ctx=" + ctx + ", board=" + boardNum + ", complete=" + isAuctionComplete(ctx));
                if (cfg.Enable_Comparison && cfg.Show_Panel) {
                    if (isAuctionComplete(ctx) && comparisonKey !== lastComparedAuction) {
                        console.log("BBA Compare: Triggering comparison from onDealEnd");
                        lastComparedAuction = comparisonKey;
                        compareAuction();
                    }
                }
            });
        }
    });

    // Collect deal data from BBO
    function collectDealData() {
        try {
            var hands = {
                N: hand2PBN(getHandBySeat('N')),
                E: hand2PBN(getHandBySeat('E')),
                S: hand2PBN(getHandBySeat('S')),
                W: hand2PBN(getHandBySeat('W'))
            };

            // Check if all hands are available
            if (!hands.N || !hands.E || !hands.S || !hands.W) {
                console.log("BBA Compare: Not all hands visible");
                return null;
            }

            var dealer = getDealerSeat();
            if (!dealer) {
                console.log("BBA Compare: Could not determine dealer");
                return null;
            }

            var vul = getVulnerability();
            var actualAuction = getContext();
            var boardNumber = getDealNumber();
            var viewerSeat = mySeat();

            // Debug logging to diagnose auction alignment issues
            console.log("BBA Compare: actualAuction=" + actualAuction + ", viewer=" + viewerSeat + ", dealer=" + dealer);

            // Build PBN deal string (format: DEALER:dealer's_hand then clockwise)
            // N: N E S W, E: E S W N, S: S W N E, W: W N E S
            var pbn;
            if (dealer === 'N') {
                pbn = `N:${hands.N} ${hands.E} ${hands.S} ${hands.W}`;
            } else if (dealer === 'E') {
                pbn = `E:${hands.E} ${hands.S} ${hands.W} ${hands.N}`;
            } else if (dealer === 'S') {
                pbn = `S:${hands.S} ${hands.W} ${hands.N} ${hands.E}`;
            } else {
                pbn = `W:${hands.W} ${hands.N} ${hands.E} ${hands.S}`;
            }

            return {
                pbn: pbn,
                dealer: dealer,
                vulnerability: vul,
                actualAuction: actualAuction,
                boardNumber: boardNumber
            };
        } catch (e) {
            console.log("BBA Compare: Error collecting deal data: " + e);
            return null;
        }
    }

    // Compare auction with BBA server
    async function compareAuction() {
        if (!cfg.Enable_Comparison) {
            bboalertLog("BBA Comparison is not enabled");
            return;
        }

        bboalertLog("Comparing auction with BBA...");

        var dealData = collectDealData();
        if (!dealData) {
            bboalertLog("Could not collect deal data. All 4 hands must be visible.");
            return;
        }

        var requestBody = {
            deal: {
                pbn: dealData.pbn,
                dealer: dealData.dealer,
                vulnerability: dealData.vulnerability
            }
        };

        // Add scenario if specified (prefer window.currentPBSScenarioFilename set by PBS scenario buttons)
        var scenario = window.currentPBSScenarioFilename || cfg.Scenario_Name;
        if (scenario && scenario.trim()) {
            requestBody.scenario = scenario.trim();
        }

        try {
            var url = cfg.BBA_Server_URL.replace(/\/$/, "") + "/api/auction/generate";
            var headers = {
                'Content-Type': 'application/json',
                'X-Client-Version': CLIENT_VERSION
            };
            if (cfg.API_Key) {
                headers['X-API-Key'] = cfg.API_Key;
            }

            var response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody)
            });

            var result = await response.json();

            if (result.success) {
                lastComparisonResult = {
                    actual: dealData.actualAuction,
                    expected: result.auctionEncoded,
                    expectedBids: result.auction,
                    meanings: result.meanings,
                    conventions: result.conventionsUsed,
                    boardNumber: dealData.boardNumber,
                    dealer: dealData.dealer,
                    pbn: dealData.pbn,
                    vulnerability: dealData.vulnerability
                };
                displayComparison(lastComparisonResult);
            } else {
                bboalertLog("BBA Error: " + (result.error || "Unknown error"));
            }
        } catch (e) {
            bboalertLog("BBA fetch error: " + e.message);
            console.log("BBA Compare fetch error:", e);
        }
    }

    // Convert 2-char auction format to bid array
    function auctionToArray(ctx) {
        var bids = [];
        for (var i = 0; i < ctx.length; i += 2) {
            var bid = ctx.substring(i, i + 2);
            if (bid == "--") bid = "Pass";
            else if (bid == "Db") bid = "X";
            else if (bid == "Rd") bid = "XX";
            else if (bid.charAt(1) == "N") bid = bid.charAt(0) + "NT";
            bids.push(bid);
        }
        return bids;
    }

    // Display comparison results
    function displayComparison(result) {
        // Remove existing panel, saving its position
        if (comparisonPanel) {
            // Save position before removing
            savedPanelPosition = {
                top: comparisonPanel.style.top,
                left: comparisonPanel.style.left,
                right: comparisonPanel.style.right
            };
            comparisonPanel.remove();
            comparisonPanel = null;
        }

        var actualBids = auctionToArray(result.actual);
        var expectedBids = result.expectedBids || auctionToArray(result.expected);

        var match = result.actual === result.expected;

        // Find the first diverging bid
        var firstDivergenceIndex = -1;
        for (var i = 0; i < Math.max(actualBids.length, expectedBids.length); i++) {
            if (actualBids[i] !== expectedBids[i]) {
                firstDivergenceIndex = i;
                break;
            }
        }

        // Create panel
        var panel = document.createElement('div');
        panel.id = 'bba-compare-panel';

        // Use saved position if available, otherwise default
        var posTop = savedPanelPosition ? savedPanelPosition.top : '100px';
        var posLeft = savedPanelPosition ? savedPanelPosition.left : '';
        var posRight = savedPanelPosition && savedPanelPosition.right !== 'auto' ? savedPanelPosition.right : '50px';

        panel.style.cssText = `
            position: fixed;
            top: ${posTop};
            ${posLeft ? 'left: ' + posLeft + ';' : ''}
            ${posLeft ? '' : 'right: ' + posRight + ';'}
            width: 320px;
            max-height: 500px;
            overflow-y: auto;
            background: white;
            border: 2px solid #333;
            border-radius: 8px;
            padding: 15px;
            z-index: 10000;
            font-family: Arial, sans-serif;
            font-size: 14px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;

        // Header with close button
        var header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #ccc;
            padding-bottom: 10px;
            margin-bottom: 10px;
            cursor: move;
        `;
        var boardLabel = result.boardNumber ? ` - Board ${result.boardNumber}` : '';
        header.innerHTML = `
            <strong style="font-size: 16px;">BBA Comparison${boardLabel}</strong>
            <button id="bba-close-btn" style="border:none;background:none;cursor:pointer;font-size:20px;color:#666;">&times;</button>
        `;
        panel.appendChild(header);

        // Summary message
        var summary = document.createElement('div');
        summary.style.cssText = `
            padding: 10px;
            margin-bottom: 10px;
            border-radius: 4px;
            text-align: center;
            background: ${match ? '#d4edda' : '#f8d7da'};
            color: ${match ? '#155724' : '#721c24'};
        `;

        if (match) {
            summary.textContent = 'BBA would have bid the same as you did.';
            panel.appendChild(summary);
        } else {
            var yourBid = actualBids[firstDivergenceIndex] || '-';
            var bbaBid = expectedBids[firstDivergenceIndex] || '-';
            summary.innerHTML = `BBA would have bid <strong>${formatBidWithSymbols(bbaBid)}</strong> instead of <strong>${formatBidWithSymbols(yourBid)}</strong>.`;
            panel.appendChild(summary);

            // Convention info
            if (result.conventions) {
                var convInfo = document.createElement('div');
                convInfo.style.cssText = 'font-size: 12px; color: #666; margin-bottom: 10px; text-align: center;';
                convInfo.textContent = `NS: ${result.conventions.ns} | EW: ${result.conventions.ew}`;
                panel.appendChild(convInfo);
            }

            // Determine dealer position for table layout
            var columnOrder = ['W', 'N', 'E', 'S'];
            var dealer = result.dealer || 'N';  // Use detected dealer from DOM

            // Build auction table (4 columns: W N E S)
            var table = document.createElement('table');
            table.style.cssText = 'width: 100%; border-collapse: collapse; margin-bottom: 10px;';

            // Header row
            var thead = document.createElement('thead');
            thead.innerHTML = `
                <tr style="background: #f0f0f0;">
                    <th style="border: 1px solid #ddd; padding: 8px; width: 25%;">W</th>
                    <th style="border: 1px solid #ddd; padding: 8px; width: 25%;">N</th>
                    <th style="border: 1px solid #ddd; padding: 8px; width: 25%;">E</th>
                    <th style="border: 1px solid #ddd; padding: 8px; width: 25%;">S</th>
                </tr>
            `;
            table.appendChild(thead);

            // Collect alerts for the legend
            var alerts = [];
            var alertIndex = 0;

            // Build bid cells with alerts
            function formatBid(bid, bidIndex, isFirstDivergence) {
                var meaning = '';
                if (result.meanings && result.meanings[bidIndex] && bid !== 'Pass') {
                    meaning = result.meanings[bidIndex].meaning || '';
                }

                var alertSup = '';
                if (meaning) {
                    alertIndex++;
                    alerts.push({ num: alertIndex, bid: bid, meaning: meaning });
                    alertSup = `<sup style="color: #d00; font-size: 10px;">${alertIndex}</sup>`;
                }

                var style = 'padding: 6px; text-align: center; border: 1px solid #ddd;';
                if (isFirstDivergence) {
                    style += ' background: #fff3cd; font-weight: bold; border: 2px solid #ffc107;';
                }

                return `<td style="${style}">${formatBidWithSymbols(bid)}${alertSup}</td>`;
            }

            // Body rows - arrange bids in W N E S columns
            var tbody = document.createElement('tbody');
            var startColumn = columnOrder.indexOf(dealer);

            // Pad with empty cells before dealer
            var paddedBids = [];
            for (var p = 0; p < startColumn; p++) {
                paddedBids.push({ bid: '', index: -1 });
            }
            for (var b = 0; b < expectedBids.length; b++) {
                paddedBids.push({ bid: expectedBids[b], index: b });
            }

            // Create rows
            var row = null;
            for (var i = 0; i < paddedBids.length; i++) {
                if (i % 4 === 0) {
                    if (row) tbody.appendChild(row);
                    row = document.createElement('tr');
                }
                var cellData = paddedBids[i];
                var isFirstDiv = cellData.index === firstDivergenceIndex;
                if (cellData.bid === '') {
                    row.innerHTML += '<td style="padding: 6px; text-align: center; border: 1px solid #ddd;"></td>';
                } else {
                    row.innerHTML += formatBid(cellData.bid, cellData.index, isFirstDiv);
                }
            }
            // Fill remaining cells in last row
            if (row) {
                var remaining = 4 - (paddedBids.length % 4);
                if (remaining < 4) {
                    for (var r = 0; r < remaining; r++) {
                        row.innerHTML += '<td style="padding: 6px; text-align: center; border: 1px solid #ddd;"></td>';
                    }
                }
                tbody.appendChild(row);
            }

            table.appendChild(tbody);
            panel.appendChild(table);

            // Alerts legend
            if (alerts.length > 0) {
                var alertsDiv = document.createElement('div');
                alertsDiv.style.cssText = 'font-size: 12px; border-top: 1px solid #ccc; padding-top: 10px;';
                alertsDiv.innerHTML = '<strong style="display: block; margin-bottom: 5px;">Alerts:</strong>';
                for (var a = 0; a < alerts.length; a++) {
                    var alertItem = document.createElement('div');
                    alertItem.style.cssText = 'margin-bottom: 3px; padding-left: 5px;';
                    alertItem.innerHTML = `<sup style="color: #d00;">${alerts[a].num}</sup> ${formatBidWithSymbols(alerts[a].bid)}: ${formatSuitSymbols(alerts[a].meaning)}`;
                    alertsDiv.appendChild(alertItem);
                }
                panel.appendChild(alertsDiv);
            }
        }

        // Add DD table section
        var ddDiv = document.createElement('div');
        ddDiv.id = 'bba-dd-section';
        ddDiv.style.cssText = 'margin-top: 10px; border-top: 1px solid #ccc; padding-top: 10px;';

        // Show loading state while fetching from BSOL
        ddDiv.innerHTML = `
            <strong style="display: block; margin-bottom: 5px;">Double-Dummy Analysis:</strong>
            <div style="font-size: 12px; color: #666; text-align: center; padding: 10px;">
                Loading DD results...
            </div>
        `;
        panel.appendChild(ddDiv);

        // Parse contracts for highlighting
        var userContract = parseContract(result.actual, result.dealer);
        var bbaContract = parseContract(result.expected, result.dealer);

        // Fetch DD asynchronously from BSOL
        if (result.pbn && result.vulnerability) {
            fetchDDFromBSOL(result.pbn, result.vulnerability).then(function(dd) {
                if (dd) {
                    ddDiv.innerHTML = renderDDTable(dd, userContract, bbaContract);
                } else {
                    ddDiv.innerHTML = `
                        <strong style="display: block; margin-bottom: 5px;">Double-Dummy Analysis:</strong>
                        <div style="font-size: 12px; color: #666; text-align: center; padding: 10px;">
                            DD results unavailable.
                        </div>
                    `;
                }
            });
        } else {
            ddDiv.innerHTML = `
                <strong style="display: block; margin-bottom: 5px;">Double-Dummy Analysis:</strong>
                <div style="font-size: 12px; color: #666; text-align: center; padding: 10px;">
                    DD requires deal data.
                </div>
            `;
        }

        // Add to top-level page (outside iframe) so it's not clipped
        var targetDoc = document;
        var targetBody = document.body;
        try {
            // Try to access top-level document (BBO runs in iframe)
            if (window.top && window.top.document && window.top.document.body) {
                targetDoc = window.top.document;
                targetBody = window.top.document.body;
                console.log("BBA Compare: Attaching panel to top-level document");
            }
        } catch (e) {
            // Cross-origin restriction - fall back to current document
            console.log("BBA Compare: Cannot access top document, using iframe document");
        }

        targetBody.appendChild(panel);
        comparisonPanel = panel;

        // Close button handler - use addEventListener for robustness
        var closeBtn = panel.querySelector('#bba-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                panel.remove();
                comparisonPanel = null;
            });
        }

        // Make draggable (pass target document for event handlers)
        makeDraggable(panel, header, targetDoc);

        bboalertLog(match ? "Auctions match!" : "Auctions differ - see comparison panel");
    }

    // Make element draggable - use addEventListener for robustness
    function makeDraggable(panel, handle, targetDoc) {
        var pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        var doc = targetDoc || document;

        // Use addEventListener instead of direct assignment for better stability
        handle.addEventListener('mousedown', dragMouseDown);

        function dragMouseDown(e) {
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            // Attach to both documents for robustness
            doc.addEventListener('mouseup', closeDragElement);
            doc.addEventListener('mousemove', elementDrag);
            // Also attach to iframe document if different
            if (doc !== document) {
                document.addEventListener('mouseup', closeDragElement);
                document.addEventListener('mousemove', elementDrag);
            }
        }

        function elementDrag(e) {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            panel.style.top = (panel.offsetTop - pos2) + "px";
            panel.style.left = (panel.offsetLeft - pos1) + "px";
            panel.style.right = "auto";
        }

        function closeDragElement() {
            doc.removeEventListener('mouseup', closeDragElement);
            doc.removeEventListener('mousemove', elementDrag);
            if (doc !== document) {
                document.removeEventListener('mouseup', closeDragElement);
                document.removeEventListener('mousemove', elementDrag);
            }
        }
    }
})();
