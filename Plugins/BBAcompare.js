(function () {
    console.log("BBA Compare version 1.3.0");

    // Helper function to convert hand to PBN format (from PBNcapture.js)
    function hand2PBN(t) {
        var n = replaceSuitSymbols(t, "").split("").reverse().join("");
        var s = n.substring(n.indexOf("S"), n.lastIndexOf("S") + 2).replaceAll(/[SHDC]/g, "");
        var h = n.substring(n.indexOf("H"), n.lastIndexOf("H") + 2).replaceAll(/[SHDC]/g, "");
        var d = n.substring(n.indexOf("D"), n.lastIndexOf("D") + 2).replaceAll(/[SHDC]/g, "");
        var c = n.substring(n.indexOf("C"), n.lastIndexOf("C") + 2).replaceAll(/[SHDC]/g, "");
        return `${s}.${h}.${d}.${c}`;
    }

    // Get dealer seat (from PBNcapture.js)
    function getDealerSeatNr() {
        var d = $(".vulPanelDealerClass", PWD).first();
        if (d.width() == undefined) return -1;
        if (d.width() > d.height()) {
            if (d.position().top == 0) return 0;
            return 2;
        } else {
            if (d.position().left == 0) return 3;
            return 1;
        }
    }

    function getDealerSeat() {
        var ah = $("auction-box-header-cell", PWD).text().replaceAll(" ", "").replaceAll("\n", "");
        var seatNr = getDealerSeatNr();
        if (seatNr < 0) return "";
        // Offset by 3 (equivalent to -1) to correct rotation
        return ah.charAt((seatNr + 3) % 4);
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
            var actualAuction = getContext();
            var boardNumber = getDealNumber();

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
                'Content-Type': 'application/json'
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

        // Create panel
        var panel = document.createElement('div');
        panel.id = 'bba-compare-panel';
        panel.style.cssText = `
            position: fixed;
            top: 100px;
            right: 50px;
            width: 400px;
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
            <strong style="font-size: 16px;">BBA Auction Comparison${boardLabel}</strong>
            <button id="bba-close-btn" style="border:none;background:none;cursor:pointer;font-size:20px;color:#666;">&times;</button>
        `;
        panel.appendChild(header);

        // Summary
        var summary = document.createElement('div');
        summary.style.cssText = `
            padding: 10px;
            margin-bottom: 10px;
            border-radius: 4px;
            text-align: center;
            font-weight: bold;
            background: ${match ? '#d4edda' : '#f8d7da'};
            color: ${match ? '#155724' : '#721c24'};
        `;
        summary.textContent = match ? 'Auctions Match!' : 'Auctions Differ';
        panel.appendChild(summary);

        // Convention info
        if (result.conventions) {
            var convInfo = document.createElement('div');
            convInfo.style.cssText = 'font-size: 12px; color: #666; margin-bottom: 10px;';
            convInfo.textContent = `NS: ${result.conventions.ns} | EW: ${result.conventions.ew}`;
            panel.appendChild(convInfo);
        }

        // Auction table
        var table = document.createElement('table');
        table.style.cssText = 'width: 100%; border-collapse: collapse;';

        // Header row
        var thead = document.createElement('thead');
        thead.innerHTML = `
            <tr style="background: #f0f0f0;">
                <th style="border: 1px solid #ddd; padding: 8px; width: 15%;">#</th>
                <th style="border: 1px solid #ddd; padding: 8px; width: 25%;">Actual</th>
                <th style="border: 1px solid #ddd; padding: 8px; width: 25%;">Expected</th>
                <th style="border: 1px solid #ddd; padding: 8px; width: 35%;">Meaning</th>
            </tr>
        `;
        table.appendChild(thead);

        // Body rows
        var tbody = document.createElement('tbody');
        var maxLen = Math.max(actualBids.length, expectedBids.length);
        var positions = ['N', 'E', 'S', 'W'];
        var dealer = result.actual.length > 0 ? 'S' : 'N'; // Default, could be improved

        for (var i = 0; i < maxLen; i++) {
            var actualBid = actualBids[i] || '-';
            var expectedBid = expectedBids[i] || '-';
            var bidMatch = actualBid === expectedBid;
            var meaning = (result.meanings && result.meanings[i]) ? result.meanings[i].meaning : '';

            var row = document.createElement('tr');
            row.style.cssText = bidMatch ? '' : 'background: #fff3cd;';
            row.innerHTML = `
                <td style="border: 1px solid #ddd; padding: 6px; text-align: center;">${i + 1}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: center; ${!bidMatch ? 'background: #f8d7da; font-weight: bold;' : ''}">${actualBid}</td>
                <td style="border: 1px solid #ddd; padding: 6px; text-align: center; ${!bidMatch ? 'background: #d4edda; font-weight: bold;' : ''}">${expectedBid}</td>
                <td style="border: 1px solid #ddd; padding: 6px; font-size: 12px;">${meaning || ''}</td>
            `;
            tbody.appendChild(row);
        }
        table.appendChild(tbody);
        panel.appendChild(table);

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
