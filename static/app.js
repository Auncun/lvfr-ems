const $ = s => document.querySelector(s);

let config = {};
try {
    const cachedConfig = JSON.parse(sessionStorage.getItem("lvfr.config.v1") || "null");
    if (cachedConfig && Array.isArray(cachedConfig.ranks)) config = cachedConfig;
} catch {}
// Keep brief deduplication for rapid repeat reads while allowing polling to
// pick up a change from another client without waiting on a stale browser copy.
const API_READ_CACHE_MS = 5000;
const apiReadCache = new Map();
const BACKGROUND_PENDING_MESSAGE = "BACKGROUND_SAVE_PENDING";

// Backends and cached responses may wrap collection payloads differently.
// Normalize known member-list envelopes before the roster UI treats them as rows.
function memberRowsFromResponse(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.members)) return value.members;
    if (Array.isArray(value?.data)) return value.data;
    if (Array.isArray(value?.data?.members)) return value.data.members;
    if (Array.isArray(value?.result)) return value.result;
    if (Array.isArray(value?.result?.members)) return value.result.members;
    return null;
}


// ============================================================
// API
// ============================================================

async function api(url, options = {}) {
    if (isBackgroundMutationRequest(url, options)) return startBackgroundMutation(url, options);
    const method = String(options.method || "GET").toUpperCase();
    const cacheableRead = method === "GET" && new URL(url, location.href).pathname.startsWith("/api/");
    if (cacheableRead) {
        const cached = apiReadCache.get(url);
        if (cached && Date.now() - cached.savedAt < API_READ_CACHE_MS) {
            try { return JSON.parse(cached.body); } catch { apiReadCache.delete(url); }
        }
    } else if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        apiReadCache.clear();
    }
    const r = await fetch(url, {
        ...options,

        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    if (r.status === 401) {
        location.assign("/login");
        throw new Error("Your session expired. Please sign in again.");
    }

    const d = await r.json().catch(
        () => ({ detail: "Invalid server response" })
    );

    if (!r.ok) {
        const detail = d.detail;
        const message = typeof detail === "string"
            ? detail
            : Array.isArray(detail)
                ? detail.map(item => item.msg || "Request failed").join(" ")
                : detail?.message || "Request failed";
        const error = new Error(message);
        if (detail && typeof detail === "object") Object.assign(error, detail);
        throw error;
    }

    const backendStatus = $("#dbStatus");
    if (backendStatus) {
        backendStatus.textContent = "Google Apps Script: online";
        backendStatus.style.color = "#56d364";
    }

    if (cacheableRead) {
        try { apiReadCache.set(url, { savedAt: Date.now(), body: JSON.stringify(d) }); } catch {}
    }
    return d;
}

function isBackgroundMutationRequest(url, options) {
    const method = String(options.method || "GET").toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;
    const path = new URL(url, location.href).pathname;
    return new Set([
        "/api/activity", "/api/note", "/api/date", "/api/training", "/api/exam",
        "/api/promote", "/api/force-promote", "/api/demote", "/api/change-rank",
        "/api/change-callsign", "/api/terminate"
    ]).has(path) || /^\/api\/member\/[^/]+\/instructor$/.test(path) ||
        /^\/api\/leaders\/[^/]+(?:\/(?:allow|deny|admin|demote|member|leader|deactivate|reactivate))?$/.test(path);
}

function startBackgroundMutation(url, options) {
    const path = new URL(url, location.href).pathname;
    let payload = {};
    try { payload = JSON.parse(options.body || "{}"); } catch {}
    const callsignMatch = path.match(/^\/api\/member\/([^/]+)\/instructor$/);
    const callsign = String(payload.callsign || (callsignMatch ? decodeURIComponent(callsignMatch[1]) : ""));
    const previous = memberCache.get(callsign.trim().toUpperCase());
    const nextRanks = { EMT: "AEMT", AEMT: "Paramedic", Volunteer: "Senior Volunteer", "EMR/Volunteer": "Volunteer" };
    const optimisticRank = path === "/api/promote" ? (nextRanks[previous?.rank] || previous?.rank) : String(payload.new_rank || "");
    const optimisticTarget = path === "/api/change-callsign"
        ? String(payload.new_callsign || "").trim().toUpperCase()
        : config.available_callsigns?.[optimisticRank] || "";
    if (["/api/promote", "/api/force-promote", "/api/demote", "/api/change-rank"].includes(path)) payload.d1_target_callsign = optimisticTarget;
    if (["/api/promote", "/api/force-promote", "/api/demote", "/api/change-rank"].includes(path)) {
        options = { ...options, body: JSON.stringify(payload) };
    }
    const rollbackMember = previous ? { ...previous, optimistic_target: optimisticTarget } : null;
    const noChange = previous && (
        path === "/api/activity" && previous.activity === payload.activity
    );
    if (noChange) {
        toast(path === "/api/activity" ? `Already ${payload.activity}.` : "No change needed; this value is already set.");
        throw new Error(BACKGROUND_PENDING_MESSAGE);
    }
    apiReadCache.clear();
    applyOptimisticMutation(path, payload, callsign);
    const pendingRank = path === "/api/promote" ? optimisticRank : String(payload.new_rank || optimisticRank);
    if (path === "/api/promote") toast(`PROMOTED TO ${pendingRank}${optimisticTarget ? ` - ${optimisticTarget}` : ""}`);
    else if (path === "/api/force-promote" || path === "/api/change-rank") toast(`RANK CHANGED TO ${pendingRank}${optimisticTarget ? ` - ${optimisticTarget}` : ""}`);
    else if (path === "/api/demote") toast(`DEMOTED TO ${pendingRank}${optimisticTarget ? ` - ${optimisticTarget}` : ""}`);
    else if (path === "/api/change-callsign") toast(`Callsign changed to ${optimisticTarget}`);
    else if (path === "/api/activity") toast(`Activity changed to ${payload.activity}.`);
    else if (/^\/api\/member\/[^/]+\/instructor$/.test(path)) toast(`${payload.instructor_type} Instructor ${payload.assigned ? "added" : "removed"}.`);
    else if (path === "/api/terminate") toast("Member terminated.");
    else if (path === "/api/note") toast("Member note updated.");
    else if (path === "/api/date") toast("Rank date updated.");
    else if (path.startsWith("/api/leaders/")) {
        const action = path.match(/\/(allow|deny|admin|demote|member|leader|deactivate|reactivate)$/)?.[1] || "delete";
        const messages = { allow: "Account activated.", deny: "Account request denied.", admin: "Commander access granted.", demote: "Commander access removed.", member: "Member access set.", leader: "Supervisor access set.", deactivate: "Account deactivated.", reactivate: "Account reactivated.", delete: "Account deleted." };
        toast(messages[action]);
    }
    const request = fetch(url, {
        ...options,
        keepalive: true,
        headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    }).then(async response => {
        const result = await response.json().catch(() => ({}));
        if (response.status === 401) {
            location.assign("/login");
            throw new Error("Your session expired. Please sign in again.");
        }
        if (!response.ok) throw new Error(result.detail || result.error || "Save failed.");
        if (path === "/api/training") toast(result.message || `${payload.training} ${result.changed ? (payload.remove ? "removed" : "added") : "already in that state"}.`);
        else if (path === "/api/exam") toast(result.message || `Supervisor Exam ${result.changed ? (payload.remove ? "removed" : "added") : "already in that state"}.`);
        window.dispatchEvent(new CustomEvent("lvfr:background-updated", { detail: { route: path, callsign, payload, result, optimisticCallsign: optimisticTarget } }));
        return result;
    }).catch(error => {
        if (path.startsWith("/api/leaders/")) void loadLeaders();
        rollbackOptimisticMutation(path, callsign, rollbackMember);
        toast(`Save failed: ${error.message || "Network error"}. Local change was reverted. Please run Sync now to reload the correct data.`);
    });
    // Let the click handler stop waiting while fetch continues independently.
    void request;
    throw new Error(BACKGROUND_PENDING_MESSAGE);
}

function rollbackOptimisticMutation(route, callsign, previous) {
    const key = String(callsign || "").trim().toUpperCase();
    if (!previous || !key) return;
    // A rank move may have optimistically re-keyed the member to a new callsign.
    for (const [cachedKey, member] of memberCache) {
        if (member?.optimistic_from === key) memberCache.delete(cachedKey);
    }
    const restored = { ...previous };
    delete restored.optimistic_target;
    memberCache.set(key, restored);
    paintCachedMemberRow({ ...previous, optimistic_from: key }, previous.optimistic_target || key);
    if (activeProfileMember?.optimistic_from === key || activeProfileMember?.callsign?.toUpperCase() === key) {
        activeProfileMember = restored;
        profile(key, true, restored);
    }
    if (route === "/api/terminate") void loadMembers(true);
}

function isBackgroundPending(error) {
    return String(error?.message || error || "") === BACKGROUND_PENDING_MESSAGE;
}

function rankForCallsign(callsign) {
    const prefix = String(callsign || "").toUpperCase().match(/^[A-Z]+/);
    const map = { COM: "Commissioners", CHIEF: "Chief", B: "County Command", DIV: "Division Commander", C: "Captain", E: "Lieutenant", L: "Lead Paramedic", M: "Paramedic", A: "AEMT", R: "EMT", P: "Probationary", S: "Senior Volunteer", V: "Volunteer" };
    if (prefix?.[0] === "V") {
        const number = Number(String(callsign || "").split("-", 2)[1]);
        const probationary = [1, 2, 3, 4, 5, 6, 7, 8, 9, 14, 21, 22, 23, 24, 25, 26, 27, 28, 29, 36, 37, 38, 39, 40];
        return probationary.includes(number) ? "Probationary Volunteer" : "Volunteer";
    }
    return prefix ? map[prefix[0]] || "" : "";
}

function compareRosterMembers(a, b) {
    const rankOrder = ["Commissioners", "Chief", "County Command", "Division Commander", "Captain", "Lieutenant", "Lead Paramedic", "Paramedic", "AEMT", "EMT", "Probationary", "Senior Volunteer", "Volunteer", "Probationary Volunteer", "EMR", "EMR/Volunteer"];
    const rankOf = member => rankForCallsign(member.callsign) || rankOrder.find(rank => rank.toLowerCase() === String(member.rank || "").trim().toLowerCase());
    const rankA = rankOrder.indexOf(rankOf(a));
    const rankB = rankOrder.indexOf(rankOf(b));
    const rankDelta = (rankA < 0 ? 999 : rankA) - (rankB < 0 ? 999 : rankB);
    if (rankDelta) return rankDelta;
    return String(a.callsign || "").localeCompare(String(b.callsign || ""), undefined, { numeric: true, sensitivity: "base" });
}

function applyOptimisticMutation(route, payload, callsign) {
    if (route.startsWith("/api/leaders/")) {
        applyOptimisticAccountMutation(route);
        return;
    }
    if (route === "/api/notifications/read") {
        const readIds = new Set((payload.ids || []).map(Number));
        notificationItems = notificationItems.map(item =>
            !readIds.size || readIds.has(Number(item.id)) ? { ...item, is_read: 1 } : item
        );
        renderNotifications();
        return;
    }
    const key = String(callsign || "").trim().toUpperCase();
    const previous = memberCache.get(key);
    if (!previous) return;
    const profileState = activeProfileMember?.callsign?.toUpperCase() === key ? activeProfileMember : {};
    const updated = { ...profileState, ...previous };
    if (route === "/api/activity") updated.activity = payload.activity;
    else if (route === "/api/note") {
        updated.notes = payload.action === "Delete" ? "" : String(payload.note || "");
    } else if (route === "/api/training") {
        if (String(payload.training || "").toLowerCase() === "hert") updated.has_hert = !payload.remove;
        else if (payload.training === "Basic Firefighting") updated.has_basic_firefighting = !payload.remove;
        else if (payload.training === "Advanced Firefighting") updated.has_advanced_firefighting = !payload.remove;
    } else if (route === "/api/exam") updated.has_supervisor_exam = !payload.remove;
    else if (route === "/api/date") updated.date = updated.rank_assigned_date = payload.date_str;
    else if (/^\/api\/member\/[^/]+\/instructor$/.test(route)) {
        const types = String(updated.instructor_type || "").split(/\s*\/\s*/).filter(Boolean);
        const type = String(payload.instructor_type || "").toUpperCase();
        const next = payload.assigned ? [...new Set([...types, type])] : types.filter(value => value !== type);
        updated.instructor_type = next.join(" / ");
    } else if (["/api/promote", "/api/force-promote", "/api/demote", "/api/change-rank"].includes(route)) {
        const nextRanks = { EMT: "AEMT", AEMT: "Paramedic", Volunteer: "Senior Volunteer", "EMR/Volunteer": "Volunteer" };
        updated.rank = route === "/api/promote" ? (nextRanks[previous.rank] || previous.rank) : String(payload.new_rank || previous.rank);
        const targetCallsign = config.available_callsigns?.[updated.rank];
        if (targetCallsign) {
            updated.optimistic_from = key;
            updated.callsign = targetCallsign;
            memberCache.delete(key);
            memberCache.set(targetCallsign, updated);
            if (Array.isArray(allMembersCache)) {
                allMembersCache = allMembersCache.filter(member => String(member.callsign || "").toUpperCase() !== key);
                allMembersCache.push(updated);
                allMembersCache.sort(compareRosterMembers);
                allMembersCacheAt = Date.now();
                memberListRenderKey = "";
                void loadMembers();
            } else {
                paintCachedMemberRow(updated, key);
            }
        }
        updated.days_in_rank = 0;
        updated.eligible = false;
        updated.eligibility_reason = "Promotion is being saved…";
        updated.next_rank = "";
    } else if (route === "/api/change-callsign") {
        updated.callsign = String(payload.new_callsign || previous.callsign).toUpperCase();
        updated.rank = rankForCallsign(updated.callsign) || previous.rank;
        updated.optimistic_from = key;
    } else if (route === "/api/terminate") {
        memberCache.delete(key);
        removeCachedMemberRow(key);
        closeModal();
        return;
    }
    if (route === "/api/activity") {
        if (Array.isArray(allMembersCache)) {
            const index = allMembersCache.findIndex(member => String(member.callsign || "").toUpperCase() === key);
            if (index >= 0) allMembersCache[index] = updated;
            allMembersCacheAt = Date.now();
            memberListRenderKey = "";
            try { sessionStorage.setItem("lvfr.roster.snapshot.v1", JSON.stringify(allMembersCache)); } catch {}
            void loadMembers();
        }
        inactiveRows = inactiveRows.filter(member => String(member.callsign || "").toUpperCase() !== key);
        if (updated.activity === "Can Be Terminated") inactiveRows.push({ callsign: updated.callsign, name: updated.name });
        renderInactive();
    }
    if (!(updated.optimistic_from && ["/api/promote", "/api/force-promote", "/api/demote", "/api/change-rank"].includes(route))) {
        memberCache.set(key, updated);
        paintCachedMemberRow(updated, key);
    }
    // The Training tab renders from allMembersCache, so patch it and repaint now
    // instead of waiting for the background request (which also waits on Google Sheets).
    if (route === "/api/training" || route === "/api/exam" || /^\/api\/member\/[^/]+\/instructor$/.test(route)) {
        if (Array.isArray(allMembersCache)) {
            const index = allMembersCache.findIndex(member => String(member.callsign || "").toUpperCase() === key);
            if (index >= 0) {
                allMembersCache[index] = { ...allMembersCache[index], ...updated };
                allMembersCacheAt = Date.now();
                memberListRenderKey = "";
                try { sessionStorage.setItem("lvfr.roster.snapshot.v1", JSON.stringify(allMembersCache)); } catch {}
            }
        }
        renderTrainingDirectory();
    }
    if (["/api/promote", "/api/force-promote", "/api/demote", "/api/change-rank"].includes(route)) {
        removeEligibleRow(key);
        closeModal();
    } else if (activeProfileMember?.callsign?.toUpperCase() === key && route !== "/api/change-callsign") {
        profile(key, true, updated);
    }
}

function applyOptimisticAccountMutation(route) {
    const match = route.match(/^\/api\/leaders\/([^/]+)(?:\/([^/]+))?$/);
    if (!match || !Array.isArray(leaderRows.approved)) return;
    const accountId = decodeURIComponent(match[1]);
    const action = match[2] || "delete";
    const groups = ["pending", "approved", "deactivated"];
    let account;
    for (const group of groups) {
        const list = leaderRows[group] || [];
        const index = list.findIndex(row => String(row.account_id) === accountId);
        if (index < 0) continue;
        account = { ...list[index] };
        list.splice(index, 1);
        break;
    }
    if (!account) return;
    if (action === "allow") { account.status = "approved"; account.role = "member"; account.is_admin = false; }
    else if (action === "deny" || action === "delete") account = null;
    else if (action === "admin") { account.role = "admin"; account.is_admin = true; }
    else if (action === "demote") { account.role = "leader"; account.is_admin = false; }
    else if (action === "member") account.role = "member";
    else if (action === "leader") account.role = "leader";
    else if (action === "deactivate") account.status = "deactivated";
    else if (action === "reactivate") account.status = "approved";
    if (account) (leaderRows[account.status] || (leaderRows[account.status] = [])).unshift(account);
    leaderAuditRows.unshift({ name: account?.name || "", action, actor_name: "You", created_at: new Date().toISOString() });
    renderLeaders();
}

function removeCachedMemberRow(callsign) {
    ["#membersTable", "#inactiveTable"].forEach(selector => {
        const button = [...document.querySelectorAll(`${selector} [data-callsign]`)]
            .find(item => item.dataset.callsign?.toUpperCase() === callsign);
        button?.closest("tr")?.remove();
    });
    inactiveRows = inactiveRows.filter(member => String(member.callsign || "").toUpperCase() !== callsign);
}

function removeEligibleRow(callsign) {
    const button = [...document.querySelectorAll('#eligibleTable [data-callsign]')]
        .find(item => item.dataset.callsign?.toUpperCase() === callsign);
    button?.closest("tr")?.remove();
}

function rosterMatchesMutation(rows, detail) {
    const route = String(detail?.route || "");
    const payload = detail?.payload || {};
    const oldCallsign = String(detail?.callsign || "").trim().toUpperCase();
    const newCallsign = String(detail?.result?.new_callsign || payload.new_callsign || "").trim().toUpperCase();
    const find = callsign => rows.find(member => String(member.callsign || "").trim().toUpperCase() === callsign);
    if (["/api/promote", "/api/force-promote", "/api/demote", "/api/change-rank"].includes(route)) {
        const member = find(newCallsign);
        return Boolean(member && member.rank === detail.result?.new_rank && !find(oldCallsign));
    }
    if (route === "/api/change-callsign") return Boolean(find(newCallsign) && !find(oldCallsign));
    const member = find(oldCallsign);
    if (route === "/api/terminate") return !member;
    if (!member) return false;
    if (route === "/api/activity") return member.activity === payload.activity;
    if (route === "/api/note") return member.notes === (payload.action === "Delete" ? "" : String(payload.note || ""));
    if (route === "/api/date") return member.date === payload.date_str || member.rank_assigned_date === payload.date_str;
    if (route === "/api/exam") return Boolean(member.has_supervisor_exam) === !payload.remove;
    if (route === "/api/training") {
        const key = String(payload.training || "").toLowerCase() === "hert" ? "has_hert"
            : payload.training === "Basic Firefighting" ? "has_basic_firefighting"
            : payload.training === "Advanced Firefighting" ? "has_advanced_firefighting" : "";
        return Boolean(key && member[key]) === !payload.remove;
    }
    if (/^\/api\/member\/[^/]+\/instructor$/.test(route)) {
        const types = String(member.instructor_type || "").toUpperCase().split(/\s*\/\s*/);
        return types.includes(String(payload.instructor_type || "").toUpperCase()) === Boolean(payload.assigned);
    }
    return true;
}

function paintCachedMemberRow(member, oldCallsign) {
    const button = [...document.querySelectorAll('#membersTable [data-action="profile"]')]
        .find(item => item.dataset.callsign?.toUpperCase() === String(oldCallsign || "").toUpperCase()
            || item.dataset.callsign?.toUpperCase() === String(member.optimistic_from || "").toUpperCase());
    const row = button?.closest("tr");
    if (!row) return;
    const cells = row.querySelectorAll("td");
    if (cells.length >= 5) {
        cells[0].innerHTML = `<b>${esc(member.callsign)}</b>`;
        cells[2].textContent = member.rank || "";
        cells[3].textContent = String(member.days_in_rank ?? "");
        cells[4].innerHTML = status(member.activity);
    }
    button.dataset.callsign = member.callsign;
}

window.addEventListener("lvfr:background-updated", event => {
    const route = String(event.detail?.route || "");
    const result = event.detail?.result || {};
    const actualCallsign = String(result.new_callsign || "").trim().toUpperCase();
    const predictedCallsign = String(event.detail?.optimisticCallsign || "").trim().toUpperCase();
    if (["/api/promote", "/api/force-promote", "/api/demote", "/api/change-rank"].includes(route)) {
        if (!predictedCallsign) toast(`${route === "/api/promote" ? "Promoted" : route === "/api/demote" ? "Demoted" : "Changed"} to ${result.new_rank} - ${actualCallsign}`);
        else if (actualCallsign && predictedCallsign !== actualCallsign) toast(`Callsign confirmed as ${actualCallsign}`);
    }
    const callsign = String(event.detail?.callsign || "").trim().toUpperCase();
    const newCallsign = String(event.detail?.result?.new_callsign || "").trim().toUpperCase();
    if (callsign && newCallsign && callsign !== newCallsign) {
        const promoted = memberCache.get(callsign) || [...memberCache.values()].find(member => member?.optimistic_from === callsign);
        if (promoted) {
            for (const [cachedKey, member] of memberCache) {
                if (cachedKey === callsign || member?.optimistic_from === callsign) memberCache.delete(cachedKey);
            }
            promoted.callsign = newCallsign;
            promoted.rank = event.detail?.result?.new_rank || promoted.rank;
            delete promoted.optimistic_from;
            delete promoted.optimistic_target;
            memberCache.set(newCallsign, promoted);
            const button = [...document.querySelectorAll('#membersTable [data-action="profile"]')]
                .find(item => item.dataset.callsign?.toUpperCase() === callsign);
            if (button) {
                button.dataset.callsign = newCallsign;
                const cell = button.closest("tr")?.querySelector("td");
                if (cell) cell.innerHTML = `<b>${esc(newCallsign)}</b>`;
            }
            if (activeProfileMember?.callsign?.toUpperCase() === callsign) {
                activeProfileMember.callsign = newCallsign;
                profile(newCallsign, true);
            }
        }
    }
    // Keep the optimistic roster display until the user refreshes. The next
    // page load reads the already-committed D1 snapshot.
    void loadConfig();
    syncStatus();
    const activeTab = $(".tab.active")?.dataset.tab;
    if (activeTab === "trainingDirectory" && (/^\/api\/member\/[^/]+\/instructor$/.test(route) || route === "/api/training")) void loadMembers(true, true);
    if (activeTab === "eligible") loadEligible();
    if (activeTab === "inactive") loadInactive();
    if (String(event.detail?.route || "").startsWith("/api/leaders/")) loadLeaders();
    const logType = {
        "/api/training": "training", "/api/exam": "exam", "/api/note": "note",
        "/api/activity": "activity", "/api/terminate": "termination", 
        "/api/promote": "promotion", "/api/force-promote": "promotion",
        "/api/demote": "promotion", "/api/change-rank": "promotion",
        "/api/change-callsign": "callsign"
    }[event.detail?.route];
    if (/^\/api\/member\/[^/]+\/instructor$/.test(event.detail?.route || "")) loadMembersLog("instructor");
    if (logType) loadMembersLog(logType);
});

function toggleLeaderActions(event, menu) {
    event.preventDefault();
    const wasOpen = menu.open;
    document.querySelectorAll(".leader-actions-menu[open]").forEach(item => { item.open = false; });
    if (wasOpen) return;

    menu.open = true;
    const summary = menu.querySelector("summary");
    const popup = menu.querySelector(".leader-actions-menu-items");
    const anchor = summary.getBoundingClientRect();
    const box = popup.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.right - box.width, window.innerWidth - box.width - 8));
    const top = anchor.bottom + box.height + 8 <= window.innerHeight
        ? anchor.bottom + 5
        : Math.max(8, anchor.top - box.height - 5);
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
}

document.addEventListener("click", event => {
    if (!event.target.closest(".leader-actions-menu")) {
        document.querySelectorAll(".leader-actions-menu[open]").forEach(item => { item.open = false; });
    }
});

document.addEventListener("click", event => {
    const control = event.target.closest("[data-action]");
    if (!control) return;
    const action = control.dataset.action;
    const callsign = control.dataset.callsign;
    const accountId = control.dataset.accountId;
    switch (action) {
        case "profile": profile(callsign); break;
        case "promote": promote(callsign); break;
        case "do-not-promote": setMemberPromotionBlock(callsign, control.dataset.blocked === "true"); break;
        case "do-not-promote-remove": setMemberPromotionBlock(callsign, false); break;
        case "open-manage": openManage(callsign); break;
        case "terminate": terminate(callsign); break;
        case "training-add": training(callsign, false); break;
        case "training-remove": training(callsign, true); break;
        case "activity": activity(callsign); break;
        case "exam-add": examChange(callsign, false); break;
        case "exam-remove": examChange(callsign, true); break;
        case "instructor-add": setInstructor(callsign, true); break;
        case "instructor-remove": setInstructor(callsign, false); break;
        case "note": note(callsign); break;
        case "date": dateChange(callsign); break;
        case "rank-tools": openRankTools(callsign); break;
        case "change-callsign": changeCS(callsign); break;
        case "update-training-permission": updateTrainingPermission(); break;
        case "force-promote": forcePromote(callsign); break;
        case "demote": demote(callsign); break;
        case "change-rank": changeRank(callsign); break;
        case "leader-menu": toggleLeaderActions(event, control.parentElement); break;
        case "set-admin": setLeaderAdmin(accountId, control.dataset.enabled === "true"); break;
        case "set-commander": setLeaderCommander(accountId); break;
        case "set-member-role": setMemberRole(accountId, control.dataset.role); break;
        case "account-status": setAccountStatus(accountId, control.dataset.status); break;
        case "remove-leader": removeLeader(accountId); break;
        case "resolve-leader": resolveLeader(accountId, control.dataset.resolution); break;
        case "app-selection": location.assign("/portal"); break;
        case "close-modal": closeModal(); break;
        case "logout": window.lvfrLogout?.(); break;
    }
});
window.addEventListener("scroll", () => {
    document.querySelectorAll(".leader-actions-menu[open]").forEach(item => { item.open = false; });
}, true);


// ============================================================
// HELPERS
// ============================================================

function esc(x) {

    return String(x ?? "").replace(
        /[&<>"']/g,
        m => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "\"": "&quot;",
            "'": "&#39;"
        }[m])
    );
}


function toast(msg) {

    if (String(msg || "") === BACKGROUND_PENDING_MESSAGE) return;

    const x = $("#toast");

    if (!x) {
        return;
    }

    x.textContent = msg;

    x.style.display = "block";

    clearTimeout(window._toast);

    window._toast = setTimeout(
        () => x.style.display = "none",
        4000
    );
}


let notificationItems = [];
let notificationLoadPromise = null;
let notificationCacheHydrated = false;

function renderNotifications() {
    const list = $("#notificationList");
    const badge = $("#notificationBadge");
    const unread = notificationItems.filter(item => !Number(item.is_read)).length;
    if (badge) {
        badge.textContent = unread > 99 ? "99+" : String(unread);
        badge.hidden = unread === 0;
    }
    if (!list) return;
    list.innerHTML = notificationItems.length ? notificationItems.map(item => `
        <button type="button" class="notification-item ${Number(item.is_read) ? "" : "unread"}"
                data-notification-id="${Number(item.id)}">
            <strong>${esc(item.title)}</strong>
            <p>${esc(item.message)}</p>
            <small>${esc(item.created_at || "")}</small>
        </button>
    `).join("") : '<div class="empty">No notifications.</div>';
    list.querySelectorAll("[data-notification-id]").forEach(button => {
        button.addEventListener("click", () => openNotification(Number(button.dataset.notificationId)));
    });
}


async function loadNotifications(silent = true) {
    if (!notificationCacheHydrated && currentUserAccountId) {
        notificationCacheHydrated = true;
        try {
            const cached = JSON.parse(localStorage.getItem(`lvfr.portal.notifications.v1:${currentUserAccountId}`) || "null");
            if (Array.isArray(cached)) {
                notificationItems = cached;
                renderNotifications();
            }
        } catch {}
    }
    if (notificationLoadPromise) return notificationLoadPromise;
    notificationLoadPromise = (async () => {
        try {
            const result = await api("/api/notifications");
            notificationItems = Array.isArray(result.items) ? result.items : [];
            try {
                if (currentUserAccountId) localStorage.setItem(`lvfr.portal.notifications.v1:${currentUserAccountId}`, JSON.stringify(notificationItems));
            } catch {}
            renderNotifications();
        } catch (error) {
            if (!silent) toast(`Could not load notifications: ${error.message}`);
        } finally {
            notificationLoadPromise = null;
        }
    })();
    return notificationLoadPromise;
}


async function markNotificationsRead(ids = []) {
    try {
        await api("/api/notifications/read", {
            method: "POST",
            body: JSON.stringify({ ids }),
        });
        const selected = new Set(ids.map(Number));
        notificationItems = notificationItems.map(item =>
            !ids.length || selected.has(Number(item.id)) ? { ...item, is_read: 1 } : item
        );
        try {
            if (currentUserAccountId) {
                localStorage.setItem(
                    `lvfr.portal.notifications.v1:${currentUserAccountId}`,
                    JSON.stringify(notificationItems)
                );
            }
        } catch {}
        renderNotifications();
    } catch (error) {
        if (!isBackgroundPending(error)) toast(`Could not update notifications: ${error.message}`);
    }
}


async function openNotification(id) {
    const item = notificationItems.find(row => Number(row.id) === Number(id));
    if (!item) return;
    const panel = $("#notificationPanel");
    const button = $("#notificationButton");
    if (panel) panel.hidden = true;
    if (button) button.setAttribute("aria-expanded", "false");
    await markNotificationsRead([id]);

    if (["eligible", "inactive"].includes(item.kind) && item.callsign) {
        await profile(item.callsign, true);
    } else if (item.kind === "request" && currentUserIsAdmin) {
        $("#leadersTab")?.click();
        document.querySelector('.leader-view-tab[data-leader-view="pending"]')?.click();
    }
}


const notificationButton = $("#notificationButton");
notificationButton?.addEventListener("click", async () => {
    const panel = $("#notificationPanel");
    if (!panel) return;
    panel.hidden = !panel.hidden;
    notificationButton.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) {
        await loadNotifications(false);
        await markNotificationsRead();
    }
});
const accountMenuButton = $("#accountMenuButton");
accountMenuButton?.addEventListener("click", () => {
    const menu = $("#accountMenu");
    if (!menu) return;
    menu.hidden = !menu.hidden;
    accountMenuButton.setAttribute("aria-expanded", String(!menu.hidden));
});
const onlineCountButton = $("#topOnlineCount");
onlineCountButton?.addEventListener("click", async () => {
    const panel = $("#onlineUsersPanel");
    if (!panel) return;
    panel.hidden = !panel.hidden;
    onlineCountButton.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) await refreshOnlineCount();
});
$("#markNotificationsRead")?.addEventListener("click", () => markNotificationsRead());
document.addEventListener("click", event => {
    const panel = $("#notificationPanel");
    if (panel && !event.target.closest(".notification-control")) {
        panel.hidden = true;
        notificationButton?.setAttribute("aria-expanded", "false");
    }
    const accountMenu = $("#accountMenu");
    if (accountMenu && !event.target.closest(".account-control")) {
        accountMenu.hidden = true;
        accountMenuButton?.setAttribute("aria-expanded", "false");
    }
    const onlinePanel = $("#onlineUsersPanel");
    if (onlinePanel && !event.target.closest(".online-control")) {
        onlinePanel.hidden = true;
        onlineCountButton?.setAttribute("aria-expanded", "false");
    }
});


function status(s) {

    if (!s) {
        return '<span class="muted">Not loaded</span>';
    }

    const c =
        s === "Can Be Terminated"
            ? "terminate-status"
            : s === "Semi Active"
                ? "semi-status"
                : s === "Inactive"
                    ? "inactive-status"
                    : "active-status";

    return `
        <span class="badge ${c}">
            ${esc(s)}
        </span>
    `;
}


// ============================================================
// REQUIREMENT DISPLAY NAMES
// ============================================================

function formatRequirementText(text) {

    return String(text ?? "")
        .replace(
            /basic_firefighting/gi,
            "Basic FORT"
        )
        .replace(
            /advanced_firefighting/gi,
            "Advanced FORT"
        )
        .replace(
            /supervisor_exam/gi,
            "Supervisor Exam"
        );
}


// ============================================================
// TRAINING / EXAM STATUS
// ============================================================

function requirementStatus(
    list,
    internalName,
    displayName
) {

    const exists =
        Array.isArray(list) &&
        list.some(
            x =>
                String(x ?? "").toLowerCase() ===
                internalName.toLowerCase()
        );

    return `
        <span class="badge ${
            exists
                ? "active-status"
                : "terminate-status"
        }">
            ${esc(displayName)}
        </span>
    `;
}


function empty(t = "No records found.") {

    return `
        <div class="empty">
            ${esc(t)}
        </div>
    `;
}


// ============================================================
// CONFIG
// ============================================================

async function loadConfig() {
    try {
        const cached = JSON.parse(sessionStorage.getItem("lvfr.config.v1") || "null");
        if (cached && Array.isArray(cached.ranks)) config = cached;
    } catch {}
    if (config.ranks) {
        renderRankFilter();
        renderStatisticsRankFilters();
    }
    const fresh = await api("/api/config");
    config = fresh;
    try { sessionStorage.setItem("lvfr.config.v1", JSON.stringify(fresh)); } catch {}
    renderRankFilter();
    renderStatisticsRankFilters();
}

function renderRankFilter() {
    const rankFilter = $("#filterRank");
    if (rankFilter) {
        rankFilter.innerHTML = [
            '<option value="all">Rank: Any</option>',
            ...(config.ranks || []).map(rank =>
                `<option value="${esc(rank)}">${esc(rank)}</option>`
            )
        ].join("");
    }
}


// ============================================================
// HEALTH
// ============================================================

async function health() {

    try {

        await api(
            "/api/health"
        );

        const dbStatus = $("#dbStatus");

        if (dbStatus) {

            dbStatus.textContent = "Script: online";
            dbStatus.title = "Google Apps Script: online";

            dbStatus.style.color =
                "#56d364";
        }

    } catch (error) {

        const dbStatus = $("#dbStatus");

        if (dbStatus) {

            dbStatus.textContent =
                "Script: offline";

            dbStatus.title = error?.message || "Health request failed";

            dbStatus.style.color =
                "#ff7b72";
        }
    }
}


// ============================================================
// SYNC STATUS
// ============================================================

async function syncStatus() {

    try {

        const s = await api(
            "/api/sync-status"
        );

        const syncStatusElement =
            $("#syncStatus");

        if (!syncStatusElement) {
            return;
        }

        syncStatusElement.textContent = s.synced_at
            ? `Roster: ${s.members} · ${new Date(s.synced_at).toLocaleString()}`
            : `Roster: ${s.members} · Initial sync pending`;
        syncStatusElement.title = s.synced_at
            ? `Roster snapshot: ${s.synced_at} | ${s.members} members`
            : `Roster ready: ${s.members} members | waiting for initial sync`;

        syncStatusElement.style.color =
            s.synced_at
                ? "#56d364"
                : "#d29922";

        const syncActivityElement = $("#syncActivityStatus");
        if (syncActivityElement) {
            syncActivityElement.textContent = "Site: live · Sheet: trigger sync";
            syncActivityElement.title = "Site edits update D1 immediately; Sheet edits sync through the spreadsheet trigger";
            syncActivityElement.style.color = "#d29922";
        }
        const manualSyncButton = $("#syncBtn");
        if (manualSyncButton && !manualSyncButton.dataset.syncing) {
            manualSyncButton.disabled = Boolean(s.sync_running);
        }

        const googleWriteStatusElement = $("#googleWriteStatus");
        if (googleWriteStatusElement) {
            googleWriteStatusElement.textContent = "Sheets: background sync";
            googleWriteStatusElement.title = "Edits save to D1 immediately; Google Sheets updates in the background";
            googleWriteStatusElement.style.color = "#56d364";
        }

        const archiveStatusElement = $("#archiveStatus");
        if (archiveStatusElement) {
            archiveStatusElement.textContent = "Audit: private Sheet";
            archiveStatusElement.title = "Audit history is stored in the private Google Sheet";
            archiveStatusElement.style.color = "#56d364";
        }

    } catch {}
}


// ============================================================
// MEMBERS
// ============================================================

let memberListRequestInFlight = false;
let memberListReloadQueued = false;
let memberListForceReloadQueued = false;
let memberListRenderKey = "";
const memberCache = new Map();
let allMembersCache = (() => {
    try {
        const cached = memberRowsFromResponse(JSON.parse(sessionStorage.getItem("lvfr.roster.snapshot.v1") || "null"));
        return Array.isArray(cached) ? cached : null;
    } catch { return null; }
})();
let allMembersCacheAt = allMembersCache ? Date.now() : 0;
if (allMembersCache) {
    if (config.ranks) renderStatisticsRankFilters();
    else renderStatistics();
}

async function loadMembers(silent = false, forceFresh = false) {
    if (memberListRequestInFlight) {
        memberListReloadQueued = true;
        memberListForceReloadQueued = memberListForceReloadQueued || forceFresh;
        return;
    }
    memberListRequestInFlight = true;

    try {

        const searchElement =
            $("#search");

        const q = searchElement ? searchElement.value.trim().toLocaleLowerCase() : "";

        let loadedRows;
        if (!forceFresh && !silent && allMembersCache && Date.now() - allMembersCacheAt < 15000) {
            loadedRows = allMembersCache;
        } else {
            const membersUrl = forceFresh ? `/api/members?_fresh=${Date.now()}` : "/api/members";
            loadedRows = memberRowsFromResponse(await api(membersUrl));
            // If a stale browser/API cache contains an unexpected payload,
            // bypass both cache layers once and recover from the live endpoint.
            if (!loadedRows) {
                apiReadCache.delete("/api/members");
                loadedRows = memberRowsFromResponse(await api(`/api/members?_fresh=${Date.now()}`));
            }
            if (!loadedRows) throw new Error("The roster response was invalid. Refresh the page and try again.");
            allMembersCache = loadedRows;
            allMembersCacheAt = Date.now();
        }
        loadedRows.sort(compareRosterMembers);
        renderStatistics();
        try { sessionStorage.setItem("lvfr.roster.snapshot.v1", JSON.stringify(loadedRows)); } catch {}
        loadedRows.forEach(member => memberCache.set(String(member.callsign || "").toUpperCase(), member));
        const signedInMember = loadedRows.find(member => String(member.callsign || "").trim().toUpperCase() === currentUserCallsign);
        if (signedInMember && (forceFresh || !currentInstructorTypes.length)) {
            currentInstructorTypes = String(signedInMember.instructor_type || "")
                .split("/").map(value => value.trim().toUpperCase()).filter(Boolean);
            updateTrainingPermission();
        }
        renderTrainingDirectory(loadedRows);
        renderTrainingActionChoices();
        renderTrainingHoursAddChoices();
        const profileCallsign = String(activeProfileMember?.callsign || "").trim().toUpperCase();
        if (profileCallsign && !$("#modal")?.classList.contains("hidden")) {
            const latestProfileRow = loadedRows.find(member => String(member.callsign || "").trim().toUpperCase() === profileCallsign);
            const rosterFields = ["rank", "date", "rank_assigned_date", "days_in_rank", "activity", "notes", "has_basic_firefighting", "has_advanced_firefighting", "has_supervisor_exam", "has_hert", "instructor_type", "do_not_promote"];
            if (latestProfileRow && rosterFields.some(field => activeProfileMember[field] !== latestProfileRow[field])) {
                const refreshedProfile = { ...activeProfileMember, ...latestProfileRow, ...calculateMemberEligibility({ ...activeProfileMember, ...latestProfileRow }) };
                memberCache.set(profileCallsign, refreshedProfile);
                void profile(profileCallsign, true, refreshedProfile);
            }
        }

        const hertFilter = $("#filterHert")?.value || "all";
        const fortInstructorFilter = $("#filterFortInstructor")?.value || "all";
        const hertInstructorFilter = $("#filterHertInstructor")?.value || "all";
        const basicFilter = $("#filterBasic")?.value || "all";
        const advancedFilter = $("#filterAdvanced")?.value || "all";
        const supervisorFilter = $("#filterSupervisorExam")?.value || "all";
        const activityFilter = $("#filterActivity")?.value || "all";
        const rankFilter = $("#filterRank")?.value || "all";

        const renderKey = JSON.stringify([
            allMembersCacheAt, q, hertFilter, fortInstructorFilter, hertInstructorFilter,
            basicFilter, advancedFilter,
            supervisorFilter, activityFilter, rankFilter
        ]);
        if (renderKey === memberListRenderKey) return;
        memberListRenderKey = renderKey;

        const rows = loadedRows.filter(m => {
            const searchMatches = !q || [m.callsign, m.name, m.rank]
                .some(value => String(value || "").toLocaleLowerCase().includes(q));
            const rankMatches = rankFilter === "all"
                || String(m.rank || "").trim().toLowerCase() === rankFilter.trim().toLowerCase();
            const hertMatches = hertFilter === "all"
                || (hertFilter === "yes" ? Number(m.has_hert) === 1 : Number(m.has_hert) !== 1);
            const instructorTypes = String(m.instructor_type || "")
                .toUpperCase().split(/\s*\/\s*/).filter(Boolean);
            const fortInstructorMatches = fortInstructorFilter === "all"
                || (fortInstructorFilter === "yes"
                    ? instructorTypes.includes("FORT") : !instructorTypes.includes("FORT"));
            const hertInstructorMatches = hertInstructorFilter === "all"
                || (hertInstructorFilter === "yes"
                    ? instructorTypes.includes("HERT") : !instructorTypes.includes("HERT"));
            const basicMatches = basicFilter === "all"
                || (basicFilter === "yes" ? Number(m.has_basic_firefighting) === 1 : Number(m.has_basic_firefighting) !== 1);
            const advancedMatches = advancedFilter === "all"
                || (advancedFilter === "yes" ? Number(m.has_advanced_firefighting) === 1 : Number(m.has_advanced_firefighting) !== 1);
            const supervisorMatches = supervisorFilter === "all"
                || (supervisorFilter === "yes" ? Number(m.has_supervisor_exam) === 1 : Number(m.has_supervisor_exam) !== 1);
            const activityMatches = activityFilter === "all"
                || String(m.activity || "Active") === activityFilter;

            return searchMatches && rankMatches && hertMatches && fortInstructorMatches && hertInstructorMatches
                && basicMatches && advancedMatches
                && supervisorMatches && activityMatches;
        }).sort(compareRosterMembers);

        const memberCount =
            $("#memberCount");

        if (memberCount) {
            memberCount.textContent =
                rows.length;
        }

        const membersTable =
            $("#membersTable");

        if (!membersTable) {
            return;
        }

        membersTable.innerHTML =
            rows.length

                ? `
                    <table>

                        <thead>

                            <tr>
                                <th>Callsign</th>
                                <th>Name</th>
                                <th>Rank</th>
                                <th>T.I.G.</th>
                                <th>Activity</th>
                                <th></th>
                            </tr>

                        </thead>

                        <tbody>

                            ${rows.map(m => `

                                <tr>

                                    <td>
                                        <b>
                                            ${esc(m.callsign)}
                                        </b>
                                    </td>

                                    <td>
                                        ${esc(m.name)}
                                    </td>

                                    <td>
                                        ${esc(m.rank)}
                                    </td>

                                    <td>
                                        ${esc(m.days_in_rank)}
                                    </td>

                                    <td>
                                        ${status(m.activity)}
                                    </td>

                                    <td>

                                        ${currentUserHasPermission("profile_view") ? `<button
                                            type="button"
                                            data-action="profile"
                                            data-callsign="${esc(m.callsign)}"
                                        >
                                            View
                                        </button>` : ""}

                                    </td>

                                </tr>

                            `).join("")}

                        </tbody>

                    </table>
                `

                : empty();

    } catch (e) {
        if (!silent) toast(e.message);
    } finally {
        memberListRequestInFlight = false;
        if (memberListReloadQueued) {
            memberListReloadQueued = false;
            const forceReload = memberListForceReloadQueued;
            memberListForceReloadQueued = false;
            void loadMembers(true, forceReload);
        }
    }
}

function renderTrainingDirectory(members = allMembersCache || []) {
    const has = value => value === true || Number(value) === 1;
    const instructorHas = (member, type) => String(member.instructor_type || "").toUpperCase().split(/\s*\/\s*/).includes(type);
    const headerActions = (group, field, skill = "") => {
        const allowed = field === "instructor" ? currentUserHasPermission("instructor_manage") : canManageTraining(group);
        return allowed ? `<div class="training-header-actions"><button type="button" class="primary" data-training-open data-group="${group}" data-field="${field}" data-skill="${skill}" data-remove="false">Add</button><button type="button" class="danger" data-training-open data-group="${group}" data-field="${field}" data-skill="${skill}" data-remove="true">Remove</button></div>` : "";
    };
    const render = (type, mode, searchId, tableId) => {
        const container = $(tableId);
        if (!container) return;
        const query = String($(searchId)?.value || "").trim().toLocaleLowerCase();
        const rows = members.filter(member => {
            const matchesTraining = type === "HERT"
                ? mode === "certified" ? has(member.has_hert) : instructorHas(member, "HERT")
                : mode === "training" ? has(member.has_basic_firefighting) || has(member.has_advanced_firefighting) : instructorHas(member, "FORT");
            return matchesTraining && (!query || `${member.callsign} ${member.name}`.toLocaleLowerCase().includes(query));
        });
        const isInstructor = mode === "instructor";
        const headings = type === "HERT"
            ? isInstructor ? `<th>HERT Instructor${headerActions(type, "instructor")}</th>` : `<th>HERT Certified${headerActions(type, "training", "Hert")}</th>`
            : isInstructor ? `<th>FORT Instructor${headerActions(type, "instructor")}</th>` : `<th>Basic FORT${headerActions(type, "training", "Basic Firefighting")}</th><th>Advanced FORT${headerActions(type, "training", "Advanced Firefighting")}</th>`;
        container.innerHTML = `<table><thead><tr><th>Callsign</th><th>Member</th>${headings}</tr></thead><tbody>${rows.length ? rows.map(member => {
            const value = isInstructor ? (instructorHas(member, type) ? "Instructor" : "Not an Instructor")
                : type === "HERT" ? (has(member.has_hert) ? "Certified" : "Not certified")
                    : `<td>${has(member.has_basic_firefighting) ? "Certified" : "Not certified"}</td><td>${has(member.has_advanced_firefighting) ? "Certified" : "Not certified"}</td>`;
            return `<tr><td><strong>${esc(member.callsign)}</strong></td><td>${esc(member.name)}</td>${type === "FORT" && !isInstructor ? value : `<td>${value}</td>`}</tr>`;
        }).join("") : `<tr><td colspan="${type === "FORT" && !isInstructor ? 4 : 3}">No members found.</td></tr>`}</tbody></table>`;
    };
    render("HERT", "certified", "#hertCertifiedSearch", "#hertTrainingTable");
    render("HERT", "instructor", "#hertInstructorSearch", "#hertInstructorTable");
    render("FORT", "training", "#fortTrainingSearch", "#fortTrainingTable");
    render("FORT", "instructor", "#fortInstructorSearch", "#fortInstructorTable");
}

document.querySelectorAll(".training-directory-search input").forEach(input => input.addEventListener("input", () => renderTrainingDirectory()));
document.querySelectorAll("[data-training-view]").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll("[data-training-view]").forEach(item => item.classList.toggle("active", item === button));
    document.querySelectorAll("[data-training-panel]").forEach(panel => { panel.hidden = panel.dataset.trainingPanel !== button.dataset.trainingView; });
    if (button.dataset.trainingView === "HOURS") void loadTrainingHours();
}));
document.querySelectorAll("[data-training-section]").forEach(button => button.addEventListener("click", () => {
    const panel = button.closest("[data-training-panel]");
    panel?.querySelectorAll("[data-training-section]").forEach(item => item.classList.toggle("active", item === button));
    panel?.querySelectorAll("[data-training-subpanel]").forEach(section => { section.hidden = section.dataset.trainingSubpanel !== button.dataset.trainingSection; });
    if (button.dataset.trainingSection.endsWith("_LOI")) void loadLoiLists();
    else renderTrainingDirectory();
}));

let loiLists = { hert: [], fort: [] };
let loiLoadPromise = null;
let loiSignature = "";
let loiSaves = 0;
// silent=true refreshes the D1-backed list without clearing the current view.
async function loadLoiLists(silent = false) {
    if (loiLoadPromise) return loiLoadPromise;
    if (silent && loiSaves > 0) return;
    loiLoadPromise = (async () => {
        const tables = [$("#hertLoiTable"), $("#fortLoiTable")];
        const hasData = Boolean(loiSignature);
        if (!hasData) tables.forEach(table => { if (table) table.innerHTML = '<div class="empty">Loading LOI lists…</div>'; });
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 20000);
        try {
            const result = await api("/api/loi", { signal: controller.signal });
            if (silent && loiSaves > 0) return;
            const next = { hert: Array.isArray(result.hert) ? result.hert : [], fort: Array.isArray(result.fort) ? result.fort : [] };
            const signature = JSON.stringify(next);
            if (signature === loiSignature && silent) return;
            loiSignature = signature;
            loiLists = next;
            renderLoiLists();
        } catch (error) {
            if (silent && hasData) return;
            const message = error.name === "AbortError" ? "Loading LOI lists timed out. Retry in a moment." : `Could not load LOI lists: ${error.message}`;
            tables.forEach(table => { if (table) table.innerHTML = `<div class="empty">${esc(message)}</div>`; });
        } finally { window.clearTimeout(timeout); loiLoadPromise = null; }
    })();
    return loiLoadPromise;
}
function renderLoiLists() {
    const canManage = currentUserHasPermission("loi_manage");
    const memberByName = new Map((allMembersCache || []).map(member => [String(member.name || "").trim().toLocaleLowerCase(), member]));
    [["HERT", "hert", "#hertLoiTable", "#hertLoiSearch"], ["FORT", "fort", "#fortLoiTable", "#fortLoiSearch"]].forEach(([type,key,selector,searchSelector]) => {
        const table = $(selector);
        if (!table) return;
        const query = String($(searchSelector)?.value || "").trim().toLocaleLowerCase();
        const rows = loiLists[key].filter(item => `${item.name} ${memberByName.get(String(item.name).toLocaleLowerCase())?.callsign || ""} ${item.test_percent || ""}`.toLocaleLowerCase().includes(query));
        const callsign = name => memberByName.get(String(name).trim().toLocaleLowerCase())?.callsign || "";
        table.innerHTML = rows.length ? `<table><thead><tr><th>Callsign</th><th>Member</th>${type === "FORT" ? "<th>% on test</th>" : ""}${canManage ? "<th>Result</th>" : ""}</tr></thead><tbody>${rows.map(item => `<tr><td><strong>${esc(callsign(item.name))}</strong></td><td>${esc(item.name)}</td>${type === "FORT" ? `<td>${esc(item.test_percent)}%</td>` : ""}${canManage ? `<td><button type="button" data-loi-result="passed" data-loi-type="${type}" data-loi-row="${Number(item.row)}" data-loi-name="${esc(item.name)}" data-loi-callsign="${esc(callsign(item.name))}" data-loi-percent="${esc(item.test_percent || "")}">Passed</button> <button type="button" class="danger" data-loi-result="failed" data-loi-type="${type}" data-loi-row="${Number(item.row)}" data-loi-name="${esc(item.name)}" data-loi-callsign="${esc(callsign(item.name))}" data-loi-percent="${esc(item.test_percent || "")}">Failed</button></td>` : ""}</tr>`).join("")}</tbody></table>` : `<div class="empty">No ${type} LOI entries match this search.</div>`;
    });
}
$("#hertLoiSearch")?.addEventListener("input", renderLoiLists);
$("#fortLoiSearch")?.addEventListener("input", renderLoiLists);
let loiAddType = "HERT";
function renderLoiAddChoices() {
    const choices = $("#loiAddChoices");
    if (!choices) return;
    const query = String($("#loiAddSearch")?.value || "").trim().toLocaleLowerCase();
    const members = (allMembersCache || []).filter(member => !query || `${member.callsign} ${member.name}`.toLocaleLowerCase().includes(query));
    choices.innerHTML = members.length ? members.map(member => `<div class="training-action-choice"><span>${esc(member.name)} / ${esc(member.callsign)}</span>${loiAddType === "FORT" ? `<label>% on test <input type="number" min="0" max="100" step="any" data-loi-percent placeholder="Enter percent"></label>` : ""}<button type="button" class="primary" data-loi-add data-loi-type="${loiAddType}" data-loi-name="${esc(member.name)}" data-loi-callsign="${esc(member.callsign)}">Add</button></div>`).join("") : '<div class="empty">No members match this search.</div>';
}
document.querySelectorAll("[data-open-loi-add]").forEach(button => button.addEventListener("click", async () => {
    if (!currentUserHasPermission("loi_manage")) return;
    loiAddType = button.dataset.openLoiAdd;
    if (!allMembersCache?.length) await loadMembers(true, true);
    $("#loiAddTitle").textContent = `Add ${loiAddType} LOI`;
    $("#loiAddSearch").value = "";
    renderLoiAddChoices();
    $("#loiAddDialog")?.classList.remove("hidden");
}));
$("#loiAddSearch")?.addEventListener("input", renderLoiAddChoices);
$("#closeLoiAdd")?.addEventListener("click", () => $("#loiAddDialog")?.classList.add("hidden"));
$("#loiAddDialog")?.addEventListener("click", event => { if (event.target.id === "loiAddDialog") event.currentTarget.classList.add("hidden"); });
document.addEventListener("click", async event => {
    const add = event.target.closest("[data-loi-add]"), result = event.target.closest("[data-loi-result]"), button = add || result;
    if (!button || !currentUserHasPermission("loi_manage")) return;
    const row = button.closest(".training-action-choice");
    const action = add ? "add" : button.dataset.loiResult;
    const type = button.dataset.loiType;
    const payload = { action, type, name: button.dataset.loiName, callsign: button.dataset.loiCallsign };
    if (add && type === "FORT") {
        const entered = String(row?.querySelector("[data-loi-percent]")?.value || "").trim();
        if (!entered || !Number.isFinite(Number(entered)) || Number(entered) < 0 || Number(entered) > 100) return toast("Enter a FORT LOI percentage from 0 to 100.");
        payload.test_percent = Number(entered);
    }
    if (result) {
        payload.row = Number(button.dataset.loiRow);
        payload.test_percent = button.dataset.loiPercent;
        if (!window.confirm(`Mark ${payload.name}'s ${type} LOI as ${action}? This removes the entry from D1 and syncs the Sheet.`)) return;
    }
    button.disabled = true;
    const key = type.toLowerCase();
    const before = loiLists[key].slice();
    loiSaves++;
    // Show the D1 change immediately; the Sheet mirror runs in the background.
    if (result) {
        loiLists[key] = loiLists[key].filter(item => !(Number(item.row) === payload.row && item.name === payload.name));
        renderLoiLists();
    } else {
        loiLists[key] = [...loiLists[key], { type, name: payload.name, row: 0, test_percent: type === "FORT" ? String(payload.test_percent) : "" }];
        $("#loiAddDialog")?.classList.add("hidden");
        renderLoiLists();
    }
    try {
        const saved = await api("/api/loi", { method: "POST", body: JSON.stringify(payload) });
        if (saved && saved.sheet_synced === false) toast(`${type} LOI saved on the website, but the Sheet was NOT updated: ${saved.sheet_sync_error || "unknown Apps Script error"}`);
        else toast(add ? `${type} LOI added.` : `${type} LOI marked ${action}.`);
    } catch (error) {
        loiLists[key] = before;
        renderLoiLists();
        toast(`LOI update failed: ${error.message}`);
    } finally {
        loiSaves = Math.max(0, loiSaves - 1);
        button.disabled = false;
        loiSignature = "";
        await loadLoiLists(true);
    }
});
const trainingActionDialog = $("#trainingActionDialog"), trainingActionChoices = $("#trainingActionChoices"), trainingActionSearch = $("#trainingActionSearch");
let activeTrainingAction = null;
function renderTrainingActionChoices() {
    if (!trainingActionChoices || !activeTrainingAction) return;
    const query = String(trainingActionSearch?.value || "").trim().toLocaleLowerCase();
    const { group, field, remove } = activeTrainingAction;
    const hasInstructor = member => String(member.instructor_type || "").toUpperCase().split(/\s*\/\s*/).includes(group);
    const has = value => value === true || Number(value) === 1;
    const choices = [];
    (allMembersCache || []).filter(member => !query || `${member.callsign} ${member.name}`.toLocaleLowerCase().includes(query)).forEach(member => {
        if (field === "instructor") {
            if (hasInstructor(member) === remove) choices.push({ member, kind: group, label: `${group} Instructor`, type: "instructor" });
        } else if (group === "HERT") {
            if (has(member.has_hert) === remove) choices.push({ member, kind: "Hert", label: "HERT Certified", type: "training" });
        } else {
            const skill = activeTrainingAction.skill;
            const value = skill === "Basic Firefighting" ? member.has_basic_firefighting : member.has_advanced_firefighting;
            if (has(value) === remove) choices.push({ member, kind: skill, label: skill === "Basic Firefighting" ? "Basic FORT" : "Advanced FORT", type: "training" });
        }
    });
    trainingActionChoices.innerHTML = choices.length ? choices.map(choice => `<div class="training-action-choice"><span>${esc(choice.member.name)} / ${esc(choice.member.callsign)}</span><button type="button" class="${remove ? "danger" : "primary"}" data-training-action data-callsign="${esc(choice.member.callsign)}" data-kind="${esc(choice.kind)}" data-remove="${remove}" data-type="${choice.type}">${remove ? "Remove" : "Add"} ${esc(choice.label)}</button></div>`).join("") : '<div class="empty">No members match this action.</div>';
}
document.addEventListener("click", event => {
    const button = event.target.closest("[data-training-open]");
    if (!button) return;
    activeTrainingAction = { group: button.dataset.group, field: button.dataset.field, skill: button.dataset.skill || "", remove: button.dataset.remove === "true" };
    const title = $("#trainingActionTitle");
    const actionName = activeTrainingAction.field === "instructor" ? `${activeTrainingAction.group} Instructor` : activeTrainingAction.group === "HERT" ? "HERT Certified" : activeTrainingAction.skill === "Basic Firefighting" ? "Basic FORT" : "Advanced FORT";
    if (title) title.textContent = `${activeTrainingAction.remove ? "Remove from" : "Add to"} ${actionName}`;
    if (trainingActionSearch) trainingActionSearch.value = "";
    trainingActionDialog?.classList.remove("hidden");
    renderTrainingActionChoices();
    trainingActionSearch?.focus();
});
trainingActionSearch?.addEventListener("input", renderTrainingActionChoices);
$("#closeTrainingAction")?.addEventListener("click", () => trainingActionDialog?.classList.add("hidden"));
trainingActionDialog?.addEventListener("click", event => { if (event.target === trainingActionDialog) trainingActionDialog.classList.add("hidden"); });
document.addEventListener("click", async event => {
    const button = event.target.closest("[data-training-action]");
    if (!button) return;
    const callsign = button.dataset.callsign, kind = button.dataset.kind, remove = button.dataset.remove === "true";
    button.disabled = true;
    try {
        if (button.dataset.type === "instructor") {
            await api(`/api/member/${encodeURIComponent(callsign)}/instructor`, { method: "POST", body: JSON.stringify({ instructor_type: kind, assigned: !remove }) });
        } else {
            await api("/api/training", { method: "POST", body: JSON.stringify({ callsign, training: kind, remove }) });
        }
        trainingActionDialog?.classList.add("hidden");
    } catch (error) { if (!isBackgroundPending(error)) toast(error.message); }
    finally { button.disabled = false; }
});

let trainingHoursRows = [];
let trainingHoursSignature = "";
let trainingHoursSaves = 0;
let trainingHoursLoading = false;
let trainingHoursSortByName = false;
let trainingHoursNameSortDescending = false;
function trainingHoursHasUnsavedInput() {
    const active = document.activeElement;
    return Boolean(active && $("#trainingHoursTable")?.contains(active) && active.matches?.("input") && active.value !== active.defaultValue);
}
// silent=true is the background refresh: no "Loading…" flash, no re-render when
// nothing changed, and it never overwrites a time the user is still typing.
async function loadTrainingHours(silent = false) {
    const table = $("#trainingHoursTable");
    if (trainingHoursLoading) return;
    if (silent && (trainingHoursSaves > 0 || trainingHoursHasUnsavedInput())) return;
    trainingHoursLoading = true;
    if (!silent && table) table.innerHTML = '<div class="empty">Loading Training Hours…</div>';
    try {
        const result = await api("/api/training-hours");
        if (silent && (trainingHoursSaves > 0 || trainingHoursHasUnsavedInput())) return;
        const rows = Array.isArray(result) ? result : [];
        const signature = JSON.stringify(rows);
        if (silent && signature === trainingHoursSignature) return;
        trainingHoursSignature = signature;
        trainingHoursRows = rows;
        renderTrainingHours();
    } catch (error) {
        if (!silent && table) table.innerHTML = `<div class="empty">Failed to load Training Hours: ${esc(error.message)}</div>`;
    } finally {
        trainingHoursLoading = false;
    }
}
function renderTrainingHours() {
    const table = $("#trainingHoursTable");
    if (!table) return;
    const query = String($("#trainingHoursSearch")?.value || "").trim().toLocaleLowerCase();
    const memberByName = new Map((allMembersCache || []).map(member => [String(member.name || "").trim().toLocaleLowerCase(), member]));
    const rows = trainingHoursRows.filter(row => {
        const member = memberByName.get(String(row.name || "").trim().toLocaleLowerCase());
        return !query || `${row.name} ${member?.callsign || ""} ${row.date} ${row.time}`.toLocaleLowerCase().includes(query);
    });
    const rankOrder = Array.isArray(config?.ranks) ? config.ranks : ["Commissioners","Chief","County Command","Division Commander","Captain","Lieutenant","Lead Paramedic","Paramedic","AEMT","EMT","Probationary","Senior Volunteer","Volunteer","Probationary Volunteer","EMR","EMR/Volunteer"];
    const rankIndex = value => { const rank = String(value || "").trim().toLocaleLowerCase(); const index = rankOrder.findIndex(item => String(item).trim().toLocaleLowerCase() === rank); return index < 0 ? 999 : index; };
    rows.sort((a, b) => {
        const memberA = memberByName.get(String(a.name || "").trim().toLocaleLowerCase());
        const memberB = memberByName.get(String(b.name || "").trim().toLocaleLowerCase());
        if (trainingHoursSortByName) {
            const result = String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
            return trainingHoursNameSortDescending ? -result : result;
        }
        const byRank = rankIndex(a.rank || memberA?.rank) - rankIndex(b.rank || memberB?.rank);
        return byRank || String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }) || String(b.date || "").localeCompare(String(a.date || ""));
    });
    const canEdit = currentUserHasPermission("training_hours_manage");
    table.innerHTML = rows.length ? `<table><thead><tr><th>Callsign</th><th><button type="button" id="trainingHoursNameSort" class="table-sort-button" aria-label="Sort Training Hours by name">Name${trainingHoursSortByName ? trainingHoursNameSortDescending ? " ↓" : " ↑" : ""}</button></th><th>Date</th><th>Training Hours</th>${canEdit ? "<th>Actions</th>" : ""}</tr></thead><tbody>${rows.map(row => {
        const member = memberByName.get(String(row.name || "").trim().toLocaleLowerCase());
        const timeCell = canEdit ? `<div class="training-hours-time-edit"><input type="text" data-training-hours-time value="${esc(row.time)}" aria-label="Training hours for ${esc(row.name)} on ${esc(row.date)}"><button type="button" class="primary" data-training-hours-save data-id="${esc(row.id)}" data-name="${esc(row.name)}" data-callsign="${esc(row.callsign || member?.callsign || "")}">Save</button></div>` : esc(row.time);
        return `<tr><td><strong>${esc(row.callsign || member?.callsign || "")}</strong></td><td>${esc(row.name)}</td><td>${esc(row.date)}</td><td>${timeCell}</td>${canEdit ? `<td><button type="button" class="danger" data-training-hours-remove data-id="${esc(row.id)}" data-name="${esc(row.name)}" data-callsign="${esc(row.callsign || member?.callsign || "")}">Remove</button></td>` : ""}</tr>`;
    }).join("")}</tbody></table>` : '<div class="empty">No Training Hours records match this search.</div>';
    table.querySelector("#trainingHoursNameSort")?.addEventListener("click", () => {
        if (trainingHoursSortByName) trainingHoursNameSortDescending = !trainingHoursNameSortDescending;
        else { trainingHoursSortByName = true; trainingHoursNameSortDescending = false; }
        renderTrainingHours();
    });
}
function renderTrainingHoursAddChoices() {
    const choices = $("#trainingHoursAddChoices");
    if (!choices) return;
    const query = String($("#trainingHoursAddSearch")?.value || "").trim().toLocaleLowerCase();
    const members = (allMembersCache || []).filter(member => !query || `${member.callsign} ${member.name}`.toLocaleLowerCase().includes(query));
    choices.innerHTML = members.length ? members.map(member => `<div class="training-action-choice"><span>${esc(member.name)} / ${esc(member.callsign)}</span><label>Training Hours <input type="text" data-training-hours-new-time placeholder="Enter hours"></label><button type="button" class="primary" data-training-hours-add data-name="${esc(member.name)}" data-callsign="${esc(member.callsign)}">Add Record</button></div>`).join("") : '<div class="empty">No members match this search.</div>';
}
$("#trainingHoursSearch")?.addEventListener("input", renderTrainingHours);
$("#trainingHoursAddSearch")?.addEventListener("input", renderTrainingHoursAddChoices);
$("#openTrainingHoursAdd")?.addEventListener("click", () => {
    if (!currentUserHasPermission("training_hours_manage")) return;
    if (!allMembersCache?.length) void loadMembers(true);
    renderTrainingHoursAddChoices();
    $("#trainingHoursAddDialog")?.classList.remove("hidden");
    $("#trainingHoursAddSearch")?.focus();
});
$("#closeTrainingHoursAdd")?.addEventListener("click", () => $("#trainingHoursAddDialog")?.classList.add("hidden"));
$("#trainingHoursAddDialog")?.addEventListener("click", event => { if (event.target.id === "trainingHoursAddDialog") event.currentTarget.classList.add("hidden"); });
document.addEventListener("click", async event => {
    const add = event.target.closest("[data-training-hours-add]");
    const save = event.target.closest("[data-training-hours-save]");
    const remove = event.target.closest("[data-training-hours-remove]");
    const button = add || save || remove;
    if (!button) return;
    button.disabled = true;
    const row = button.closest("tr, .training-action-choice");
    const time = add ? row?.querySelector("[data-training-hours-new-time]")?.value : save ? row?.querySelector("[data-training-hours-time]")?.value : "";
    const data = { action: add ? "add" : save ? "time" : "remove", id: Number(button.dataset.id) || undefined, name: button.dataset.name, callsign: button.dataset.callsign, time };
    const selected = trainingHoursRows.find(item => Number(item.id) === data.id);
    const today = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "2-digit", day: "2-digit", year: "numeric" }).format(new Date());
    if (add) trainingHoursRows.unshift({ id: `pending-${Date.now()}`, callsign: data.callsign, name: data.name, date: today, time: data.time });
    else if (save && selected) selected.time = data.time;
    else if (remove) trainingHoursRows = trainingHoursRows.filter(item => Number(item.id) !== data.id);
    renderTrainingHours();
    renderTrainingHoursAddChoices();
    if (add) $("#trainingHoursAddDialog")?.classList.add("hidden");
    toast("Training Hours updated.");
    button.disabled = false;
    trainingHoursSaves++;
    void (async () => {
        let failure = null;
        try {
            const result = await api("/api/training-hours", { method: "POST", body: JSON.stringify(data) });
            if (result.sheet_synced === false) throw new Error(`D1 saved the record, but Sheet1 sync failed: ${result.sheet_sync_error || "unknown Apps Script error"}`);
            if (result.sheet_synced !== true && !result.row) throw new Error("The deployed API did not confirm the Sheet1 update. Deploy the latest Cloudflare Worker and Apps Script versions.");
        } catch (error) {
            failure = error;
        } finally {
            trainingHoursSaves = Math.max(0, trainingHoursSaves - 1);
        }
        // D1 may already have committed even when the Sheet mirror failed, so
        // always show its authoritative state afterwards.
        trainingHoursSignature = "";
        await loadTrainingHours(true);
        if (failure) {
            renderTrainingHoursAddChoices();
            toast(`Training Hours save issue: ${failure.message}`);
        }
    })();
});

// ============================================================
// ELIGIBLE
// ============================================================

async function loadEligible(forceFresh = false) {

    try {
        if (forceFresh) {
            renderEligibleRows(await api(`/api/eligible?_fresh=${Date.now()}`));
            return;
        }
        const cachedRows = [...memberCache.values()];
        if (cachedRows.length) {
            renderEligibleRows(calculateEligibleFromCache(cachedRows));
            api("/api/eligible").then(renderEligibleRows).catch(() => {});
            return;
        }
        renderEligibleRows(await api("/api/eligible"));
    } catch (e) {
        toast(e.message);
    }
}

function calculateEligibleFromCache(members) {
    const rules = {
        "EMR": ["EMT", 7, false, false, false],
        "EMT": ["AEMT", 14, true, false, false],
        "AEMT": ["Paramedic", 21, true, true, true],
        "Advanced EMT": ["Paramedic", 21, true, true, true],
        "EMR/Volunteer": ["Volunteer", 7, false, false, false],
        "Volunteer": ["Senior Volunteer", 14, false, false, false]
    };
    return members.flatMap(member => {
        if (member.do_not_promote) return [];
        if (!currentUserHasPermission("rank_manage") && member.rank !== "EMT") return [];
        const rule = rules[member.rank];
        if (!rule || Number(member.days_in_rank || 0) < rule[1]) return [];
        if (rule[2] && !member.has_basic_firefighting) return [];
        if (rule[3] && !member.has_advanced_firefighting) return [];
        if (rule[4] && !member.has_supervisor_exam) return [];
        return [{ ...member, next_rank: rule[0] }];
    });
}

function calculateMemberEligibility(member) {
    const rules = {
        "EMR": { next_rank: "EMT", days: 7 },
        "Probationary": { next_rank: "EMT", days: 7 },
        "EMT": { next_rank: "AEMT", days: 14, basic: true },
        "AEMT": { next_rank: "Paramedic", days: 21, basic: true, advanced: true, exam: true },
        "Advanced EMT": { next_rank: "Paramedic", days: 21, basic: true, advanced: true, exam: true },
        "EMR/Volunteer": { next_rank: "Volunteer", days: 7 },
        "Probationary Volunteer": { next_rank: "Volunteer", days: 7 },
        "Volunteer": { next_rank: "Senior Volunteer", days: 14 }
    };
    if (member.do_not_promote) {
        return { eligible: false, eligibility_reason: "Can't be promoted (Do not Promote list)", next_rank: rules[member.rank]?.next_rank || "" };
    }
    const rule = rules[member.rank];
    if (!rule || ["Probationary", "Probationary Volunteer"].includes(member.rank)) {
        return { eligible: false, eligibility_reason: "No automatic promotion available", next_rank: "" };
    }
    const missing = [];
    const days = Number(member.days_in_rank || 0);
    if (days < rule.days) missing.push(`${rule.days - days} more day(s)`);
    if (rule.basic && !member.has_basic_firefighting) missing.push("basic_firefighting");
    if (rule.advanced && !member.has_advanced_firefighting) missing.push("advanced_firefighting");
    if (rule.exam && !member.has_supervisor_exam) missing.push("supervisor_exam");
    return {
        eligible: missing.length === 0,
        eligibility_reason: missing.length ? missing.join(", ") : "Eligible for Promotion",
        next_rank: rule.next_rank
    };
}

function renderEligibleRows(loadedRows) {
        const rankFilter = $("#eligibleRankFilter")?.value || "all";
        const rows = loadedRows.filter(m => {
            const rank = String(m.rank || "").trim().toLowerCase();
            if (rankFilter === "aemt") {
                return rank === "aemt" || rank === "advanced emt";
            }
            if (rankFilter === "emt") return rank === "emt";
            if (rankFilter === "volunteer") return rank === "volunteer";
            return true;
        });

        const eligibleTable =
            $("#eligibleTable");

        if (!eligibleTable) {
            return;
        }

        eligibleTable.innerHTML =
            rows.length

                ? `
                    <table>

                        <thead>

                            <tr>
                                <th>Callsign</th>
                                <th>Name</th>
                                <th>Rank</th>
                                <th>Next Rank</th>
                                <th></th>
                            </tr>

                        </thead>

                        <tbody>

                            ${rows.map(m => `

                                <tr>

                                    <td>
                                        ${esc(m.callsign)}
                                    </td>

                                    <td>
                                        ${esc(m.name)}
                                    </td>

                                    <td>
                                        ${esc(m.rank)}
                                    </td>

                                    <td>
                                        ${esc(m.next_rank)}
                                    </td>

                                    <td>

                                        ${currentUserHasPermission("profile_view") ? `<button type="button" data-action="profile" data-callsign="${esc(m.callsign)}">View</button>` : ""}
                                        <button
                                            type="button"
                                            class="primary"
                                            data-action="promote"
                                            data-callsign="${esc(m.callsign)}"
                                        >
                                            Promote
                                        </button>

                                    </td>

                                </tr>

                            `).join("")}

                        </tbody>

                    </table>
                `

                : empty(
                    "Nobody is currently eligible."
                );

}


// ============================================================
// CAN BE TERMINATED
// ============================================================

let inactiveRows = [];


async function loadInactive(forceFresh = false) {

    try {
        if (forceFresh) {
            inactiveRows = await api(`/api/inactive?_fresh=${Date.now()}`);
            renderInactive();
            return;
        }
        const cachedRows = [...memberCache.values()];
        if (cachedRows.length) {
            inactiveRows = cachedRows.filter(member => member.activity === "Can Be Terminated");
            renderInactive();
            api("/api/inactive").then(rows => { inactiveRows = rows; renderInactive(); }).catch(() => {});
            return;
        }
        inactiveRows = await api("/api/inactive");
        renderInactive();

    } catch (e) {
        toast(
            e.message
        );
    }
}


function renderInactive() {

    const container =
        $("#inactiveTable");

    if (!container) {
        return;
    }

    const searchElement =
        $("#inactiveSearch");

    const search =
        (
            searchElement
                ? searchElement.value
                : ""
        )
            .trim()
            .toLowerCase();


    const rows =
        inactiveRows.filter(m => {

            const callsign =
                String(
                    m.callsign || ""
                ).toLowerCase();

            const name =
                String(
                    m.name || ""
                ).toLowerCase();

            return (
                !search ||
                callsign.includes(search) ||
                name.includes(search)
            );

        });


    container.innerHTML = rows.length

        ? `
            <table>

                <thead>

                    <tr>

                        <th>Callsign</th>
                        <th>Name</th>
                        <th></th>

                    </tr>

                </thead>

                <tbody>

                    ${rows.map(m => `

                        <tr>

                            <td>
                                <b>
                                    ${esc(m.callsign)}
                                </b>
                            </td>

                            <td>
                                ${esc(m.name)}
                            </td>

                            <td>

                                ${currentUserHasPermission("profile_view") ? `<button type="button" data-action="profile" data-callsign="${esc(m.callsign)}">View</button>` : ""}
                                <button
                                    type="button"
                                    class="danger"
                                    data-action="terminate"
                                    data-callsign="${esc(m.callsign)}"
                                >
                                    Terminate
                                </button>

                            </td>

                        </tr>

                    `).join("")}

                </tbody>

            </table>
        `

        : empty(
            search
                ? "No matching members found."
                : "No red Can Be Terminated members found."
        );
}


// ============================================================
// DISCORD LEADERS
// ============================================================

let leaderRows = { approved: [], pending: [], deactivated: [] };
let instructorRows = [];
let leaderAuditRows = [];
let currentLeaderView = "all";
let onlineMembers = [];

function setOnlineCount(value, people) {
    const count = Number(value || 0);
    const summary = $("#onlineAccountCount");
    if (summary) summary.textContent = `Online now: ${count}`;
    const compact = $("#topOnlineCount");
    if (compact) {
        compact.textContent = `Online: ${count}`;
        compact.title = `Online now: ${count}`;
    }
    if (Array.isArray(people)) onlineMembers = people;
    const list = $("#onlineUsersList");
    if (list) {
        list.innerHTML = onlineMembers.length
            ? onlineMembers.map(person => `<div class="online-user"><strong>${esc(person.name || "Member")}</strong>${person.callsign ? `<span>${esc(person.callsign)}</span>` : ""}</div>`).join("")
            : '<div class="empty">No one online.</div>';
    }
}

async function refreshOnlineCount() {
    try {
        const summary = await api("/api/presence/summary");
        setOnlineCount(summary.online_count, summary.online);
    } catch {}
}


async function loadLeaders() {
    const pending = $("#pendingLeadersTable");
    const all = $("#allLeadersTable");
    const audit = $("#leaderAuditTable");
    if (!pending && !all && !audit) return;

    let hadCachedData = false;
    try {
        const leaderCacheKey = `lvfr.leaders.${currentUserAccountId}.v1`;
        const cached = JSON.parse(sessionStorage.getItem(leaderCacheKey) || "null");
        if (cached?.data && Date.now() - cached.savedAt < 10 * 60 * 1000) {
            leaderRows = cached.data;
            leaderAuditRows = Array.isArray(leaderRows.audit) ? leaderRows.audit : [];
            renderLeaders();
            hadCachedData = true;
        }
    } catch {}
    if (!hadCachedData) {
        if (pending) pending.innerHTML = '<div class="empty">Loading...</div>';
        if (all) all.innerHTML = '<div class="empty">Loading...</div>';
        if (audit) audit.innerHTML = '<div class="empty">Loading...</div>';
    }

    try {
        const accounts = await api("/api/leaders");
        leaderRows = accounts;
        setOnlineCount(accounts.online_count);
        leaderAuditRows = Array.isArray(leaderRows.audit) ? leaderRows.audit : [];
        try { sessionStorage.setItem(`lvfr.leaders.${currentUserAccountId}.v1`, JSON.stringify({ data: leaderRows, savedAt: Date.now() })); } catch {}
        renderLeaders();
    } catch (e) {
        if (hadCachedData) return;
        leaderRows = { approved: [], pending: [], deactivated: [] };
        leaderAuditRows = [];
        const message = empty("Failed to load Supervisors: " + e.message);
        if (pending) pending.innerHTML = message;
        if (all) all.innerHTML = message;
        if (audit) audit.innerHTML = message;
    }
}


function renderLeaders() {
    const pending = $("#pendingLeadersTable");
    const pendingCount = $("#pendingLeaderCount");
    const approvedRows = Array.isArray(leaderRows.approved) ? leaderRows.approved : [];
    const pendingRows = Array.isArray(leaderRows.pending) ? leaderRows.pending : [];
    const deactivatedRows = Array.isArray(leaderRows.deactivated) ? leaderRows.deactivated : [];
    const accountRows = [...approvedRows, ...deactivatedRows];
    const accountActions = row => {
        if (currentUserAccountId && String(row.account_id) === currentUserAccountId) return "";
        let actions;
        if (row.is_admin || row.is_commander) actions = currentUserIsOperation ? (row.is_admin ? `
            <button type="button" class="primary" data-action="set-admin" data-account-id="${esc(row.account_id)}" data-enabled="false">Make Commander</button>` : `
            <button type="button" class="primary" data-action="set-admin" data-account-id="${esc(row.account_id)}" data-enabled="true">Make Operation</button>
            <button type="button" class="danger" data-action="set-admin" data-account-id="${esc(row.account_id)}" data-enabled="false">Demote to Leader</button>`)
            : `<span class="muted">Only Operation can manage this role.</span>`;
        else {
        const memberRoleAction = row.status === "approved"
            ? row.role === "member"
                ? `<button type="button" class="primary" data-action="set-member-role" data-account-id="${esc(row.account_id)}" data-role="leader">Make Supervisor</button>`
                : `<button type="button" class="primary" data-action="set-member-role" data-account-id="${esc(row.account_id)}" data-role="member">Make Member</button>`
            : "";
        const stateAction = row.status === "deactivated"
            ? `<button type="button" class="primary" data-action="account-status" data-account-id="${esc(row.account_id)}" data-status="reactivate">Activate</button>`
            : `<button type="button" class="danger" data-action="account-status" data-account-id="${esc(row.account_id)}" data-status="deactivate">Deactivate</button>`;
        const adminAction = row.status === "approved" && currentUserIsOperation
            ? `<button type="button" class="primary" data-action="set-commander" data-account-id="${esc(row.account_id)}">Make Commander</button><button type="button" class="primary" data-action="set-admin" data-account-id="${esc(row.account_id)}" data-enabled="true">Make Operation</button>` : "";
            actions = `${memberRoleAction}${adminAction}${stateAction}<button type="button" class="danger" data-action="remove-leader" data-account-id="${esc(row.account_id)}">Delete account</button>`;
        }
        return `<details class="leader-actions-menu">
            <summary data-action="leader-menu">Actions</summary>
            <div class="leader-actions-menu-items">${actions}</div>
        </details>`;
    };

    if (pendingCount) pendingCount.textContent = String(pendingRows.length);

    if (pending) {
        pending.innerHTML = pendingRows.length ? `
            <table>
                <thead><tr>
                    <th>Account</th><th>Callsign</th><th>Requested At</th><th></th>
                </tr></thead>
                <tbody>${pendingRows.map(row => `
                    <tr>
                        <td>${esc(row.name || row.display_name)}</td>
                        <td>${esc(row.callsign || '—')}</td>
                        <td>${esc(row.requested_at || row.linked_at)}</td>
                        <td class="leader-request-actions">
                            <button type="button" class="primary" data-action="resolve-leader" data-account-id="${esc(row.account_id)}" data-resolution="allow">Allow</button>
                            <button type="button" class="danger" data-action="resolve-leader" data-account-id="${esc(row.account_id)}" data-resolution="deny">Deny</button>
                            <button type="button" class="danger" data-action="remove-leader" data-account-id="${esc(row.account_id)}">Delete</button>
                        </td>
                    </tr>
                `).join("")}</tbody>
            </table>
        ` : empty("No pending account requests.");
    }

    const all = $("#allLeadersTable");
    if (all) {
        const roleFilter = $("#leaderRoleFilter")?.value || "all";
        const filteredRows = accountRows.filter(row =>
            roleFilter === "all" ||
            (roleFilter === "admin" && row.role === "admin") ||
            (roleFilter === "commander" && row.role === "commander") ||
            (roleFilter === "leader" && row.role === "leader") ||
            (roleFilter === "member" && row.role === "member")
        );
        all.innerHTML = filteredRows.length ? `
            <table>
                <thead><tr>
                    <th>Account</th><th>Linked At</th><th>Approval</th><th>Role</th><th>Presence</th><th>Role Change</th><th>Actions</th>
                </tr></thead>
                <tbody>${filteredRows.map(row => `
                    <tr>
                        <td data-label="Account" class="leader-account-cell"><strong>${esc(row.name || row.display_name)}</strong><small>${row.callsign ? `Callsign ${esc(row.callsign)}` : "No Callsign linked"}</small></td>
                        <td data-label="Linked">${esc(row.linked_at || "—")}</td>
                        <td data-label="Approved" class="leader-detail-cell"><span>${esc(row.approved_at || "—")}</span><small>By ${esc(row.approved_by || "—")}</small></td>
                        <td data-label="Role">${row.role === "admin" ? "Operation" : row.role === "commander" ? "Commander" : row.role === "member" ? "Member" : "Leader"}</td>
                        <td data-label="Presence"><span class="presence-badge ${row.online ? "online" : "offline"}">${row.online ? "Online" : "Offline"}</span></td>
                        <td data-label="Role changed" class="leader-detail-cell">${row.admin_changed_at ? `<span>${esc(row.admin_changed_at)}</span><small>By ${esc(row.admin_changed_by || "—")}</small>` : "—"}</td>
                        <td data-label="Actions" class="leader-request-actions">${accountActions(row)}</td></tr>
                `).join("")}</tbody>
            </table>
        ` : empty("No members match this role.");
    }

    const instructors = $("#instructorsTable");
    if (instructors) {
        const typeFilter = $("#instructorTypeFilter")?.value || "all";
        const search = String($("#instructorSearch")?.value || "").trim().toLocaleLowerCase();
        const filteredInstructors = instructorRows.filter(row =>
            (typeFilter === "all" || String(row.type || "").toUpperCase().split("/").map(type => type.trim()).includes(typeFilter)) &&
            (!search || [row.name, row.type, row.date].some(value => String(value || "").toLocaleLowerCase().includes(search)))
        );
        instructors.innerHTML = filteredInstructors.length ? `
            <table>
                <thead><tr><th>Instructor</th><th>Type</th><th>Since</th></tr></thead>
                <tbody>${filteredInstructors.map(row => `
                    <tr><td><strong>${esc(row.name)}</strong></td><td>${esc(row.type)}</td><td>${esc(row.date || "—")}</td></tr>
                `).join("")}</tbody>
            </table>
        ` : empty("No instructors found.");
    }

    const audit = $("#leaderAuditTable");
    if (audit) {
        audit.innerHTML = leaderAuditRows.length ? `
            <table>
                <thead><tr>
                    <th>Account</th><th>Action</th><th>By</th><th>Date</th>
                </tr></thead>
                <tbody>${leaderAuditRows.map(row => `
                    <tr>
                        <td>${esc(row.name || row.display_name)}</td>
                        <td>${esc(row.action)}</td>
                        <td>${esc(row.actor_name)}</td>
                        <td>${esc(row.created_at)}</td>
                    </tr>
                `).join("")}</tbody>
            </table>
        ` : empty("No account history yet.");
    }
}


async function loadInstructors() {
    const table = $("#instructorsTable");
    if (table) table.innerHTML = '<div class="empty">Loading...</div>';
    try {
        const result = await api("/api/instructors");
        instructorRows = Array.isArray(result) ? result : [];
        renderInstructors();
    } catch (error) {
        if (table) table.innerHTML = empty("Failed to load instructors: " + error.message);
    }
}

function renderStatisticsRankFilters() {
    ["#statisticsIncludeRanks", "#statisticsExcludeRanks"].forEach(selector => {
        const picker = $(selector);
        if (!picker) return;
        const selected = new Set(Array.from(picker.querySelectorAll("[data-stat-rank]:checked"))
            .map(input => input.value.toLowerCase()));
        const options = picker.querySelector(".statistics-rank-options");
        if (options) options.innerHTML = (config.ranks || []).map(rank => {
            const aliases = rank.toLowerCase().startsWith("probationary") ? " probie" : "";
            return `
            <label data-rank-option data-rank-search-terms="${esc(rank.toLowerCase() + aliases)}">
                <input type="checkbox" data-stat-rank value="${esc(rank)}" ${selected.has(rank.toLowerCase()) ? "checked" : ""}>
                <span>${esc(rank)}</span>
            </label>
        `;
        }).join("");
        updateStatisticsRankSummary(picker);
    });
    renderStatistics();
}

function updateStatisticsRankSummary(picker) {
    const summary = picker?.querySelector("summary");
    if (!summary) return;
    const checked = picker.querySelectorAll("[data-stat-rank]:checked").length;
    const isInclude = picker.id === "statisticsIncludeRanks";
    summary.textContent = checked ? `${checked} rank${checked === 1 ? "" : "s"} selected` : (isInclude ? "All ranks" : "No ranks excluded");
}

function renderStatistics() {
    const cards = $("#statisticsCards"), population = $("#statisticsPopulation");
    if (!cards || !population) return;
    const members = Array.isArray(allMembersCache) ? allMembersCache : [];
    const selectedRanks = new Set(Array.from($("#statisticsIncludeRanks")?.querySelectorAll("[data-stat-rank]:checked") || []).map(input => input.value.toLowerCase()));
    const excludedRanks = new Set(Array.from($("#statisticsExcludeRanks")?.querySelectorAll("[data-stat-rank]:checked") || []).map(input => input.value.toLowerCase()));
    const selected = members.filter(member => {
        const rank = String(member.rank || "").trim().toLowerCase();
        return (!selectedRanks.size || selectedRanks.has(rank)) && !excludedRanks.has(rank);
    });
    const metrics = {
        exam: { label: "Supervisor Exam", test: member => Boolean(member.has_supervisor_exam) },
        basic: { label: "Basic FORT", test: member => Boolean(member.has_basic_firefighting) },
        advanced: { label: "Advanced FORT", test: member => Boolean(member.has_advanced_firefighting) },
        hert: { label: "HERT", test: member => Boolean(member.has_hert) },
        fortInstructor: { label: "FORT Instructors", test: member => String(member.instructor_type || "").toUpperCase().split(/\s*\/\s*/).includes("FORT") },
        hertInstructor: { label: "HERT Instructors", test: member => String(member.instructor_type || "").toUpperCase().split(/\s*\/\s*/).includes("HERT") }
    };
    const chosen = Array.from(document.querySelectorAll("[data-stat-metric]:checked"))
        .map(input => metrics[input.value]).filter(Boolean);
    population.textContent = `${selected.length} of ${members.length} members in this selection`;
    const statCard = (label, count, total) => {
        const percent = total ? Math.round(count / total * 1000) / 10 : 0;
        return `<article class="statistics-card"><span>${esc(label)}</span><strong>${percent}%</strong><small>${count} of ${total} members</small></article>`;
    };
    if (!selected.length) {
        cards.innerHTML = `<p class="empty">No members match these rank filters.</p>`;
        return;
    }
    const individual = chosen.map(metric => statCard(metric.label, selected.filter(metric.test).length, selected.length));
    const combined = chosen.length
        ? statCard("All selected items", selected.filter(member => chosen.every(metric => metric.test(member))).length, selected.length)
        : `<article class="statistics-card"><span>All selected items</span><strong>—</strong><small>Select at least one item</small></article>`;
    cards.innerHTML = [...individual, combined].join("");
}

document.querySelectorAll("#statisticsIncludeRanks, #statisticsExcludeRanks").forEach(picker => {
    picker.addEventListener("change", event => {
        if (event.target.matches("[data-stat-rank]")) updateStatisticsRankSummary(picker);
        renderStatistics();
    });
    picker.querySelector("[data-rank-search]")?.addEventListener("input", event => {
        const query = event.target.value.trim().toLocaleLowerCase();
        picker.querySelectorAll("[data-rank-option]").forEach(option => {
            option.hidden = !(option.textContent.toLocaleLowerCase() + " " + option.dataset.rankSearchTerms).includes(query);
        });
    });
    picker.querySelector("[data-rank-clear]")?.addEventListener("click", () => {
        picker.querySelectorAll("[data-stat-rank]").forEach(input => { input.checked = false; });
        updateStatisticsRankSummary(picker);
        renderStatistics();
    });
});
document.querySelectorAll("[data-stat-metric]").forEach(input => input.addEventListener("change", renderStatistics));

function renderInstructors() {
    const table = $("#instructorsTable");
    if (!table) return;
    const typeFilter = $("#instructorTypeFilter")?.value || "all";
    const search = String($("#instructorSearch")?.value || "").trim().toLocaleLowerCase();
    const rows = instructorRows.filter(row =>
        (typeFilter === "all" || String(row.type || "").toUpperCase().split("/").map(type => type.trim()).includes(typeFilter)) &&
        (!search || [row.name, row.type, row.date].some(value => String(value || "").toLocaleLowerCase().includes(search)))
    );
    table.innerHTML = rows.length ? `
        <table><thead><tr><th>Instructor</th><th>Type</th><th>Since</th></tr></thead>
        <tbody>${rows.map(row => `<tr><td><strong>${esc(row.name)}</strong></td><td>${esc(row.type)}</td><td>${esc(row.date || "—")}</td></tr>`).join("")}</tbody></table>
    ` : empty("No instructors found.");
}

async function resolveLeader(discordId, decision) {
    try {
        await api(`/api/leaders/${encodeURIComponent(discordId)}/${decision}`, { method: "POST" });
        toast(decision === "allow" ? "Activated" : "Denial queued; saving in background.");
        await loadLeaders();
    } catch (e) {
        if (isBackgroundPending(e)) return;
        toast(e.message);
    }
}


async function removeLeader(discordId) {
    if (!confirm("Permanently delete this account? This cannot be undone.")) return;
    try {
        await api(`/api/leaders/${encodeURIComponent(discordId)}`, { method: "DELETE" });
        toast("Deletion queued; saving in background.");
        await loadLeaders();
    } catch (e) {
        if (isBackgroundPending(e)) return;
        toast(e.message);
    }
}

async function setAccountStatus(discordId, action) {
    const activating = action === "reactivate";
    if (!activating && !confirm("Deactivate this account? The account and its history will be kept.")) return;
    try {
        await api(`/api/leaders/${encodeURIComponent(discordId)}/${action}`, { method: "POST" });
        toast(activating ? "Reactivated" : "Deactivation queued; saving in background.");
        await loadLeaders();
    } catch (e) {
        if (isBackgroundPending(e)) return;
        toast(e.message);
    }
}


async function setLeaderAdmin(discordId, makeAdmin) {
        if (!makeAdmin && !confirm("Change this account to the next lower role?")) return;
    try {
        await api(`/api/leaders/${encodeURIComponent(discordId)}/${makeAdmin ? "admin" : "demote"}`, { method: "POST" });
        toast(makeAdmin ? "Operation role queued; saving in background." : "Role change queued; saving in background.");
        await loadLeaders();
    } catch (e) {
        if (isBackgroundPending(e)) return;
        toast(e.message);
    }
}

async function setLeaderCommander(accountId) {
    try {
        await api(`/api/leaders/${encodeURIComponent(accountId)}/commander`, { method: "POST" });
        toast("Commander role queued; saving in background.");
        await loadLeaders();
    } catch (e) {
        if (isBackgroundPending(e)) return;
        toast(e.message);
    }
}

async function setMemberRole(discordId, role) {
    const makeMember = role === "member";
    if (makeMember && !confirm("Limit this account to Watch Command access?")) return;
    try {
        await api(`/api/leaders/${encodeURIComponent(discordId)}/${makeMember ? "member" : "leader"}`, { method: "POST" });
        toast(makeMember ? "Member role queued; access will be limited to Watch Command." : "Supervisor role queued.");
        await loadLeaders();
    } catch (e) {
        if (isBackgroundPending(e)) return;
        toast(e.message);
    }
}


document.querySelectorAll(".leader-view-tab").forEach(button => {
    button.addEventListener("click", () => {
        currentLeaderView = button.dataset.leaderView;
        document.querySelectorAll(".leader-view-tab").forEach(item => item.classList.toggle("active", item === button));
        const views = {
            pending: $("#pendingLeadersView"),
            all: $("#allLeadersView"),
            audit: $("#leaderAuditView"),
        };
        Object.entries(views).forEach(([name, view]) => {
            if (view) view.style.display = currentLeaderView === name ? "block" : "none";
        });
    });
});


const leaderRoleFilter = $("#leaderRoleFilter");
if (leaderRoleFilter) leaderRoleFilter.addEventListener("change", renderLeaders);
const instructorTypeFilter = $("#instructorTypeFilter");
if (instructorTypeFilter) instructorTypeFilter.addEventListener("change", renderInstructors);
const instructorSearch = $("#instructorSearch");
if (instructorSearch) instructorSearch.addEventListener("input", renderInstructors);
const clearInstructorSearch = $("#clearInstructorSearch");
if (clearInstructorSearch) clearInstructorSearch.addEventListener("click", () => {
    if (instructorSearch) instructorSearch.value = "";
    renderInstructors();
    instructorSearch?.focus();
});


// ============================================================
// MEMBERS LOG
// ============================================================

let currentLogType = "promotion";
let currentLogRows = [];


function updateLogFilters(type) {
    const visibleFilter = {
        promotionFilterWrap: type === "promotion",
        trainingFilterWrap: type === "training",
        noteFilterWrap: type === "note"
    };
    let hasVisibleFilter = false;
    Object.entries(visibleFilter).forEach(([id, visible]) => {
        const element = document.getElementById(id);
        if (element) element.style.display = visible ? "flex" : "none";
        hasVisibleFilter = hasVisibleFilter || visible;
    });
    const filters = $("#logFilters");
    if (filters) {
        filters.dataset.logType = type;
        filters.style.display = hasVisibleFilter ? "flex" : "none";
    }
}

updateLogFilters(currentLogType);


async function loadMembersLog(
    type = currentLogType
) {

    currentLogType = type;
    const canDeleteD1Log = currentUserHasPermission("logs_delete_d1");
    if (membersLogDelete) membersLogDelete.hidden = !canDeleteD1Log || type === "instructor";
    const instructorLogDelete = $("#instructorLogDeleteBtn");
    if (instructorLogDelete) instructorLogDelete.hidden = !canDeleteD1Log || type !== "instructor";
    const logContent = $("#membersLogContent"), instructorLog = $("#instructorLog");
    if (logContent) logContent.style.display = type === "instructor" ? "none" : "";
    if (instructorLog) instructorLog.style.display = type === "instructor" ? "" : "none";

    document.querySelectorAll("#membersLog .log-tab:not(.leader-view-tab)").forEach(button => {
        button.classList.toggle("active", button.dataset.log === type);
    });

    updateLogFilters(type);

    const container = type === "instructor" ? $("#instructorLogTable") : $("#membersLogTable");

    if (!container) {
        return;
    }

    let hadCachedData = false;
    try {
        const cached = JSON.parse(sessionStorage.getItem(`lvfr.log.${currentUserAccountId}.${type}.v1`) || "null");
        // Paint the last known log immediately, even after a longer gap, then
        // replace it with the authoritative server response below.
        if (Array.isArray(cached?.rows)) {
            currentLogRows = cached.rows;
            hadCachedData = true;
            renderMembersLog();
        }
    } catch {}
    if (!hadCachedData) container.innerHTML = '<div class="empty">Loading…</div>';


    try {

        let rows;
        try {
            rows = await api(
                "/api/members-log?log_type=" +
                encodeURIComponent(type)
            );
        } catch (e) {
            if (type !== "callsign" || !e.message.includes("Invalid log type")) throw e;
            rows = await api("/api/members-log?log_type=promotion");
        }


        currentLogRows =
            Array.isArray(rows)
                ? rows
                : [];

        try { sessionStorage.setItem(`lvfr.log.${currentUserAccountId}.${type}.v1`, JSON.stringify({ rows: currentLogRows, savedAt: Date.now() })); } catch {}

        if (type === "callsign") {
            currentLogRows = currentLogRows.filter(isCallsignChangeLog);
        }


        renderMembersLog();


    } catch (e) {

        if (hadCachedData) return;

        currentLogRows = [];

        container.innerHTML =
            empty(
                "Failed to load log: " +
                e.message
            );
    }
}


function promotionRankLevel(rank) {
    const levels = {
        "probationary volunteer": 1, "probie volunteer": 1,
        "probationary": 1, "probie": 1, "emr": 1,
        "volunteer": 2, "senior volunteer": 3,
        "emt": 4, "aemt": 5, "advanced emt": 5,
        "paramedic": 6, "lead paramedic": 7,
        "lieutenant": 8, "captain": 9,
        "division commander": 10, "county command": 11,
        "chief": 12, "commissioners": 13
    };
    return levels[String(rank || "").trim().toLowerCase()];
}


function isCallsignChangeLog(row) {
    if (String(row.operation_type || "").toUpperCase() === "CALLSIGN_CHANGE") return true;
    const oldRank = String(row.old_rank || "").trim().toLowerCase();
    const newRank = String(row.new_rank || "").trim().toLowerCase();
    const oldCallsign = String(row.old_callsign || "").trim().toUpperCase();
    const newCallsign = String(row.new_callsign || "").trim().toUpperCase();
    return Boolean(oldRank && newRank && oldRank === newRank && oldCallsign && newCallsign && oldCallsign !== newCallsign);
}


function matchesLogCategory(row) {
    if (currentLogType === "callsign") {
        return isCallsignChangeLog(row);
    }

    if (currentLogType === "promotion") {
        const filter = $("#promotionFilter")?.value || "all";
        const isCallsignChange = isCallsignChangeLog(row);
        if (filter === "callsign") return isCallsignChange;
        if (filter === "all") return true;
        if (isCallsignChange) return false;
        const oldLevel = promotionRankLevel(row.old_rank);
        const newLevel = promotionRankLevel(row.new_rank);
        if (oldLevel === undefined || newLevel === undefined || oldLevel === newLevel) return false;
        return filter === "promotion" ? newLevel > oldLevel : newLevel < oldLevel;
    }

    if (currentLogType === "training") {
        const filter = $("#trainingFilter")?.value || "all";
        if (filter === "all") return true;
        const training = String(row.training_name || "").trim().toLowerCase().replace(/\s+/g, "_");
        return training === filter;
    }

    if (currentLogType === "note") {
        const filter = $("#noteFilter")?.value || "all";
        return filter === "all" || String(row.action || "").trim().toLowerCase() === filter;
    }

    return true;
}


// ============================================================
// MEMBERS LOG SEARCH / RENDER
// ============================================================

function renderMembersLog() {

    const container = currentLogType === "instructor" ? $("#instructorLogTable") : $("#membersLogTable");

    if (!container) {
        return;
    }


    const searchElement = currentLogType === "instructor" ? $("#instructorLogSearch") : $("#membersLogSearch");

    const search =
        (
            searchElement
                ? searchElement.value
                : ""
        )
            .trim()
            .toLowerCase();


    const rows =
        currentLogRows.filter(r => {

            if (!matchesLogCategory(r)) {
                return false;
            }

            if (!search) {
                return true;
            }


            let values = [];


            if (["promotion", "callsign"].includes(currentLogType)) {

                values = [
                    r.operation_type,
                    r.promo_date,
                    r.log_type,
                    r.callsign,
                    r.old_rank,
                    r.new_rank,
                    r.old_callsign,
                    r.new_callsign,
                    r.promoted_by
                ];

            }


            else if (currentLogType === "termination") {

                values = [
                    r.termination_date,
                    r.callsign,
                    r.member_name,
                    r.rank,
                    r.terminated_by,
                    r.reason
                ];

            }


            else if (["training", "training_time"].includes(currentLogType)) {

                values = [
                    r.log_date,
                    r.callsign,
                    r.member_name,
                    r.training_name,
                    r.action,
                    r.changed_by,
                    r.previous_time,
                    r.new_time
                ];

            }


            else if (currentLogType === "exam") {

                values = [
                    r.log_date,
                    r.callsign,
                    r.member_name,
                    r.exam_name,
                    r.action,
                    r.changed_by
                ];

            }


            else if (currentLogType === "note") {

                values = [
                    r.log_date,
                    r.callsign,
                    r.member_name,
                    r.action,
                    r.note,
                    r.changed_by
                ];

            }

            else if (currentLogType === "activity") {
                values = [
                    r.changed_at,
                    r.callsign,
                    r.member_name,
                    r.old_status,
                    r.new_status,
                    r.changed_by
                ];
            }

            else if (currentLogType === "instructor") {
                values = [r.log_date, r.callsign, r.member_name, r.instructor_type, r.action, r.changed_by];
            }

            else if (currentLogType === "loi") {
                values = [r.log_date, r.loi_type, r.test_percent, r.callsign, r.member_name, r.action, r.changed_by];
            }


            return values.some(
                value =>
                    String(value ?? "")
                        .toLowerCase()
                        .includes(search)
            );

        });


    if (!rows.length) {

        container.innerHTML =
            empty(
                search
                    ? "No matching records found."
                    : currentLogType === "activity"
                        ? "No activity status changes yet."
                        : currentLogType === "callsign"
                            ? "No callsign changes yet."
                        : "No records found."
            );

        return;
    }


    // ========================================================
    // PROMOTION LOG
    // ========================================================

    if (["promotion", "callsign"].includes(currentLogType)) {

        container.innerHTML = `

            <table>

                <thead>

                    <tr>

                        <th>Date</th>
                        <th>Type</th>
                        <th>Callsign</th>
                        <th>Member Name</th>
                        <th>Old Rank</th>
                        <th>New Rank</th>
                        <th>Old Callsign</th>
                        <th>New Callsign</th>
                        <th>Changed By</th>

                    </tr>

                </thead>

                <tbody>

                    ${rows.map(r => `

                        <tr>

                            <td>
                                ${esc(r.promo_date)}
                            </td>

                            <td>
                                <b>
                                    ${isCallsignChangeLog(r)
                                        ? "CALLSIGN CHANGE"
                                        : esc(r.log_type || "RANK CHANGE")}
                                </b>
                            </td>

                            <td>
                                ${esc(r.callsign)}
                            </td>

                            <td>
                                ${esc(r.member_name)}
                            </td>

                            <td>
                                ${esc(r.old_rank)}
                            </td>

                            <td>
                                ${esc(r.new_rank)}
                            </td>

                            <td>
                                ${esc(r.old_callsign)}
                            </td>

                            <td>
                                ${esc(r.new_callsign)}
                            </td>

                            <td>
                                ${esc(r.promoted_by)}
                            </td>

                        </tr>

                    `).join("")}

                </tbody>

            </table>

        `;

        return;
    }


    // ========================================================
    // TERMINATION LOG
    // ========================================================

    if (currentLogType === "termination") {

        container.innerHTML = `

            <table>

                <thead>

                    <tr>

                        <th>Date</th>
                        <th>Callsign</th>
                        <th>Member</th>
                        <th>Rank</th>
                        <th>Terminated By</th>
                        <th>Reason</th>

                    </tr>

                </thead>

                <tbody>

                    ${rows.map(r => `

                        <tr>

                            <td>
                                ${esc(
                                    r.termination_date
                                )}
                            </td>

                            <td>
                                ${esc(r.callsign)}
                            </td>

                            <td>
                                ${esc(r.member_name)}
                            </td>

                            <td>
                                ${esc(r.rank)}
                            </td>

                            <td>
                                ${esc(r.terminated_by)}
                            </td>

                            <td>
                                ${esc(r.reason)}
                            </td>

                        </tr>

                    `).join("")}

                </tbody>

            </table>

        `;

        return;
    }


    // ========================================================
    // TRAINING LOG
    // ========================================================

    if (currentLogType === "training") {

        container.innerHTML = `

            <table>

                <thead>

                    <tr>

                        <th>Date</th>
                        <th>Callsign</th>
                        <th>Member</th>
                        <th>Training</th>
                        <th>Action</th>
                        <th>Changed By</th>

                    </tr>

                </thead>

                <tbody>

                    ${rows.map(r => `

                        <tr>

                            <td>
                                ${esc(r.log_date)}
                            </td>

                            <td>
                                ${esc(r.callsign)}
                            </td>

                            <td>
                                ${esc(r.member_name)}
                            </td>

                            <td>
                                ${esc(
                                    formatRequirementText(
                                        r.training_name
                                    )
                                )}
                            </td>

                            <td>
                                <b>
                                    ${esc(r.action)}
                                </b>
                            </td>

                            <td>
                                ${esc(r.changed_by)}
                            </td>

                        </tr>

                    `).join("")}

                </tbody>

            </table>

        `;

        return;
    }


    // ========================================================
    // EXAM LOG
    // ========================================================

    if (currentLogType === "training_time") {
        container.innerHTML = `<table><thead><tr><th>Date</th><th>Callsign</th><th>Member</th><th>Previous Time</th><th>New Time</th><th>Changed By</th></tr></thead><tbody>${rows.map(r => `
            <tr><td>${esc(r.log_date)}</td><td>${esc(r.callsign)}</td><td>${esc(r.member_name)}</td><td>${esc(r.previous_time || "—")}</td><td>${esc(r.new_time || "—")}</td><td>${esc(r.changed_by)}</td></tr>
        `).join("")}</tbody></table>`;
        return;
    }


    if (currentLogType === "exam") {

        container.innerHTML = `

            <table>

                <thead>

                    <tr>

                        <th>Date</th>
                        <th>Callsign</th>
                        <th>Member</th>
                        <th>Exam</th>
                        <th>Action</th>
                        <th>Changed By</th>

                    </tr>

                </thead>

                <tbody>

                    ${rows.map(r => `

                        <tr>

                            <td>
                                ${esc(r.log_date)}
                            </td>

                            <td>
                                ${esc(r.callsign)}
                            </td>

                            <td>
                                ${esc(r.member_name)}
                            </td>

                            <td>
                                ${esc(
                                    formatRequirementText(
                                        r.exam_name
                                    )
                                )}
                            </td>

                            <td>
                                <b>
                                    ${esc(r.action)}
                                </b>
                            </td>

                            <td>
                                ${esc(r.changed_by)}
                            </td>

                        </tr>

                    `).join("")}

                </tbody>

            </table>

        `;

        return;
    }


    // ========================================================
    // NOTE LOG
    // ========================================================

    if (currentLogType === "note") {

        container.innerHTML = `

            <table>

                <thead>

                    <tr>

                        <th>Date</th>
                        <th>Callsign</th>
                        <th>Member</th>
                        <th>Action</th>
                        <th>Note</th>
                        <th>Changed By</th>

                    </tr>

                </thead>

                <tbody>

                    ${rows.map(r => `

                        <tr>

                            <td>
                                ${esc(r.log_date)}
                            </td>

                            <td>
                                ${esc(r.callsign)}
                            </td>

                            <td>
                                ${esc(r.member_name)}
                            </td>

                            <td>
                                <b>
                                    ${esc(r.action)}
                                </b>
                            </td>

                            <td>
                                ${esc(
                                    r.note || ""
                                ).replace(
                                    /\n/g,
                                    "<br>"
                                )}
                            </td>

                            <td>
                                ${esc(r.changed_by)}
                            </td>

                        </tr>

                    `).join("")}

                </tbody>

            </table>

        `;

        return;
    }


    if (currentLogType === "activity") {
        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Callsign</th>
                        <th>Member</th>
                        <th>Previous Status</th>
                        <th>New Status</th>
                        <th>Changed By</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr>
                            <td>${esc(r.changed_at)}</td>
                            <td>${esc(r.callsign)}</td>
                            <td>${esc(r.member_name)}</td>
                            <td>${esc(r.old_status)}</td>
                            <td>${esc(r.new_status)}</td>
                            <td>${esc(r.changed_by)}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        `;
        return;
    }


    if (currentLogType === "instructor") {
        container.innerHTML = `
            <table>
                <thead><tr><th>Date</th><th>Callsign</th><th>Member</th><th>Type</th><th>Action</th><th>Changed By</th></tr></thead>
                <tbody>${rows.map(r => `
                    <tr>
                        <td>${esc(r.log_date || r.created_at || "—")}</td>
                        <td>${esc(r.callsign)}</td>
                        <td>${esc(r.member_name)}</td>
                        <td>${esc(r.instructor_type)}</td>
                        <td><b>${esc(r.action)}</b></td>
                        <td>${esc(r.changed_by)}</td>
                    </tr>
                `).join("")}</tbody>
            </table>
        `;
        return;
    }

    if (currentLogType === "loi") {
        container.innerHTML = `
            <table>
                <thead><tr><th>Date</th><th>LOI</th><th>Callsign</th><th>Member</th><th>% on test</th><th>Result / Action</th><th>By</th></tr></thead>
                <tbody>${rows.map(r => `
                    <tr>
                        <td>${esc(r.log_date || "")}</td><td>${esc(r.loi_type || "")} LOI</td><td>${esc(r.callsign || "")}</td>
                        <td>${esc(r.member_name || "")}</td><td>${r.test_percent === "" || r.test_percent == null ? "—" : `${esc(r.test_percent)}%`}</td>
                        <td><strong>${esc(r.action || "")}</strong></td><td>${esc(r.changed_by || "")}</td>
                    </tr>`).join("")}</tbody>
            </table>`;
        return;
    }
}


// ============================================================
// KEEP COMPATIBILITY WITH OLD CALLS
// ============================================================

async function loadPromotions() {

    return loadMembersLog(
        "promotion"
    );
}


// ============================================================
// PROFILE
// ============================================================

let profileLoading = false;
let activeProfileMember = null;
let profileRenderToken = 0;
let currentUserIsAdmin = false;
let currentUserIsOperation = String(window.lvfrCachedUser?.()?.role || "").toLowerCase() === "admin";
let currentUserCanFullSync = false;
let currentUserPermissions = {};
let currentUserPermissionOverrides = {};
function hasIndividualPermission(key) { return currentUserPermissionOverrides?.[key] === true; }
function currentUserHasPermission(key) { return currentUserIsOperation || currentUserPermissions?.[key] === true; }
function canManageTraining(type) {
    const capability = type === "HERT" ? "training_hert_manage" : "training_fort_manage";
    return currentUserIsOperation || currentUserPermissions?.[capability] === true && (currentUserIsAdmin || currentInstructorTypes.includes(type) || hasIndividualPermission(capability));
}
let currentUserAccountId = String(window.lvfrCachedUser?.()?.account_id || window.lvfrCachedUser?.()?.id || "");
let currentInstructorTypes = [];
let currentUserCallsign = String(window.lvfrCachedUser?.()?.callsign || "").trim().toUpperCase();
let currentUserIsCommand = false;


async function profile(
    cs,
    force = false,
    providedMember = null
) {

    const renderToken = ++profileRenderToken;

    if (
        profileLoading &&
        !force
    ) {
        return;
    }

    profileLoading = true;

    try {
        const normalizedCallsign = String(cs || "").trim().toUpperCase();
        // A member profile must come from the current D1 record. The roster
        // cache is useful for the table, but can lag a just-completed Sheet
        // color sync and briefly show an obsolete profile on reopen.
        let m;
        if (providedMember) {
            m = Array.isArray(providedMember.trainings)
                ? Object.assign({}, providedMember, {
                    trainings: [
                        ...(providedMember.has_basic_firefighting ? ["basic_firefighting"] : []),
                        ...(providedMember.has_advanced_firefighting ? ["advanced_firefighting"] : [])
                    ],
                    exams: providedMember.has_supervisor_exam ? ["supervisor_exam"] : [],
                    hert: Boolean(providedMember.has_hert)
                })
                : Object.assign({}, providedMember, {
                    trainings: [
                        ...(providedMember.has_basic_firefighting ? ["basic_firefighting"] : []),
                        ...(providedMember.has_advanced_firefighting ? ["advanced_firefighting"] : [])
                    ],
                    exams: providedMember.has_supervisor_exam ? ["supervisor_exam"] : [],
                    hert: Boolean(providedMember.has_hert),
                    ...calculateMemberEligibility(providedMember)
                });
        } else {
            // Bypass the short-lived API response cache on every profile open.
            m = await api("/api/member/" + encodeURIComponent(normalizedCallsign) + "?_fresh=" + Date.now());
            if (renderToken !== profileRenderToken) return;
            memberCache.set(normalizedCallsign, m);
        }

        activeProfileMember = m;


        const trainings =
            Array.isArray(m.trainings)
                ? m.trainings
                : [];


        const exams =
            Array.isArray(m.exams)
                ? m.exams
                : [];


        const modalContent =
            $("#modalContent");

        if (!modalContent) {
            return;
        }


        modalContent.innerHTML = `

            <div class="profile-title">

                <h2>

                    ${esc(m.name)}

                    <small>
                        ${esc(m.callsign)}
                    </small>

                </h2>


                <div class="grid">


                    <div class="card">

                        <b>Rank</b>

                        <div>
                            ${esc(m.rank)}
                        </div>

                    </div>


                    <div class="card">

                        <b>Days in Rank</b>

                        <div>
                            ${esc(m.days_in_rank)}
                        </div>

                    </div>


                    <div class="card">

                        <b>Activity</b>

                        <div>
                            ${status(m.activity)}
                        </div>

                    </div>


                    <div class="card">

                        <b>HERT</b>

                        <div>

                            ${
                                m.hert

                                    ? `
                                        <span class="badge active-status">
                                            Certified
                                        </span>
                                    `

                                    : `
                                        <span class="badge terminate-status">
                                            Not Certified
                                        </span>
                                    `
                            }

                        </div>

                    </div>


                    ${currentUserIsCommand ? `<div class="card">

                        <b>Instructor</b>

                        <div>

                            ${m.instructor_type
                                ? `<span class="badge active-status">${esc(m.instructor_type)} Instructor</span>`
                                : `<span class="badge terminate-status">Not an Instructor</span>`
                            }

                        </div>

                    </div>` : ""}


                    <div class="card">

                        <b>Trainings</b>

                        <div>

                            ${trainings.length === 0
                                ? `<span class="badge terminate-status">No Training</span>`
                                : `${requirementStatus(
                                    trainings,
                                    "Basic_Firefighting",
                                    "Basic FORT"
                                )}${requirementStatus(
                                    trainings,
                                    "Advanced_Firefighting",
                                    "Advanced FORT"
                                )}`
                            }

                        </div>

                    </div>


                    <div class="card">

                        <b>Exams</b>

                        <div>

                            ${exams.some(exam => String(exam ?? "").toLowerCase() === "supervisor_exam")
                                ? requirementStatus(exams, "Supervisor_exam", "Supervisor Exam")
                                : `<span class="badge terminate-status">No Supervisor Exam</span>`
                            }

                        </div>

                    </div>


                </div>


                <p>

                    ${
                        m.eligible

                            ? `
                                <span class="ok-text">

                                    Eligible for
                                    ${esc(m.next_rank)}

                                </span>
                            `

                            : formatRequirementText(
                                esc(
                                    m.eligibility_reason
                                )
                            )
                    }

                </p>


                <div class="card">

                    <b>Notes</b>

                    <div>

                        ${esc(
                            m.notes || "None"
                        ).replace(
                            /\n/g,
                            "<br>"
                        )}

                    </div>

                </div>


                <div class="actions">


                    ${currentUserHasPermission("promotion_manage") && (currentUserIsAdmin && !m.do_not_promote || (m.eligible && String(m.rank || "").trim().toLowerCase() === "emt" && String(m.next_rank || "").trim().toLowerCase() === "aemt")) ? `<button
                        type="button"
                        class="primary"
                        data-action="promote"
                        data-callsign="${esc(m.callsign)}"
                    >
                        Promote
                    </button>
                    ` : ""}

                    ${currentUserHasPermission("do_not_promote_manage") ? `<button type="button" class="${m.do_not_promote ? "danger" : ""}"
                        data-action="do-not-promote" data-blocked="${m.do_not_promote ? "false" : "true"}"
                        data-callsign="${esc(m.callsign)}">
                        ${m.do_not_promote ? "Remove from Do not Promote" : "Add to Do not Promote"}
                    </button>` : ""}


                    ${currentUserHasPermission("profile_view") ? `<button
                        type="button"
                        data-action="open-manage"
                        data-callsign="${esc(m.callsign)}"
                    >
                        Manage
                    </button>` : ""}


                </div>


            </div>

        `;


        const modal =
            $("#modal");

        if (modal) {

            modal.classList.remove(
                "hidden"
            );
        }

    } catch (e) {
        toast(
            e.message
        );

    } finally {

        profileLoading = false;

    }
}


function closeModal() {

    profileRenderToken++;
    activeProfileMember = null;

    const modal =
        $("#modal");

    if (modal) {

        modal.classList.add(
            "hidden"
        );
    }
}

// ============================================================
// MANAGE
// ============================================================

function openManage(cs) {

    profileRenderToken++;

    const existingNote =
        activeProfileMember?.callsign === cs
            ? String(activeProfileMember.notes || "")
            : "";
    const hasNote = Boolean(existingNote.trim());
    const currentActivity =
        activeProfileMember?.callsign === cs
            ? String(activeProfileMember.activity || "Active").trim()
            : "Active";
    const rankDateValue =
        activeProfileMember?.callsign === cs
            ? String(activeProfileMember.rank_assigned_date || "")
            : "";
    const rankDateMatch = rankDateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const currentRankDate = rankDateMatch
        ? `${rankDateMatch[2]}/${rankDateMatch[3]}/${rankDateMatch[1]}`
        : rankDateValue;
    const rankNames = Array.isArray(config.ranks) ? config.ranks : [];
    const currentRankIndex = rankNames.findIndex(
        rank => String(rank).trim().toLowerCase() === String(activeProfileMember?.rank || "").trim().toLowerCase()
    );
    const leadParamedicIndex = rankNames.findIndex(
        rank => String(rank).trim().toLowerCase() === "lead paramedic"
    );
    const showRankDate = currentUserHasPermission("rank_date_manage") && (currentRankIndex < 0 || leadParamedicIndex < 0 || currentRankIndex > leadParamedicIndex);

    $("#modalContent").innerHTML = `

        <h2>
            Manage ${esc(cs)}
        </h2>


        <div class="form">


            <!-- =================================================
                 TRAINING / ACTIVITY
                 ================================================= -->

            <div class="form-row manage-main-row">


                <!-- TRAINING -->

                <label id="trainingField">

                    Training

                    <select id="training" data-action="update-training-permission">

                        ${config.trainings.map(
                            x => {
                                const label = String(x).trim().toLowerCase() === "hert" ? "HERT" : esc(x);
                                return `<option value="${esc(x)}">${label}</option>`;
                            }
                        ).join("")}

                    </select>

                </label>


                <!-- ACTIVITY -->

                ${currentUserHasPermission("activity_manage") ? `<label>

                    Activity

                    <select id="activity">

                        ${config.activities.map(
                            x => {
                                const selected = String(x).trim().toLowerCase() === currentActivity.toLowerCase()
                                    ? " selected"
                                    : "";
                                return `<option${selected}>${esc(x)}</option>`;
                            }
                        ).join("")}

                    </select>

                </label>` : ""}


            </div>


            <!-- =================================================
                 TRAINING / ACTIVITY BUTTONS
                 ================================================= -->

            <div class="manage-action-row">


                <!-- LEFT COLUMN : TRAINING -->

                <div class="training-actions">

                    <button
                        type="button"
                        id="addTrainingButton"
                        data-action="training-add" data-callsign="${esc(cs)}"
                    >
                        Add Training
                    </button>


                    <button
                        type="button"
                        id="deleteTrainingButton"
                        data-action="training-remove" data-callsign="${esc(cs)}"
                    >
                        Delete Training
                    </button>

                </div>


                <!-- RIGHT COLUMN : ACTIVITY -->

                <div class="activity-actions" ${currentUserHasPermission("activity_manage") ? "" : "hidden"}>

                    <button
                        type="button"
                        data-action="activity" data-callsign="${esc(cs)}"
                    >
                        Set Activity
                    </button>

                </div>


            </div>


            <hr>


            <!-- =================================================
                 EXAM
                 ================================================= -->

            ${currentUserHasPermission("exam_manage") ? `
            <div class="form-row">


                <label>

                    Exam

                    <select id="exam">

                        <option>
                            Supervisor Exam
                        </option>

                    </select>

                </label>


                <span></span>


            </div>


            <div class="actions">


                <button
                    type="button"
                    data-action="exam-add" data-callsign="${esc(cs)}"
                >
                    Add Exam
                </button>


                <button
                    type="button"
                    data-action="exam-remove" data-callsign="${esc(cs)}"
                >
                    Delete Exam
                </button>


            </div>
            ` : ""}


            ${currentUserHasPermission("instructor_manage") ? `
                <hr>
                <div class="instructor-admin-controls">
                    <label>
                        Instructor
                        <select id="instructorType">
                            <option value="HERT" ${String(activeProfileMember?.instructor_type || "").includes("HERT") ? "selected" : ""}>HERT</option>
                            <option value="FORT" ${String(activeProfileMember?.instructor_type || "").includes("FORT") ? "selected" : ""}>FORT</option>
                        </select>
                    </label>
                    <div class="actions">
                        <button type="button" data-action="instructor-add" data-callsign="${esc(cs)}">Add Instructor</button>
                        <button type="button" data-action="instructor-remove" data-callsign="${esc(cs)}">Delete Instructor</button>
                    </div>
                </div>
            ` : ""}


            ${currentUserHasPermission("notes_manage") ? `<hr>


            <!-- =================================================
                 NOTE
                 ================================================= -->

            <label>

                Note action

                <select id="noteAction">

                    <option value="Add" ${hasNote ? "disabled" : "selected"}>Add</option>
                    <option value="Edit" ${hasNote ? "selected" : "disabled"}>Edit</option>
                    <option value="Delete" ${hasNote ? "" : "disabled"}>Delete</option>

                </select>

            </label>


            <textarea
                id="note"
                placeholder="Note"
            >${esc(existingNote)}</textarea>


            <button
                type="button"
                data-action="note" data-callsign="${esc(cs)}"
            >
                Save Note
            </button>` : ""}


            ${showRankDate ? `
                <hr>

                <!-- RANK DATE -->
                <label>
                    Rank date
                    <input
                        id="date"
                        value="${esc(currentRankDate)}"
                        placeholder="MM/DD/YYYY"
                    >
                </label>

                <button
                    type="button"
                    data-action="date" data-callsign="${esc(cs)}"
                >
                    Change Date
                </button>

                <hr>
            ` : `<hr>`}


            <!-- =================================================
                 RANK / CALLSIGN
                 ================================================= -->

            <div class="actions">


                ${currentUserHasPermission("rank_manage") || currentUserHasPermission("callsign_manage") ? `<button
                    type="button"
                    data-action="rank-tools" data-callsign="${esc(cs)}"
                >
                    Rank / Callsign Tools
                </button>` : ""}


                ${currentUserHasPermission("termination_manage") ? `<button
                    type="button"
                    class="danger"
                    data-action="terminate" data-callsign="${esc(cs)}"
                >
                    Terminate
                </button>` : ""}


            </div>


        </div>

    `;

    updateTrainingPermission();
}


async function setInstructor(cs, assigned) {
    const instructorType = $("#instructorType")?.value || "";
    try {
        const result = await api(`/api/member/${encodeURIComponent(cs)}/instructor`, {
            method: "POST",
            body: JSON.stringify({ instructor_type: instructorType, assigned })
        });
        toast(result.changed
            ? `${instructorType} Instructor ${assigned ? "added" : "removed"}.`
            : `No change: member is already ${assigned ? "an" : "not an"} ${instructorType} Instructor.`);
        if (result.changed) profile(cs, true);
    } catch (error) {
        if (isBackgroundPending(error)) return;
        toast(error.message);
    }
}


function updateTrainingPermission() {
    const selected = String($("#training")?.value || "").trim().toLowerCase() === "hert" ? "HERT" : "FORT";
    const capability = selected === "HERT" ? "training_hert_manage" : "training_fort_manage";
    const allowed = canManageTraining(selected);
    const trainingField = $("#trainingField");
    if (trainingField) trainingField.style.display = "";
    ["#addTrainingButton", "#deleteTrainingButton"].forEach(selector => {
        const button = $(selector);
        if (!button) return;
        button.style.display = allowed ? "" : "none";
        button.title = allowed ? "" : `Your account does not have ${selected} Instructor access.`;
    });
    const trainingActions = $("#addTrainingButton")?.closest(".training-actions");
    if (trainingActions) trainingActions.style.display = allowed ? "" : "none";
}

// ============================================================
// TRAINING
// ============================================================

async function training(
    cs,
    remove
) {

    const trainingName = String($("#training")?.value || "").trim();
    const requiredType = trainingName.toLowerCase() === "hert" ? "HERT" : "FORT";
    const capability = requiredType === "HERT" ? "training_hert_manage" : "training_fort_manage";
    if (!canManageTraining(requiredType)) {
        toast(`Your account does not have ${requiredType} Instructor access.`);
        return;
    }

    try {

        const trainingElement =
            $("#training");

        const r =
            await api(
                "/api/training",
                {
                    method: "POST",

                    body: JSON.stringify({
                        callsign: cs,
                        training:
                            trainingElement
                                ? trainingElement.value
                                : "",
                        remove: remove
                    })
                }
            );


        let message =
            r.message;


        if (!message) {

            if (
                r.status ===
                "training_not_exist"
            ) {

                message =
                    "Training doesn't exist";

            } else if (
                r.status ===
                "already_completed"
            ) {

                message =
                    "Already certified";

            } else if (
                r.status ===
                "already_certified"
            ) {

                message =
                    "Already certified";

            } else if (
                r.status ===
                "already_removed"
            ) {

                message =
                    "Training already removed";

            } else if (
                r.status ===
                "removed"
            ) {

                message =
                    "Training removed";

            } else if (
                r.status ===
                "added"
            ) {

                message =
                    "Training added";

            } else {

                message =
                    r.status ||
                    "Request completed";
            }
        }


        toast(
            message
        );


        if (
            r.changed === true
        ) {

            await profile(cs);

            await loadMembersLog(
                "training"
            );
        }


    } catch (e) {
        if (isBackgroundPending(e)) return;
        toast(
            e.message
        );
    }
}


// ============================================================
// EXAM
// ============================================================

async function examChange(
    cs,
    remove
) {

    try {

        const r =
            await api(
                "/api/exam",
                {
                    method: "POST",

                    body: JSON.stringify({
                        callsign: cs,
                        remove: remove
                    })
                }
            );


        let message =
            r.message;


        if (!message) {

            if (
                r.status ===
                "exam_not_exist"
            ) {

                message =
                    "Exam doesn't exist";

            } else if (
                r.status ===
                "already_passed"
            ) {

                message =
                    "Already passed the exam";

            } else if (
                r.status ===
                "already_removed"
            ) {

                message =
                    "Exam already removed";

            } else if (
                r.status ===
                "removed"
            ) {

                message =
                    "Exam removed";

            } else if (
                r.status ===
                "added"
            ) {

                message =
                    "Exam added";

            } else {

                message =
                    r.status ||
                    "Request completed";
            }
        }


        toast(
            message
        );


        if (
            r.changed === true
        ) {

            await profile(cs);

            await loadMembersLog(
                "exam"
            );
        }


    } catch (e) {
        if (isBackgroundPending(e)) return;
        toast(
            e.message
        );
    }
}


// ============================================================
// ACTIVITY
// ============================================================

async function activity(cs) {

    try {

        const activityElement =
            $("#activity");

        const selectedActivity =
            activityElement
                ? activityElement.value
                : "";


        const r =
            await api(
                "/api/activity",
                {
                    method: "POST",

                    body: JSON.stringify({
                        callsign: cs,
                        activity:
                            selectedActivity
                    })
                }
            );


        let message =
            r.message;


        if (!message) {

            if (
                r.status ===
                "already_current"
            ) {

                message =
                    `Already ${selectedActivity}`;

            } else if (
                r.status ===
                "changed"
            ) {

                message =
                    `Activity changed to ${selectedActivity}`;

            } else {

                message =
                    r.status ||
                    "Request completed";
            }
        }


        toast(
            message
        );


        if (
            r.changed === true
        ) {

            await loadMembers();

            await profile(
                cs,
                true
            );
        }


    } catch (e) {
        if (isBackgroundPending(e)) return;

        toast(
            e.message
        );
    }
}


// ============================================================
// NOTE
// ============================================================

async function note(cs) {

    try {

        const noteAction =
            $("#noteAction");

        const noteElement =
            $("#note");

        if (!noteAction || !noteElement) {
            throw new Error("Note controls are unavailable");
        }

        if (noteAction.value === "Add" && activeProfileMember?.notes?.trim()) {
            throw new Error("This member already has a note. Choose Edit or Delete.");
        }
        if (["Edit", "Delete"].includes(noteAction.value) && !activeProfileMember?.notes?.trim()) {
            throw new Error("This member has no note to edit or delete. Choose Add.");
        }


        await api(
            "/api/note",
            {
                method: "POST",

                body: JSON.stringify({

                    callsign: cs,

                    action:
                        noteAction
                            ? noteAction.value
                            : "Add",

                    note:
                        noteElement
                            ? noteElement.value
                            : "",

                    promoted_by:
                        "Web Commander"
                })
            }
        );


        toast(
            "Note updated"
        );


        await loadMembersLog(
            "note"
        );


        await profile(
            cs,
            true
        );


    } catch (e) {
        if (isBackgroundPending(e)) return;

        toast(
            e.message
        );
    }
}


// ============================================================
// DATE
// ============================================================

async function dateChange(cs) {

    try {

        const dateElement =
            $("#date");


        await api(
            "/api/date",
            {
                method: "POST",

                body: JSON.stringify({

                    callsign: cs,

                    date_str:
                        dateElement
                            ? dateElement.value
                            : ""
                })
            }
        );


        toast(
            "Date updated"
        );


        await profile(
            cs,
            true
        );


    } catch (e) {
        if (isBackgroundPending(e)) return;

        toast(
            e.message
        );
    }
}


// ============================================================
// NORMAL PROMOTION
// ============================================================

async function promote(cs) {

    if (
        !confirm(
            "Promote this member using the normal eligibility rules?"
        )
    ) {
        return;
    }


    try {

        const r =
            await api(
                "/api/promote",
                {
                    method: "POST",

                    body: JSON.stringify({
                        callsign: cs,
                        promoted_by:
                            "Web Commander"
                    })
                }
            );


        toast(
            `Promoted to ${r.new_rank} — ${r.new_callsign}`
        );


        closeModal();


        await Promise.all([

            loadMembers(),

            loadEligible(),

            loadMembersLog(
                "promotion"
            )

        ]);


    } catch (e) {
        if (isBackgroundPending(e)) return;
        toast(
            e.message
        );
    }
}


// ============================================================
// TERMINATION
// ============================================================

async function terminate(cs) {

    if (
        !confirm(
            `Terminate ${cs}? This clears the member's active data.`
        )
    ) {
        return;
    }


    const reason =
        prompt(
            "Termination reason (optional):",
            ""
        ) ?? "";


    try {

        await api(
            "/api/terminate",
            {
                method: "POST",

                body: JSON.stringify({

                    callsign: cs,

                    note: reason,

                    promoted_by:
                        "Web Commander"
                })
            }
        );


        toast(
            "Member terminated"
        );


        closeModal();


        await Promise.all([

            loadMembers(),

            loadInactive(),

            loadMembersLog(
                "termination"
            )

        ]);


    } catch (e) {
        if (isBackgroundPending(e)) return;
        toast(
            e.message
        );
    }
}


// ============================================================
// RANK / CALLSIGN TOOLS
// ============================================================

function openRankTools(cs) {

    if (!currentUserHasPermission("rank_manage")) {
        $("#modalContent").innerHTML = `
            <h2>Change callsign for ${esc(cs)}</h2>
            <label>
                New callsign
                <input id="newcs" value="${esc(cs)}" placeholder="New callsign">
            </label>
            <button type="button" class="primary" data-action="change-callsign" data-callsign="${esc(cs)}">Change Callsign</button>
        `;
        return;
    }

    const currentMember = memberCache.get(String(cs || "").trim().toUpperCase()) ||
        (activeProfileMember?.callsign?.toUpperCase() === String(cs || "").trim().toUpperCase() ? activeProfileMember : null);
    const currentRank = String(currentMember?.rank || "").trim().toLowerCase();

    $("#modalContent").innerHTML = `

        <h2>
            Rank / Callsign Tools
        </h2>


        <div class="form">


            <label>

                New callsign

                <input
                    id="newcs"
                    value="${esc(cs)}"
                    placeholder="New callsign"
                >

            </label>


            <button
                type="button"
                data-action="change-callsign" data-callsign="${esc(cs)}"
            >
                Change Callsign
            </button>


            <hr>


            <label>

                New rank

                <select id="newrank">

                    ${config.ranks.map(x => {
                        const selected = String(x).trim().toLowerCase() === currentRank ? " selected" : "";
                        return `<option${selected}>${esc(x)}</option>`;
                    }).join("")}

                </select>

            </label>


            <div class="actions">


                <button
                    type="button"
                    class="primary"
                    data-action="force-promote" data-callsign="${esc(cs)}"
                >
                    Force Promote
                </button>


                <button
                    type="button"
                    class="warn"
                    data-action="demote" data-callsign="${esc(cs)}"
                >
                    Demote
                </button>


                <button
                    type="button"
                    data-action="change-rank" data-callsign="${esc(cs)}"
                >
                    Change Rank
                </button>


            </div>


        </div>

    `;
}


// ============================================================
// CHANGE CALLSIGN
// ============================================================

async function changeCS(
    cs,
    force = false
) {

    try {

        const newcsElement =
            $("#newcs");

        const r =
            await api(
                "/api/change-callsign",
                {
                    method: "POST",

                    body: JSON.stringify({

                        callsign: cs,

                        new_callsign:
                            newcsElement
                                ? newcsElement.value
                                : "",

                        force: force
                    })
                }
            );


        toast(
            "Callsign changed to " +
            r.new_callsign
        );


        closeModal();


        await Promise.all([

            loadMembers(),

            loadMembersLog(
                "callsign"
            )

        ]);


    } catch (e) {
        if (isBackgroundPending(e)) return;

        const selectedCallsignRank = rankForCallsign(newcsElement?.value || "");
        if (currentUserIsAdmin && selectedCallsignRank && /belongs to a different rank/i.test(e.message || "") && confirm(
            `This callsign corresponds to ${selectedCallsignRank}. Continue and change the member's rank too?`
        )) return changeCS(cs, true);


        toast(
            e.message
        );
    }
}


// ============================================================
// FORCE PROMOTE
// ============================================================

async function forcePromote(cs) {

    try {

        const newrankElement =
            $("#newrank");

        const r =
            await api(
                "/api/force-promote",
                {
                    method: "POST",

                    body: JSON.stringify({

                        callsign: cs,

                        new_rank:
                            newrankElement
                                ? newrankElement.value
                                : "",

                    })
                }
            );


        toast(
            `Changed to ${r.new_rank} — ${r.new_callsign}`
        );


        closeModal();


        await Promise.all([

            loadMembers(),

            loadMembersLog(
                "promotion"
            )

        ]);


    } catch (e) {
        if (isBackgroundPending(e)) return;
        toast(
            e.message
        );
    }
}


// ============================================================
// DEMOTION
// ============================================================

async function demote(cs) {

    try {

        const newrankElement =
            $("#newrank");

        const r =
            await api(
                "/api/demote",
                {
                    method: "POST",

                    body: JSON.stringify({

                        callsign: cs,

                        new_rank:
                            newrankElement
                                ? newrankElement.value
                                : "",

                    })
                }
            );


        toast(
            `Demoted to ${r.new_rank} — ${r.new_callsign}`
        );


        closeModal();


        await Promise.all([

            loadMembers(),

            loadMembersLog(
                "promotion"
            )

        ]);


    } catch (e) {
        if (isBackgroundPending(e)) return;
        toast(
            e.message
        );
    }
}


// ============================================================
// CHANGE RANK
// ============================================================

async function changeRank(cs) {

    try {

        const newrankElement =
            $("#newrank");

        const r =
            await api(
                "/api/change-rank",
                {
                    method: "POST",

                    body: JSON.stringify({

                        callsign: cs,

                        new_rank:
                            newrankElement
                                ? newrankElement.value
                                : "",

                    })
                }
            );


        toast(
            `Changed to ${r.new_rank} — ${r.new_callsign}`
        );


        closeModal();


        await Promise.all([

            loadMembers(),

            loadMembersLog(
                "promotion"
            )

        ]);


    } catch (e) {
        if (isBackgroundPending(e)) return;
        toast(
            e.message
        );
    }
}


// ============================================================
// MAIN TABS
// ============================================================

document
    .querySelectorAll(".tab")
    .forEach(
        b => {

            b.addEventListener(
                "click",
                () => {

                    document
                        .querySelectorAll(".tab")
                        .forEach(x => {
                            x.classList.remove("active");
                            x.removeAttribute("aria-current");
                        });


                    b.classList.add(
                        "active"
                    );
                    b.setAttribute("aria-current", "page");


                    document
                        .querySelectorAll(".panel")
                        .forEach(
                            x =>
                                x.classList.remove(
                                    "active"
                                )
                        );


                    const panel =
                        $("#" + b.dataset.tab);


                    if (panel) {

                        panel.classList.add(
                            "active"
                        );
                    }


                    if (
                        b.dataset.tab ===
                        "eligible"
                    ) {

                        loadEligible();
                    }


                    if (
                        b.dataset.tab ===
                        "inactive"
                    ) {

                        loadInactive();
                    }


                    if (
                        b.dataset.tab ===
                        "membersLog"
                    ) {

                        loadMembersLog("promotion");
                    }


                    if (b.dataset.tab === "leaders") {
                        loadLeaders();
                    }
                    if (b.dataset.tab === "doNotPromote") loadDoNotPromote();
                    if (b.dataset.tab === "statistics") renderStatistics();

                }
            );

        }
    );


// ============================================================
// MEMBERS LOG SUB-TABS
// ============================================================

document
    .querySelectorAll("#membersLog .log-tab:not(.leader-view-tab)")
    .forEach(
        b => {

            b.addEventListener(
                "click",
                () => {

                    document
                        .querySelectorAll("#membersLog .log-tab")
                        .forEach(
                            x =>
                                x.classList.remove(
                                    "active"
                                )
                        );


                    b.classList.add(
                        "active"
                    );

                    loadMembersLog(b.dataset.log);

                }
            );

        }
    );


// ============================================================
// GOOGLE SHEET SYNC
// ============================================================

const syncButton =
    $("#syncBtn");


if (syncButton) {

    syncButton.addEventListener(
        "click",
        async () => {

            const b =
                $("#syncBtn");


            b.disabled = true;
            b.dataset.syncing = "true";

            b.textContent = "Syncing...";


            try {

                const r =
                    await api(
                        "/api/sync",
                        {
                            method: "POST"
                        }
                    );


                let sourceMembers = memberRowsFromResponse(r);
                if (!sourceMembers) sourceMembers = memberRowsFromResponse(await api("/api/members"));
                if (!sourceMembers) throw new Error("The roster response was invalid. Refresh the page and try again.");
                allMembersCache = sourceMembers;
                allMembersCacheAt = Date.now();
        renderStatistics();
                try { sessionStorage.setItem("lvfr.roster.snapshot.v1", JSON.stringify(sourceMembers)); } catch {}
                memberCache.clear();
                sourceMembers.forEach(member => memberCache.set(String(member.callsign || "").toUpperCase(), member));
                memberListRenderKey = "";

                const activeTab = $(".tab.active")?.dataset.tab;
                await Promise.all([
                    loadMembers(),
                    ...(activeTab === "eligible" ? [loadEligible()] : []),
                    ...(activeTab === "inactive" && (currentUserIsAdmin || currentUserIsCommand) ? [loadInactive()] : [])
                ]);
                if (activeProfileMember?.callsign) profile(activeProfileMember.callsign, true);
                await syncStatus();
                toast(`Roster updated - ${sourceMembers.length} members`);


            } catch (e) {

                toast(
                    e.message
                );

            } finally {

                b.disabled = false;

                delete b.dataset.syncing;
                b.textContent = "Sync now";
            }

        }
    );

}

const fullSyncButton = $("#fullSyncBtn");
fullSyncButton?.addEventListener("click", async () => {
    if (!currentUserCanFullSync || !window.confirm("Full Sync will replace the D1 roster and Callsign slots from the current Google Sheet. Continue?")) return;
    fullSyncButton.disabled = true;
    fullSyncButton.textContent = "Full Syncing...";
    try {
        const result = await api("/api/full-sync", { method: "POST" });
        const sourceMembers = memberRowsFromResponse(await api("/api/members"));
        if (!sourceMembers) throw new Error("The roster response was invalid. Refresh the page and try again.");
        allMembersCache = sourceMembers;
        allMembersCacheAt = Date.now();
        memberCache.clear();
        sourceMembers.forEach(member => memberCache.set(String(member.callsign || "").toUpperCase(), member));
        memberListRenderKey = "";
        await loadMembers();
        await syncStatus();
        toast(result.message || `Full Sync completed - ${sourceMembers.length} members`);
    } catch (error) {
        toast(error.message || "Full Sync failed.");
    } finally {
        fullSyncButton.disabled = false;
        fullSyncButton.textContent = "Full Sync";
    }
});

// ============================================================
// SEARCH
// ============================================================

// ------------------------------------------------------------
// MEMBERS SEARCH - REAL TIME
// ------------------------------------------------------------

const memberSearch =
    $("#search");


if (memberSearch) {
    let searchTimer = 0;
    memberSearch.addEventListener(
        "input",
        () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => loadMembers(), 90);
        }
    );

}


// ------------------------------------------------------------
// MEMBERS SEARCH - CLEAR
// ------------------------------------------------------------

const memberClear =
    $("#clearBtn");


if (memberClear) {

    memberClear.addEventListener(
        "click",
        e => {

            e.preventDefault();

            if (memberSearch) {

                memberSearch.value = "";

                memberSearch.focus();

            }

            loadMembers();

        }
    );

}

// Member filters are combined with AND, so selecting HERT,
// Basic Firefighting and Activity shows members matching all three.
const memberFilterIds = [
    "#filterRank",
    "#filterHert",
    "#filterFortInstructor",
    "#filterHertInstructor",
    "#filterBasic",
    "#filterAdvanced",
    "#filterSupervisorExam",
    "#filterActivity"
];

memberFilterIds.forEach(id => {
    const filter = $(id);
    if (filter) {
        filter.addEventListener("change", loadMembers);
    }
});

const resetMemberFilters = $("#resetMemberFilters");
if (resetMemberFilters) {
    resetMemberFilters.addEventListener("click", () => {
        memberFilterIds.forEach(id => {
            const filter = $(id);
            if (filter) filter.value = "all";
        });
        loadMembers();
    });
}

const eligibleRankFilter = $("#eligibleRankFilter");
if (eligibleRankFilter) {
    eligibleRankFilter.addEventListener("change", loadEligible);
}
$("#refreshEligibleBtn")?.addEventListener("click", async event => {
    const button = event.currentTarget; button.disabled = true;
    try { await loadEligible(true); } finally { button.disabled = false; }
});
$("#refreshDoNotPromoteBtn")?.addEventListener("click", async event => {
    const button = event.currentTarget; button.disabled = true;
    try { await loadDoNotPromote(); } finally { button.disabled = false; }
});
$("#refreshInactiveBtn")?.addEventListener("click", async event => {
    const button = event.currentTarget; button.disabled = true;
    try { await loadInactive(true); } finally { button.disabled = false; }
});
async function withListRefresh(button, refresh) {
    button.disabled = true;
    try { await refresh(); } catch (error) { toast(error.message || "Could not refresh this list."); }
    finally { button.disabled = false; }
}
$("#refreshMembersBtn")?.addEventListener("click", event => withListRefresh(event.currentTarget, () => loadMembers(true, true)));
$("#refreshMembersLogBtn")?.addEventListener("click", event => withListRefresh(event.currentTarget, () => {
    apiReadCache.delete(`/api/members-log?log_type=${encodeURIComponent(currentLogType)}`);
    return loadMembersLog(currentLogType);
}));
$("#refreshTrainingBtn")?.addEventListener("click", event => withListRefresh(event.currentTarget, async () => {
    const view = document.querySelector("[data-training-view].active")?.dataset.trainingView || "FORT";
    const selectedSection = document.querySelector(`[data-training-panel="${view}"] [data-training-section].active`)?.dataset.trainingSection || "";
    if (view === "HOURS") { apiReadCache.delete("/api/training-hours"); await loadTrainingHours(); }
    else if (selectedSection.endsWith("_LOI")) { apiReadCache.delete("/api/loi"); await loadLoiLists(); }
    else await loadMembers(true, true);
}));
$("#refreshStatisticsBtn")?.addEventListener("click", event => withListRefresh(event.currentTarget, async () => {
    await loadMembers(true, true);
    renderStatistics();
}));
$("#refreshLeadersBtn")?.addEventListener("click", event => withListRefresh(event.currentTarget, () => {
    apiReadCache.delete("/api/leaders");
    return loadLeaders();
}));


// ------------------------------------------------------------
// CAN BE TERMINATED - REAL TIME SEARCH
// ------------------------------------------------------------

const inactiveSearch =
    $("#inactiveSearch");


if (inactiveSearch) {

    inactiveSearch.addEventListener(
        "input",
        () => {

            renderInactive();

        }
    );

}


// ------------------------------------------------------------
// CAN BE TERMINATED - CLEAR
// ------------------------------------------------------------

const inactiveClear =
    $("#inactiveClearBtn");


if (inactiveClear) {

    inactiveClear.addEventListener(
        "click",
        e => {

            e.preventDefault();

            e.stopPropagation();

            if (inactiveSearch) {

                inactiveSearch.value = "";

                inactiveSearch.focus();

            }

            renderInactive();

        }
    );

}


// ------------------------------------------------------------
// MEMBERS LOG - REAL TIME SEARCH
// ------------------------------------------------------------

const membersLogSearch =
    $("#membersLogSearch");

const instructorLogSearch = $("#instructorLogSearch");
if (instructorLogSearch) instructorLogSearch.addEventListener("input", renderMembersLog);
const instructorLogClear = $("#instructorLogClearBtn");
if (instructorLogClear) instructorLogClear.addEventListener("click", () => {
    if (instructorLogSearch) instructorLogSearch.value = "";
    instructorLogSearch?.focus();
    renderMembersLog();
});

["#promotionFilter", "#trainingFilter", "#noteFilter"].forEach(id => {
    const filter = $(id);
    if (filter) filter.addEventListener("change", renderMembersLog);
});


if (membersLogSearch) {

    membersLogSearch.addEventListener(
        "input",
        () => {

            renderMembersLog();

        }
    );

}


// ------------------------------------------------------------
// MEMBERS LOG - CLEAR
// ------------------------------------------------------------

const membersLogClear =
    $("#membersLogClearBtn");


if (membersLogClear) {

    membersLogClear.addEventListener(
        "click",
        e => {

            e.preventDefault();

            e.stopPropagation();

            if (membersLogSearch) {

                membersLogSearch.value = "";

                membersLogSearch.focus();

            }

            renderMembersLog();

        }
    );

}

const membersLogDelete = $("#membersLogDeleteBtn");
async function deleteCurrentD1Log(button) {
    if (!currentUserHasPermission("logs_delete_d1") || !currentLogType) return;
    const kind = currentLogType;
    if (!window.confirm(`Delete all ${kind} entries from the website's D1 log? Google Sheets will remain unchanged.`)) return;
    button.disabled = true;
    try {
        await api("/api/members-log/clear", { method: "POST", body: JSON.stringify({ log_type: kind }) });
        try { sessionStorage.removeItem(`lvfr.log.${currentUserAccountId}.${kind}.v1`); } catch {}
        currentLogRows = [];
        renderMembersLog();
        toast("D1 log cleared. Google Sheets was not changed.");
    } catch (error) {
        toast(`Could not clear D1 log: ${error.message}`);
    } finally { button.disabled = false; }
}
membersLogDelete?.addEventListener("click", async event => {
    event.preventDefault();
    await deleteCurrentD1Log(membersLogDelete);
});
$("#instructorLogDeleteBtn")?.addEventListener("click", async event => { event.preventDefault(); await deleteCurrentD1Log(event.currentTarget); });


// ============================================================
// MODAL CLICK OUTSIDE
// ============================================================

const modal =
    $("#modal");


if (modal) {

    modal.addEventListener(
        "click",
        e => {

            if (
                e.target.id ===
                "modal"
            ) {

                closeModal();
            }

        }
    );

}


// ============================================================
// INITIAL LOAD
// ============================================================

function canViewStatistics(user) {
    if (!user) return false;
    if (user.role === "admin") return true;
    if (user.permissions) return user.permissions.statistics_view === true;
    return Boolean(user.is_command || ["leader", "supervisor", "command", "commander"].includes(String(user.role || "").toLowerCase()));
}

function canRunFullSync(user) {
    return String(user?.role || "").trim().toLowerCase() === "admin" || user?.permissions?.full_sync_manage === true;
}

function applyAccountUser(user) {
    window.lvfrCacheUser?.(user);
    currentUserIsAdmin = Boolean(user.is_admin);
    currentUserIsOperation = String(user.role || "").toLowerCase() === "admin";
    currentUserPermissions = user.permissions || {};
    if (membersLogDelete) membersLogDelete.hidden = !currentUserHasPermission("logs_delete_d1") || currentLogType === "instructor";
    const instructorLogDelete = $("#instructorLogDeleteBtn");
    if (instructorLogDelete) instructorLogDelete.hidden = !currentUserHasPermission("logs_delete_d1") || currentLogType !== "instructor";
    currentUserPermissionOverrides = user.permission_overrides || {};
    if (!currentUserHasPermission("portal_access")) {
        location.replace("/watch-command");
        return;
    }
    currentUserCanFullSync = canRunFullSync(user);
    currentUserAccountId = String(user.account_id || user.id || "");
    currentUserCallsign = String(user.callsign || "").trim().toUpperCase();
    currentUserIsCommand = Boolean(user.is_command);
    const commandSyncPanel = $("#commandSyncPanel");
    if (commandSyncPanel) commandSyncPanel.hidden = !currentUserHasPermission("portal_access");
    const fullSyncButton = $("#fullSyncBtn");
    if (fullSyncButton) fullSyncButton.hidden = !currentUserCanFullSync;
    currentInstructorTypes = String(user.instructor_type || "")
        .split("/").map(value => value.trim().toUpperCase()).filter(Boolean);
    const account = $("#accountName");
    if (account) account.textContent = user.name;
    const nameDisplay = $("#accountNameDisplay");
    if (nameDisplay) nameDisplay.textContent = `Signed in as ${user.name}`;
    const callsignDisplay = $("#accountCallsignDisplay");
    if (callsignDisplay) callsignDisplay.textContent = `Current callsign: ${user.callsign || ""}`;
    const leadersTab = $("#leadersTab");
    if (leadersTab) leadersTab.style.display = user.is_admin ? "" : "none";
    const doNotPromoteTab = $("#doNotPromoteTab");
    if (doNotPromoteTab) doNotPromoteTab.style.display = user.is_admin ? "" : "none";
    const inactiveTab = $("#inactiveTab");
    if (inactiveTab) inactiveTab.style.display = (user.is_admin || user.is_command) ? "" : "none";
    const terminationLogTab = $("#terminationLogTab");
    if (terminationLogTab) terminationLogTab.style.display = currentUserHasPermission("logs_view") ? "" : "none";
    const instructorLogTab = $("#instructorLogTab");
    if (instructorLogTab) instructorLogTab.style.display = currentUserHasPermission("logs_view") ? "" : "none";
    const statisticsTab = $("#statisticsTab");
    if (statisticsTab) statisticsTab.style.display = canViewStatistics(user) ? "" : "none";
    const tabPermissions = { members: "members_view", eligible: ["eligible_view", "promotion_access"], membersLog: "logs_view", trainingDirectory: "training_view", inactive: "inactive_view", statistics: "statistics_view" };
    Object.entries(tabPermissions).forEach(([tab, permission]) => {
        const button = document.querySelector(`.tab[data-tab="${tab}"]`);
        if (button) button.style.display = (Array.isArray(permission) ? permission.some(key => currentUserHasPermission(key)) : currentUserHasPermission(permission)) ? "" : "none";
    });
    const trainingHoursTab = document.querySelector('[data-training-view="HOURS"]');
    if (trainingHoursTab) trainingHoursTab.style.display = currentUserHasPermission("training_hours_view") ? "" : "none";
    const canViewLoi = currentUserHasPermission("training_view") || currentUserHasPermission("loi_manage");
    const canViewTraining = currentUserHasPermission("training_view");
    const trainingDirectoryTab = document.querySelector('.tab[data-tab="trainingDirectory"]');
    if (trainingDirectoryTab) trainingDirectoryTab.style.display = (canViewLoi || currentUserHasPermission("training_hours_view")) ? "" : "none";
    document.querySelectorAll('[data-training-view="FORT"], [data-training-view="HERT"]').forEach(button => { button.style.display = (canViewTraining || canViewLoi) ? "" : "none"; });
    document.querySelectorAll('[data-training-section="HERT_CERTIFIED"], [data-training-section="HERT_INSTRUCTOR"], [data-training-section="FORT_TRAINING"], [data-training-section="FORT_INSTRUCTOR"]').forEach(button => { button.style.display = canViewTraining ? "" : "none"; });
    document.querySelectorAll('[data-training-section="HERT_LOI"], [data-training-section="FORT_LOI"]').forEach(button => { button.style.display = canViewLoi ? "" : "none"; });
    if (!canViewTraining && canViewLoi) {
        document.querySelector('[data-training-view="HERT"]')?.click();
        document.querySelector('[data-training-section="HERT_LOI"]')?.click();
    } else if (!canViewLoi && currentUserHasPermission("training_hours_view")) {
        document.querySelector('[data-training-view="HOURS"]')?.click();
    }
    const addTrainingHoursButton = $("#openTrainingHoursAdd");
    if (addTrainingHoursButton) addTrainingHoursButton.style.display = currentUserHasPermission("training_hours_manage") ? "" : "none";
    document.querySelectorAll("[data-open-loi-add]").forEach(button => { button.hidden = !currentUserHasPermission("loi_manage"); });
    if (!currentUserHasPermission("members_view")) sessionStorage.removeItem("lvfr.roster.snapshot.v1");
    if ($("#doNotPromoteTab")) $("#doNotPromoteTab").style.display = currentUserHasPermission("do_not_promote_view") ? "" : "none";
    if (!document.querySelector(".tab.active") || document.querySelector(".tab.active").style.display === "none") {
        [...document.querySelectorAll('.tab')].find(button => getComputedStyle(button).display !== "none")?.click();
    }
    renderTrainingDirectory();
}

let doNotPromoteRows = [];
const DO_NOT_PROMOTE_CACHE_KEY = "lvfr.do-not-promote.v1";

async function loadDoNotPromote() {
    try {
        const cached = JSON.parse(localStorage.getItem(DO_NOT_PROMOTE_CACHE_KEY) || "null");
        if (Array.isArray(cached)) {
            doNotPromoteRows = cached;
            renderDoNotPromote();
        }
    } catch {}
    try {
        apiReadCache.delete("/api/do-not-promote");
        doNotPromoteRows = await api("/api/do-not-promote");
        try { localStorage.setItem(DO_NOT_PROMOTE_CACHE_KEY, JSON.stringify(doNotPromoteRows)); } catch {}
        renderDoNotPromote();
    } catch (error) { toast(error.message); }
}

function renderDoNotPromote() {
    const container = $("#doNotPromoteTable");
    if (!container) return;
    container.innerHTML = doNotPromoteRows.length ? `
        <table><thead><tr><th>Callsign</th><th>Name</th><th>Added At</th><th>Added By</th><th></th></tr></thead>
        <tbody>${doNotPromoteRows.map(member => `
            <tr>
                <td>${esc(member.callsign)}</td><td>${esc(member.name)}</td>
                <td>${esc(member.added_at)}</td><td>${esc(member.added_by)}</td>
                <td>${currentUserHasPermission("profile_view") ? `<button type="button" data-action="profile" data-callsign="${esc(member.callsign)}">View</button>` : ""}
                    ${currentUserHasPermission("do_not_promote_manage") ? `<button type="button" class="danger" data-action="do-not-promote-remove" data-callsign="${esc(member.callsign)}">Remove</button>` : ""}</td>
            </tr>`).join("")}</tbody></table>` : empty("The Do not Promote list is empty.");
}

async function setMemberPromotionBlock(callsign, blocked) {
    if (!currentUserHasPermission("do_not_promote_manage")) return toast("You do not have permission to edit this list.");
    if (blocked && !confirm(`Add ${callsign} to Do not Promote? They will be excluded from Eligible and cannot be promoted.`)) return;
    const key = String(callsign).trim().toUpperCase();
    const rosterMember = memberCache.get(key) || allMembersCache?.find(member => String(member.callsign || "").toUpperCase() === key);
    const oldBlocked = Boolean(rosterMember?.do_not_promote);
    const previousRows = doNotPromoteRows;
    if (rosterMember) {
        rosterMember.do_not_promote = blocked;
        const eligibility = calculateMemberEligibility(rosterMember);
        rosterMember.eligible = eligibility.eligible;
        rosterMember.eligibility_reason = eligibility.eligibility_reason;
        rosterMember.next_rank = eligibility.next_rank;
    }
    if (Array.isArray(allMembersCache)) {
        allMembersCache = allMembersCache.map(member => String(member.callsign || "").toUpperCase() === key
            ? { ...member, do_not_promote: blocked } : member);
        allMembersCacheAt = Date.now();
        renderStatistics();
        memberListRenderKey = "";
        try { sessionStorage.setItem("lvfr.roster.snapshot.v1", JSON.stringify(allMembersCache)); } catch {}
    }
    if (blocked) {
        if (!doNotPromoteRows.some(member => String(member.callsign || "").toUpperCase() === key)) {
            doNotPromoteRows = [{ callsign: key, name: rosterMember?.name || "", added_at: new Date().toLocaleString(), added_by: "You" }, ...doNotPromoteRows];
        }
        removeEligibleRow(key);
    } else {
        doNotPromoteRows = doNotPromoteRows.filter(member => String(member.callsign || "").toUpperCase() !== key);
    }
    try { localStorage.setItem(DO_NOT_PROMOTE_CACHE_KEY, JSON.stringify(doNotPromoteRows)); } catch {}
    renderDoNotPromote();
    if (rosterMember) {
        memberCache.set(key, rosterMember);
        if (activeProfileMember?.callsign?.toUpperCase() === key) void profile(key, true, rosterMember);
    }
    void loadMembers(false);
    toast(blocked ? `${key} added to Do not Promote.` : `${key} removed from Do not Promote.`);
    try {
        await api("/api/do-not-promote", { method: "POST", body: JSON.stringify({ callsign, blocked }) });
        apiReadCache.clear();
        void loadMembers(true, true);
        if (activeProfileMember?.callsign?.toUpperCase() === String(callsign).toUpperCase()) {
            void api(`/api/member/${encodeURIComponent(callsign)}`).then(fresh => {
                memberCache.set(String(callsign).toUpperCase(), fresh);
                profile(callsign, true, fresh);
            }).catch(() => {});
        }
        if ($(".tab.active")?.dataset.tab === "eligible") void loadEligible();
        if ($(".tab.active")?.dataset.tab === "doNotPromote") void loadDoNotPromote();
    } catch (error) {
        doNotPromoteRows = previousRows;
        try { localStorage.setItem(DO_NOT_PROMOTE_CACHE_KEY, JSON.stringify(doNotPromoteRows)); } catch {}
        if (rosterMember) {
            rosterMember.do_not_promote = oldBlocked;
            const eligibility = calculateMemberEligibility(rosterMember);
            rosterMember.eligible = eligibility.eligible;
            rosterMember.eligibility_reason = eligibility.eligibility_reason;
            rosterMember.next_rank = eligibility.next_rank;
        }
        if (Array.isArray(allMembersCache)) {
            allMembersCache = allMembersCache.map(member => String(member.callsign || "").toUpperCase() === key
                ? { ...member, do_not_promote: oldBlocked } : member);
            allMembersCacheAt = Date.now();
        renderStatistics();
            memberListRenderKey = "";
        }
        renderDoNotPromote();
        void loadMembers(false);
        if ($(".tab.active")?.dataset.tab === "eligible") void loadEligible();
        toast(error.message);
    }
}

async function loadAccount() {
    try {
        const user = await api("/auth/me");
        applyAccountUser(user);
        return user.role === "admin" || user.permissions?.portal_access === true;
    } catch {
        location.assign("/login");
        return false;
    }
}


(async () => {
    try {
        if (!await loadAccount()) return;
        const tasks = [loadNotifications(), loadConfig()];
        if (currentUserHasPermission("members_view") || currentUserHasPermission("training_view") || currentUserHasPermission("statistics_view")) tasks.push(loadMembers(true, true));
        if (currentUserHasPermission("logs_view")) tasks.push(loadMembersLog("promotion"));
        await Promise.all(tasks);
        if (currentUserHasPermission("sync_view")) void syncStatus();
    } catch (e) {
        toast(e.message);
    }

})();

refreshOnlineCount();
setInterval(refreshOnlineCount, 30000);

// A Sheet edit syncs into D1 without a push channel to already-open browsers.
// Refresh only the visible roster view so external activity changes appear
// within a few seconds, and immediately when the user returns to the tab.
function refreshVisibleRosterView() {
    if (document.hidden) return;
    const activeTab = $(".tab.active")?.dataset.tab;
    if (activeTab === "members" && currentUserHasPermission("members_view")) void loadMembers(true, true);
    else if (activeTab === "eligible" && (currentUserHasPermission("eligible_view") || currentUserHasPermission("promotion_access"))) void loadEligible(true);
    else if (activeTab === "inactive" && currentUserHasPermission("inactive_view")) void loadInactive(true);
    else if (activeTab === "trainingDirectory") {
        if ($('[data-training-view="HOURS"]')?.classList.contains("active")) { if (currentUserHasPermission("training_hours_view")) void loadTrainingHours(true); }
        else if (document.querySelector('[data-training-panel]:not([hidden]) [data-training-section].active')?.dataset.trainingSection.endsWith("_LOI")) {
            // LOI refreshes when its tab opens or after a mutation. Sheet edits
            // flow back to D1 through Apps Script triggers; there is no poll.
        }
        else if (currentUserHasPermission("training_view")) void loadMembers(true, true);
    }
}
setInterval(refreshVisibleRosterView, 3000);
document.addEventListener("visibilitychange", refreshVisibleRosterView);

setInterval(() => { if (!document.hidden && currentUserHasPermission("sync_view")) syncStatus(); }, 60000);
setInterval(() => {
    if (!document.hidden) loadNotifications();
}, 60000);
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void loadNotifications();
});
setInterval(() => {
    if (!document.hidden && currentUserIsAdmin && $("#allLeadersTable")) void loadLeaders();
}, 30000);
