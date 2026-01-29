(function () {
    var CLIENT_VERSION = "1.7.2";
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

    // Get dealer from board number (standard rotation: 1=N, 2=E, 3=S, 4=W)
    function getDealerSeat() {
        // Compute dealer from board number: 1=N, 2=E, 3=S, 4=W, then repeats
        var boardNum = parseInt(getDealNumber(), 10);
        if (isNaN(boardNum) || boardNum < 1) {
            console.log("BBA Compare: Could not parse board number");
            return "";
        }
        var dealers = ['N', 'E', 'S', 'W'];
        var dealer = dealers[(boardNum - 1) % 4];
        console.log("BBA Compare: board=" + boardNum + ", computed dealer=" + dealer);
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

    // Reorder auction from viewer-seat-first column order to dealer-first order
    // BBO's auction display may order columns starting from viewer's seat (S, W, N, E for South)
    // BBA server returns auction starting from dealer position (W, N, E, S for West dealer)
    function reorderAuctionToDealer(auctionCtx, viewerSeat, dealer) {
        if (!auctionCtx || auctionCtx.length < 2) return auctionCtx;

        var seats = ['W', 'N', 'E', 'S'];
        var viewerIndex = seats.indexOf(viewerSeat);
        var dealerIndex = seats.indexOf(dealer);

        if (viewerIndex < 0 || dealerIndex < 0) {
            console.log("BBA Compare: Invalid seat for reorder, viewer=" + viewerSeat + ", dealer=" + dealer);
            return auctionCtx;
        }

        // If viewer is dealer, no reordering needed
        if (viewerIndex === dealerIndex) return auctionCtx;

        // Convert to array of 2-char bids
        var bids = [];
        for (var i = 0; i < auctionCtx.length; i += 2) {
            bids.push(auctionCtx.substring(i, i + 2));
        }

        // Pad to multiple of 4
        while (bids.length % 4 !== 0) {
            bids.push('--');
        }

        // Reorder each group of 4 bids from viewer-first to dealer-first
        // Input columns are in viewer-first order: viewer, viewer+1, viewer+2, viewer+3
        // Output columns should be dealer-first: dealer, dealer+1, dealer+2, dealer+3
        var reorderedBids = [];
        for (var round = 0; round < bids.length / 4; round++) {
            var roundBids = bids.slice(round * 4, round * 4 + 4);
            var newRound = [];

            for (var outCol = 0; outCol < 4; outCol++) {
                // Which seat should be at output column outCol?
                var targetSeat = (dealerIndex + outCol) % 4;
                // Which input column has that seat? (input columns start from viewer)
                var inCol = (targetSeat - viewerIndex + 4) % 4;
                newRound.push(roundBids[inCol]);
            }
            reorderedBids = reorderedBids.concat(newRound);
        }

        var result = reorderedBids.join('');
        console.log("BBA Compare: Reordered auction from " + viewerSeat + "-first to " + dealer + "-first: " +
                    auctionCtx + " -> " + result);

        return result;
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
                console.log("BBA Compare: onNewAuction fired, ctx=" + ctx + ", complete=" + isAuctionComplete(ctx) + ", lastCompared=" + lastComparedAuction);
                if (cfg.Enable_Comparison && cfg.Show_Panel) {
                    if (isAuctionComplete(ctx) && ctx !== lastComparedAuction) {
                        console.log("BBA Compare: Triggering comparison from onNewAuction");
                        lastComparedAuction = ctx;
                        compareAuction();
                    }
                }
            });

            // Also trigger on deal end (when result panel shows)
            addBBOalertEvent("onDealEnd", function () {
                var ctx = getContext();
                console.log("BBA Compare: onDealEnd fired, ctx=" + ctx + ", complete=" + isAuctionComplete(ctx));
                if (cfg.Enable_Comparison && cfg.Show_Panel) {
                    if (isAuctionComplete(ctx) && ctx !== lastComparedAuction) {
                        console.log("BBA Compare: Triggering comparison from onDealEnd");
                        lastComparedAuction = ctx;
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
            var rawAuction = getContext();
            var boardNumber = getDealNumber();

            // Reorder auction from viewer-seat-first to dealer-first
            // This is needed because BBO's DOM may order auction cells starting from viewer's seat
            var viewerSeat = mySeat();
            var actualAuction = reorderAuctionToDealer(rawAuction, viewerSeat, dealer);
            console.log("BBA Compare: Raw auction=" + rawAuction + ", viewer=" + viewerSeat +
                        ", dealer=" + dealer + ", reordered=" + actualAuction);

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

        // Add scenario if specified
        if (cfg.Scenario_Name && cfg.Scenario_Name.trim()) {
            requestBody.scenario = cfg.Scenario_Name.trim();
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
                    boardNumber: dealData.boardNumber
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
        // Remove existing panel
        if (comparisonPanel) {
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
        panel.style.cssText = `
            position: fixed;
            top: 100px;
            right: 50px;
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
            var boardNum = parseInt(result.boardNumber, 10) || 1;
            var dealerPositions = ['W', 'N', 'E', 'S'];  // Column order
            var dealerIndex = ['N', 'E', 'S', 'W'].indexOf(['N', 'E', 'S', 'W'][(boardNum - 1) % 4]);
            var columnOrder = ['W', 'N', 'E', 'S'];
            var dealerColumn = columnOrder.indexOf(['N', 'E', 'S', 'W'][(boardNum - 1) % 4]);

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
            var dealer = ['N', 'E', 'S', 'W'][(boardNum - 1) % 4];
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

        // Add to page
        document.body.appendChild(panel);
        comparisonPanel = panel;

        // Close button handler
        document.getElementById('bba-close-btn').onclick = function() {
            panel.remove();
            comparisonPanel = null;
        };

        // Make draggable
        makeDraggable(panel, header);

        bboalertLog(match ? "Auctions match!" : "Auctions differ - see comparison panel");
    }

    // Make element draggable
    function makeDraggable(panel, handle) {
        var pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

        handle.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
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
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }
})();
