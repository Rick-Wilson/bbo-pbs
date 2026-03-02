(function () {
    // Prevent multiple instances from running - check both current window and top window
    // BBOalert may inject scripts into multiple contexts (main window + iframe)
    var alreadyInit = window.bbaCompareInitialized;
    try {
        if (!alreadyInit && window.top && window.top !== window) {
            alreadyInit = window.top.bbaCompareInitialized;
        }
    } catch (e) {
        // Cross-origin restriction - ignore
    }

    if (alreadyInit) {
        console.log("BBA Compare: Already initialized, skipping duplicate load");
        return;
    }

    // Mark as initialized in both contexts
    window.bbaCompareInitialized = true;
    try {
        if (window.top && window.top !== window) {
            window.top.bbaCompareInitialized = true;
        }
    } catch (e) {
        // Cross-origin - ignore
    }

    var CLIENT_VERSION = "1.9.19";
    console.log("BBA Compare version " + CLIENT_VERSION);

    // Panel element references
    var panel = null;
    var panelContent = null;
    var panelHeader = null;
    var panelTitleEl = null;

    // Clean up any orphaned panels from previous iframe loads IMMEDIATELY on script load
    (function cleanupOrphanedPanels() {
        var panelId = 'bba-compare-panel';
        try {
            var p = document.getElementById(panelId);
            if (p) {
                p.remove();
                console.log("BBA Compare: Cleaned up orphaned panel from iframe document on init");
            }
            if (window.top && window.top.document) {
                var topPanel = window.top.document.getElementById(panelId);
                if (topPanel) {
                    topPanel.remove();
                    console.log("BBA Compare: Cleaned up orphaned panel from top-level document on init");
                }
            }
        } catch (e) {
            // Cross-origin restriction - ignore
        }
    })();

    // Global enable flag - controlled by Auction Compare button (start) and panel close (stop)
    window.bbaCompareEnabled = false;

    // Start function called by the Auction Compare button
    window.startBBACompare = function() {
        window.bbaCompareEnabled = true;
        console.log("BBA Compare: Enabled via Auction Compare button");

        var ctx = getContext();
        if (isAuctionComplete(ctx)) {
            compareAuction();
        } else {
            showWaitingContent();
        }
        return window.bbaCompareEnabled;
    };

    // Helper function to convert hand to PBN format
    function hand2PBN(t) {
        var n = replaceSuitSymbols(t, "").split("").reverse().join("");
        var s = n.substring(n.indexOf("S"), n.lastIndexOf("S") + 2).replaceAll(/[SHDC]/g, "");
        var h = n.substring(n.indexOf("H"), n.lastIndexOf("H") + 2).replaceAll(/[SHDC]/g, "");
        var d = n.substring(n.indexOf("D"), n.lastIndexOf("D") + 2).replaceAll(/[SHDC]/g, "");
        var c = n.substring(n.indexOf("C"), n.lastIndexOf("C") + 2).replaceAll(/[SHDC]/g, "");
        return `${s}.${h}.${d}.${c}`;
    }

    // Get dealer from DOM or fallback to board number
    function getDealerSeat() {
        var nd = getNavDiv();
        var dealerEl = $('.vulPanelDealerClass', nd).get(0);

        if (dealerEl) {
            var style = dealerEl.style;
            var top = parseFloat(style.top) || 0;
            var left = parseFloat(style.left) || 0;
            var computedStyle = window.getComputedStyle(dealerEl);
            var transform = computedStyle.transform || 'none';
            var dealer = '';

            if (transform && transform !== 'none') {
                var match = transform.match(/matrix\(([^)]+)\)/);
                if (match) {
                    var values = match[1].split(',').map(parseFloat);
                    var angle = Math.round(Math.atan2(values[1], values[0]) * 180 / Math.PI);
                    if (angle === 0) dealer = 'N';
                    else if (angle === 90 || angle === -270) dealer = 'E';
                    else if (angle === 180 || angle === -180) dealer = 'S';
                    else if (angle === -90 || angle === 270) dealer = 'W';
                }
            }

            if (!dealer) {
                var elWidth = parseFloat(style.width) || dealerEl.offsetWidth || 20;
                var elHeight = parseFloat(style.height) || dealerEl.offsetHeight || 20;
                var isHorizontal = elWidth > elHeight;

                if (left > 50) dealer = 'E';
                else if (top > 50) dealer = 'S';
                else if (isHorizontal) dealer = 'N';
                else dealer = 'W';
            }

            if (dealer) return dealer;
        }

        var boardNum = parseInt(getDealNumber(), 10);
        if (isNaN(boardNum) || boardNum < 1) return "";
        var dealers = ['N', 'E', 'S', 'W'];
        return dealers[(boardNum - 1) % 4];
    }

    function formatSuitSymbols(text) {
        if (!text) return '';
        return text
            .replace(/!S/gi, '<span style="color: #000;">♠</span>')
            .replace(/!H/gi, '<span style="color: #d00;">♥</span>')
            .replace(/!D/gi, '<span style="color: #d00;">♦</span>')
            .replace(/!C/gi, '<span style="color: #000;">♣</span>');
    }

    function formatBidWithSymbols(bid) {
        if (!bid) return '';
        return bid
            .replace(/S$/, '<span style="color: #000;">♠</span>')
            .replace(/H$/, '<span style="color: #d00;">♥</span>')
            .replace(/D$/, '<span style="color: #d00;">♦</span>')
            .replace(/C$/, '<span style="color: #000;">♣</span>');
    }

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
    cfg.BBA_Server_URL = "https://bba.harmonicsystems.com";
    cfg.API_Key = "";
    cfg.Scenario_Name = "";

    // Comparison state
    var lastComparisonResult = null;
    var lastComparedAuction = null;

    function pbnToBsolFormat(pbn) {
        return pbn.replace(/ /g, 'x');
    }

    function vulToBsolFormat(vul) {
        if (!vul || vul === 'None') return 'None';
        if (vul === 'Both' || vul === 'All') return 'All';
        return vul;
    }

    async function fetchDDFromBSOL(pbn, vulnerability) {
        try {
            var dealstr = pbnToBsolFormat(pbn);
            var vul = vulToBsolFormat(vulnerability);
            var url = `https://dds.bridgewebs.com/cgi-bin/bsol2/ddummy?request=m&dealstr=${encodeURIComponent(dealstr)}&vul=${vul}&club=bbacompare`;

            var response = await fetch(url);
            if (!response.ok) return null;

            var text = await response.text();
            return parseBsolResponse(text);
        } catch (e) {
            console.log("BBA Compare: Error fetching DD from BSOL: " + e);
            return null;
        }
    }

    function parseBsolResponse(text) {
        try {
            var json = JSON.parse(text.trim());
            if (!json.sess || !json.sess.ddtricks) return null;

            var ddtricks = json.sess.ddtricks;
            if (ddtricks.length < 20) return null;

            function parseTricks(char) {
                if (char >= '0' && char <= '9') return parseInt(char);
                if (char >= 'a' && char <= 'd') return 10 + (char.charCodeAt(0) - 'a'.charCodeAt(0));
                if (char >= 'A' && char <= 'D') return 10 + (char.charCodeAt(0) - 'A'.charCodeAt(0));
                return 0;
            }

            var dd = {};
            var declarers = ['N', 'S', 'E', 'W'];
            var suitOrder = ['NT', 'S', 'H', 'D', 'C'];

            for (var i = 0; i < 4; i++) {
                dd[declarers[i]] = {};
                for (var j = 0; j < 5; j++) {
                    dd[declarers[i]][suitOrder[j]] = parseTricks(ddtricks[i * 5 + j]);
                }
            }
            return dd;
        } catch (e) {
            return null;
        }
    }

    function parseContract(auction, dealer) {
        if (!auction || !dealer) return null;

        var calls = [];
        for (var i = 0; i < auction.length; i += 2) {
            calls.push(auction.substring(i, i + 2));
        }

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

        if (!lastBid) return null;

        var level = parseInt(lastBid[0]);
        var strainChar = lastBid[1];
        var strain = strainChar === 'N' ? 'NT' : strainChar;

        var dealerOrder = ['N', 'E', 'S', 'W'];
        var dealerIdx = dealerOrder.indexOf(dealer);
        var bidderIdx = (dealerIdx + lastBidIdx) % 4;
        var bidder = dealerOrder[bidderIdx];
        var isNS = (bidder === 'N' || bidder === 'S');

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

    function renderDDTable(dd, userContract, bbaContract) {
        if (!dd) return '';

        var suitKeys = ['C', 'D', 'H', 'S', 'NT'];
        var seats = ['N', 'S', 'E', 'W'];
        var greenBg = '#d4edda', greenText = '#155724';
        var redBg = '#f8d7da', redText = '#721c24';

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
            html += `<tr><td style="border: 1px solid #ddd; padding: 4px; font-weight: bold; text-align: center; background: #f9f9f9;">${seat}</td>`;

            for (var j = 0; j < suitKeys.length; j++) {
                var suitKey = suitKeys[j];
                var tricks = dd[seat] ? dd[seat][suitKey] : '-';
                if (tricks === undefined || tricks === null) tricks = '-';

                var cellStyle = 'border: 1px solid #ddd; padding: 4px; text-align: center;';
                var isUserContract = userContract && userContract.declarer === seat && userContract.strain === suitKey;
                var isBbaContract = bbaContract && bbaContract.declarer === seat && bbaContract.strain === suitKey;

                if (isUserContract && isBbaContract) {
                    cellStyle += ` background: ${greenBg}; color: ${greenText}; font-weight: bold;`;
                } else if (isUserContract) {
                    cellStyle += ` background: ${greenBg}; color: ${greenText}; font-weight: bold;`;
                } else if (isBbaContract) {
                    cellStyle += ` background: ${redBg}; color: ${redText}; font-weight: bold;`;
                }

                html += `<td style="${cellStyle}">${tricks}</td>`;
            }
            html += '</tr>';
        }

        html += `</tbody></table>`;
        return html;
    }

    function isAuctionComplete(ctx) {
        return ctx && ctx.length >= 8 && ctx.endsWith('------');
    }

    // Plugin initialization
    addBBOalertEvent("onDataLoad", function () {
        addConfigBox(title, cfg);

        addBBOalertEvent("onNewAuction", function () {
            var ctx = getContext();
            var boardNum = getDealNumber();
            var comparisonKey = boardNum + ":" + ctx;
            if (window.bbaCompareEnabled) {
                if (isAuctionComplete(ctx) && comparisonKey !== lastComparedAuction) {
                    console.log("BBA Compare: Triggering comparison from onNewAuction");
                    lastComparedAuction = comparisonKey;
                    compareAuction();
                }
            }
        });

        addBBOalertEvent("onDealEnd", function () {
            var ctx = getContext();
            var boardNum = getDealNumber();
            var comparisonKey = boardNum + ":" + ctx;
            if (window.bbaCompareEnabled) {
                if (isAuctionComplete(ctx) && comparisonKey !== lastComparedAuction) {
                    console.log("BBA Compare: Triggering comparison from onDealEnd");
                    lastComparedAuction = comparisonKey;
                    compareAuction();
                }
            }
        });

        // Close panel on logout to prevent orphaned panels
        addBBOalertEvent("onLogoff", function () {
            console.log("BBA Compare: onLogoff event fired");
            closePanel();
        });

        // Also close panel when leaving table
        addBBOalertEvent("onTableHidden", function () {
            console.log("BBA Compare: onTableHidden event fired");
            closePanel();
        });

        // Additional cleanup: watch for BBO navigation away from table
        // The auction box being hidden often indicates we're leaving the table context
        addBBOalertEvent("onAuctionBoxHidden", function () {
            console.log("BBA Compare: onAuctionBoxHidden event fired");
            // Don't close immediately - auction box hides between boards
            // Only close if we're still enabled but no longer at a table
        });
    });

    // Catch iframe unload - this fires when BBO destroys the iframe during logout
    // This is more reliable than onLogoff which depends on the MutationObserver
    window.addEventListener('unload', function() {
        console.log("BBA Compare: Iframe window unload");
        // Clear initialization flags to allow re-init after legitimate page reload
        window.bbaCompareInitialized = false;
        try {
            if (window.top) {
                window.top.bbaCompareInitialized = false;
            }
        } catch (e) {
            // Cross-origin - ignore
        }
        // Use direct DOM manipulation since our references may already be invalid
        try {
            var p = document.getElementById('bba-compare-panel');
            if (p) p.remove();
            if (window.top && window.top.document) {
                var tp = window.top.document.getElementById('bba-compare-panel');
                if (tp) tp.remove();
            }
        } catch (e) {
            // Ignore errors during unload
        }
    });

    // Also try to catch page unload in the top-level document
    try {
        if (window.top && window.top !== window) {
            window.top.addEventListener('beforeunload', function() {
                console.log("BBA Compare: Top window beforeunload");
                closePanel();
            });
        }
    } catch (e) {
        // Cross-origin - ignore
    }

    function collectDealData() {
        try {
            var hands = {
                N: hand2PBN(getHandBySeat('N')),
                E: hand2PBN(getHandBySeat('E')),
                S: hand2PBN(getHandBySeat('S')),
                W: hand2PBN(getHandBySeat('W'))
            };

            if (!hands.N || !hands.E || !hands.S || !hands.W) return null;

            var dealer = getDealerSeat();
            if (!dealer) return null;

            var vul = getVulnerability();
            var actualAuction = getContext();
            var boardNumber = getDealNumber();

            var pbn;
            if (dealer === 'N') pbn = `N:${hands.N} ${hands.E} ${hands.S} ${hands.W}`;
            else if (dealer === 'E') pbn = `E:${hands.E} ${hands.S} ${hands.W} ${hands.N}`;
            else if (dealer === 'S') pbn = `S:${hands.S} ${hands.W} ${hands.N} ${hands.E}`;
            else pbn = `W:${hands.W} ${hands.N} ${hands.E} ${hands.S}`;

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

    async function compareAuction() {
        if (!window.bbaCompareEnabled) return;

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

        var scenario = window.currentPBSScenarioFilename || cfg.Scenario_Name;
        if (scenario && scenario.trim()) {
            requestBody.scenario = scenario.trim();
        }

        var conventions = {};
        if (window.currentPBSConventionCardNS) conventions.ns = window.currentPBSConventionCardNS;
        if (window.currentPBSConventionCardEW) conventions.ew = window.currentPBSConventionCardEW;
        if (Object.keys(conventions).length > 0) {
            requestBody.conventions = conventions;
        }

        try {
            var url = cfg.BBA_Server_URL.replace(/\/$/, "") + "/api/auction/generate";
            var headers = {
                'Content-Type': 'application/json',
                'X-Client-Version': CLIENT_VERSION
            };
            if (cfg.API_Key) headers['X-API-Key'] = cfg.API_Key;

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
                showComparisonContent(lastComparisonResult);
            } else {
                bboalertLog("BBA Error: " + (result.error || "Unknown error"));
            }
        } catch (e) {
            bboalertLog("BBA fetch error: " + e.message);
            console.log("BBA Compare fetch error:", e);
        }
    }

    // Get or create the target document for the panel
    function getTargetDocument() {
        try {
            if (window.top && window.top.document && window.top.document.body) {
                return { doc: window.top.document, body: window.top.document.body };
            }
        } catch (e) {}
        return { doc: document, body: document.body };
    }

    // Ensure panel exists, create if needed. Returns the content div.
    function ensurePanel() {
        // Check if panel still exists in DOM
        if (panel && panel.parentNode) {
            return panelContent;
        }

        // Also check by ID in case reference is stale
        var target = getTargetDocument();
        var existingPanel = target.doc.getElementById('bba-compare-panel');
        if (existingPanel) {
            panel = existingPanel;
            panelContent = panel.querySelector('#bba-panel-content');
            panelHeader = panel.querySelector('#bba-panel-header');
            panelTitleEl = panel.querySelector('#bba-panel-title');
            if (panelContent) return panelContent;
            // Panel exists but is malformed, remove it
            existingPanel.remove();
        }

        // Create new panel
        panel = document.createElement('div');
        panel.id = 'bba-compare-panel';
        panel.style.cssText = `
            position: fixed;
            top: 100px;
            right: 50px;
            width: 320px;
            height: 400px;
            min-height: 150px;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
            background: white;
            border: 2px solid #333;
            border-radius: 8px;
            padding: 15px;
            padding-bottom: 5px;
            z-index: 10000;
            font-family: Arial, sans-serif;
            font-size: 14px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;

        // Header (persistent)
        panelHeader = document.createElement('div');
        panelHeader.id = 'bba-panel-header';
        panelHeader.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #ccc;
            padding-bottom: 10px;
            margin-bottom: 10px;
            cursor: move;
        `;

        panelTitleEl = document.createElement('strong');
        panelTitleEl.id = 'bba-panel-title';
        panelTitleEl.style.fontSize = '16px';
        panelTitleEl.textContent = 'BBA Comparison';

        var closeBtn = document.createElement('button');
        closeBtn.id = 'bba-close-btn';
        closeBtn.style.cssText = 'border:none;background:none;cursor:pointer;font-size:20px;color:#666;';
        closeBtn.innerHTML = '&times;';
        closeBtn.addEventListener('click', function() {
            closePanel();
        });

        panelHeader.appendChild(panelTitleEl);
        panelHeader.appendChild(closeBtn);
        panel.appendChild(panelHeader);

        // Content area (gets updated)
        panelContent = document.createElement('div');
        panelContent.id = 'bba-panel-content';
        panelContent.style.cssText = `
            flex: 1;
            overflow-y: auto;
            min-height: 0;
        `;
        panel.appendChild(panelContent);

        // Resize handle at bottom
        var resizeHandle = document.createElement('div');
        resizeHandle.id = 'bba-resize-handle';
        resizeHandle.style.cssText = `
            height: 12px;
            cursor: ns-resize;
            display: flex;
            justify-content: center;
            align-items: center;
            margin-top: 5px;
            border-top: 1px solid #ddd;
        `;
        resizeHandle.innerHTML = '<div style="width: 40px; height: 4px; background: #ccc; border-radius: 2px;"></div>';
        panel.appendChild(resizeHandle);

        // Add to document
        target.body.appendChild(panel);

        // Make draggable and resizable
        makeDraggable(panel, panelHeader, target.doc);
        makeResizable(panel, resizeHandle, target.doc);

        console.log("BBA Compare: Created panel");
        return panelContent;
    }

    // Close and remove the panel
    function closePanel() {
        console.log("BBA Compare: closePanel() called");
        var removed = false;

        if (panel && panel.parentNode) {
            panel.remove();
            removed = true;
            console.log("BBA Compare: Removed panel via reference");
        }

        // Also clean up by ID (belt and suspenders)
        try {
            var p = document.getElementById('bba-compare-panel');
            if (p) {
                p.remove();
                removed = true;
                console.log("BBA Compare: Removed panel from iframe document by ID");
            }
            if (window.top && window.top.document) {
                var tp = window.top.document.getElementById('bba-compare-panel');
                if (tp) {
                    tp.remove();
                    removed = true;
                    console.log("BBA Compare: Removed panel from top-level document by ID");
                }
            }
        } catch (e) {
            console.log("BBA Compare: Error during cleanup: " + e);
        }

        panel = null;
        panelContent = null;
        panelHeader = null;
        panelTitleEl = null;
        window.bbaCompareEnabled = false;

        if (removed) {
            console.log("BBA Compare: Panel closed successfully");
        } else {
            console.log("BBA Compare: No panel found to close");
        }
    }

    // Show waiting content in the panel
    function showWaitingContent() {
        var content = ensurePanel();
        if (panelTitleEl) panelTitleEl.textContent = 'BBA Comparison';

        content.innerHTML = `
            <div style="padding: 20px; text-align: center; color: #666;">
                <div style="font-size: 24px; margin-bottom: 10px;">⏳</div>
                <div>Waiting for auction to complete...</div>
                <div style="font-size: 12px; margin-top: 10px; color: #999;">
                    Comparison will appear automatically when bidding ends.
                </div>
            </div>
        `;
        console.log("BBA Compare: Showing waiting content");
    }

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

    // Show comparison content in the panel
    function showComparisonContent(result) {
        var content = ensurePanel();

        var boardLabel = result.boardNumber ? ` - Board ${result.boardNumber}` : '';
        if (panelTitleEl) panelTitleEl.textContent = 'BBA Comparison' + boardLabel;

        var actualBids = auctionToArray(result.actual);
        var expectedBids = result.expectedBids || auctionToArray(result.expected);
        var match = result.actual === result.expected;

        var firstDivergenceIndex = -1;
        for (var i = 0; i < Math.max(actualBids.length, expectedBids.length); i++) {
            if (actualBids[i] !== expectedBids[i]) {
                firstDivergenceIndex = i;
                break;
            }
        }

        var html = '';

        // Summary message
        if (match) {
            html += `<div style="padding: 10px; margin-bottom: 10px; border-radius: 4px; text-align: center; background: #d4edda; color: #155724;">
                BBA would have bid the same as you did.
            </div>`;
        } else {
            var yourBid = actualBids[firstDivergenceIndex] || '-';
            var bbaBid = expectedBids[firstDivergenceIndex] || '-';
            html += `<div style="padding: 10px; margin-bottom: 10px; border-radius: 4px; text-align: center; background: #f8d7da; color: #721c24;">
                BBA would have bid <strong>${formatBidWithSymbols(bbaBid)}</strong> instead of <strong>${formatBidWithSymbols(yourBid)}</strong>.
            </div>`;

            // Convention info
            if (result.conventions) {
                html += `<div style="font-size: 12px; color: #666; margin-bottom: 10px; text-align: center;">
                    NS: ${result.conventions.ns} | EW: ${result.conventions.ew}
                </div>`;
            }

            // Auction table
            var columnOrder = ['W', 'N', 'E', 'S'];
            var dealer = result.dealer || 'N';
            var startColumn = columnOrder.indexOf(dealer);

            var alerts = [];
            var alertIndex = 0;

            html += `<table style="width: 100%; border-collapse: collapse; margin-bottom: 10px;">
                <thead>
                    <tr style="background: #f0f0f0;">
                        <th style="border: 1px solid #ddd; padding: 8px; width: 25%;">W</th>
                        <th style="border: 1px solid #ddd; padding: 8px; width: 25%;">N</th>
                        <th style="border: 1px solid #ddd; padding: 8px; width: 25%;">E</th>
                        <th style="border: 1px solid #ddd; padding: 8px; width: 25%;">S</th>
                    </tr>
                </thead>
                <tbody>`;

            var paddedBids = [];
            for (var p = 0; p < startColumn; p++) {
                paddedBids.push({ bid: '', index: -1 });
            }
            for (var b = 0; b < expectedBids.length; b++) {
                paddedBids.push({ bid: expectedBids[b], index: b });
            }

            for (var i = 0; i < paddedBids.length; i += 4) {
                html += '<tr>';
                for (var j = 0; j < 4; j++) {
                    var cellData = paddedBids[i + j];
                    if (!cellData || cellData.bid === '') {
                        html += '<td style="padding: 6px; text-align: center; border: 1px solid #ddd;"></td>';
                    } else {
                        var bid = cellData.bid;
                        var bidIndex = cellData.index;
                        var isFirstDiv = bidIndex === firstDivergenceIndex;

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
                        if (isFirstDiv) {
                            style += ' background: #fff3cd; font-weight: bold; border: 2px solid #ffc107;';
                        }

                        html += `<td style="${style}">${formatBidWithSymbols(bid)}${alertSup}</td>`;
                    }
                }
                html += '</tr>';
            }

            html += '</tbody></table>';

            // Alerts legend
            if (alerts.length > 0) {
                html += '<div style="font-size: 12px; border-top: 1px solid #ccc; padding-top: 10px;">';
                html += '<strong style="display: block; margin-bottom: 5px;">Alerts:</strong>';
                for (var a = 0; a < alerts.length; a++) {
                    html += `<div style="margin-bottom: 3px; padding-left: 5px;">
                        <sup style="color: #d00;">${alerts[a].num}</sup> ${formatBidWithSymbols(alerts[a].bid)}: ${formatSuitSymbols(alerts[a].meaning)}
                    </div>`;
                }
                html += '</div>';
            }
        }

        // DD section
        html += `<div id="bba-dd-section" style="margin-top: 10px; border-top: 1px solid #ccc; padding-top: 10px;">
            <strong style="display: block; margin-bottom: 5px;">Double-Dummy Analysis:</strong>
            <div style="font-size: 12px; color: #666; text-align: center; padding: 10px;">
                Loading DD results...
            </div>
        </div>`;

        content.innerHTML = html;

        // Fetch DD asynchronously
        if (result.pbn && result.vulnerability) {
            var userContract = parseContract(result.actual, result.dealer);
            var bbaContract = parseContract(result.expected, result.dealer);

            fetchDDFromBSOL(result.pbn, result.vulnerability).then(function(dd) {
                var ddDiv = content.querySelector('#bba-dd-section');
                if (ddDiv) {
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
                }
            });
        }

        bboalertLog(match ? "Auctions match!" : "Auctions differ - see comparison panel");
        console.log("BBA Compare: Showing comparison content");
    }

    // Make element draggable
    function makeDraggable(panel, handle, targetDoc) {
        var pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        var doc = targetDoc || document;

        handle.addEventListener('mousedown', dragMouseDown);

        function dragMouseDown(e) {
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            doc.addEventListener('mouseup', closeDragElement);
            doc.addEventListener('mousemove', elementDrag);
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

    // Make element vertically resizable
    function makeResizable(panel, handle, targetDoc) {
        var startY = 0, startHeight = 0;
        var doc = targetDoc || document;

        handle.addEventListener('mousedown', resizeMouseDown);

        function resizeMouseDown(e) {
            e.preventDefault();
            e.stopPropagation();
            startY = e.clientY;
            startHeight = panel.offsetHeight;
            doc.addEventListener('mouseup', closeResizeElement);
            doc.addEventListener('mousemove', elementResize);
            if (doc !== document) {
                document.addEventListener('mouseup', closeResizeElement);
                document.addEventListener('mousemove', elementResize);
            }
        }

        function elementResize(e) {
            e.preventDefault();
            var newHeight = startHeight + (e.clientY - startY);
            // Enforce min/max constraints
            var minHeight = 150;
            var maxHeight = window.innerHeight * 0.8;
            newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
            panel.style.height = newHeight + "px";
        }

        function closeResizeElement() {
            doc.removeEventListener('mouseup', closeResizeElement);
            doc.removeEventListener('mousemove', elementResize);
            if (doc !== document) {
                document.removeEventListener('mouseup', closeResizeElement);
                document.removeEventListener('mousemove', elementResize);
            }
        }
    }
})();
