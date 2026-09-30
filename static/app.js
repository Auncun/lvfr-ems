const $ = s => document.querySelector(s);

let config = {};
const BACKGROUND_PENDING_MESSAGE = "BACKGROUND_SAVE_PENDING";


// ============================================================
// API
// ============================================================

async function api(url, options = {}) {
    if (isBackgroundMutationRequest(url, options)) return startBackgroundMutation(url, options);
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

    return d;
}

function isBackgroundMutationRequest(url, options) {
    const method = String(options.method || "GET").toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;
    const path = new URL(url, location.href).pathname;
    return new Set([
        "/api/activity", "/api/note", "/api/date", "/api/training", "/api/exam",
        "/api/promote", "/api/force-promote", "/api/demote", "/api/change-rank",
        "/api/change-callsign", "/api/terminate", "/api/notifications/read"
    ]).has(path) || /^\/api\/member\/[^/]+\/instructor$/.test(path) ||
        /^\/api\/leaders\/[^/]+(?:\/(?:allow|deny|admin|demote|member|leader|deactivate|reactivate))?$/.test(path);
}

function startBackgroundMutation(url, options) {
    const path = new URL(url, location.href).pathname;
    let payload = {};
    try { payload = JSON.parse(options.body || "{}"); } catch {}
    const callsignMatch = path.match(/^\/api\/member\/([^/]+)\/instructor$/);
    const callsign = String(payload.callsign || (callsignMatch ? decodeURIComponent(callsignMatch[1]) : ""));
    applyOptimisticMutation(path, payload, callsign);
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
        window.dispatchEvent(new CustomEvent("lvfr:background-updated", { detail: { route: path, callsign, result } }));
        return result;
    }).catch(error => {
        toast(`Save failed: ${error.message || "Network error"}. The page may differ from Google Sheets. Use Sync now to reload the correct data.`);
    });
    // Let the click handler stop waiting while fetch continues independently.
    void request;
    throw new Error(BACKGROUND_PENDING_MESSAGE);
}

function rankForCallsign(callsign) {
    const prefix = String(callsign || "").toUpperCase().match(/^[A-Z]+/);
    const map = { COM: "Commissioners", CHIEF: "Chief", B: "County Command", DIV: "Division Commander", C: "Captain", E: "Lieutenant", L: "Lead Paramedic", M: "Paramedic", A: "AEMT", R: "EMT", P: "Probationary", S: "Senior Volunteer", V: "Volunteer" };
    return prefix ? map[prefix[0]] || "" : "";
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
    const before = { ...previous };
    const updated = { ...previous };
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
        updated.days_in_rank = 0;
        updated.eligible = false;
        updated.eligibility_reason = "Promotion is being saved…";
        updated.next_rank = "";
    } else if (route === "/api/change-callsign") {
        updated.callsign = String(payload.new_callsign || previous.callsign).toUpperCase();
        updated.rank = rankForCallsign(updated.callsign) || previous.rank;
    } else if (route === "/api/terminate") {
        memberCache.delete(key);
        removeCachedMemberRow(key);
        return;
    }
    memberCache.set(key, updated);
    paintCachedMemberRow(updated, key);
    if (activeProfileMember?.callsign?.toUpperCase() === key && route !== "/api/change-callsign") profile(key, true);
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
    const button = [...document.querySelectorAll('#membersTable [data-action="profile"]')]
        .find(item => item.dataset.callsign?.toUpperCase() === callsign);
    button?.closest("tr")?.remove();
}

function paintCachedMemberRow(member, oldCallsign) {
    const button = [...document.querySelectorAll('#membersTable [data-action="profile"]')]
        .find(item => item.dataset.callsign?.toUpperCase() === oldCallsign);
    const row = button?.closest("tr");
    if (!row) return;
    const cells = row.querySelectorAll("td");
    if (cells.length >= 5) {
        cells[0].innerHTML = `<b>${esc(member.callsign)}</b>`;
        cells[2].textContent = member.rank || "";
        cells[3].textContent = String(member.days_in_rank ?? "");
        cells[4].innerHTML = status(member.activity);
    }
    button.dataset.callsign = oldCallsign;
}

window.addEventListener("lvfr:background-updated", event => {
    const callsign = String(event.detail?.callsign || "").trim().toUpperCase();
    const newCallsign = String(event.detail?.result?.new_callsign || "").trim().toUpperCase();
    if (callsign && newCallsign && callsign !== newCallsign) {
        const promoted = memberCache.get(callsign);
        if (promoted) {
            memberCache.delete(callsign);
            promoted.callsign = newCallsign;
            promoted.rank = event.detail?.result?.new_rank || promoted.rank;
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
    loadMembers(true);
    setTimeout(() => loadMembers(true), 1500);
    syncStatus();
    const activeTab = $(".tab.active")?.dataset.tab;
    if (activeTab === "eligible") loadEligible();
    if (activeTab === "inactive") loadInactive();
    if (String(event.detail?.route || "").startsWith("/api/leaders/")) loadLeaders();
    if (callsign && activeProfileMember?.callsign?.toUpperCase() === callsign.toUpperCase()) profile(callsign, true);
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
        case "set-member-role": setMemberRole(accountId, control.dataset.role); break;
        case "account-status": setAccountStatus(accountId, control.dataset.status); break;
        case "remove-leader": removeLeader(accountId); break;
        case "resolve-leader": resolveLeader(accountId, control.dataset.resolution); break;
        case "app-selection": location.assign("/portal"); break;
        case "close-modal": closeModal(); break;
        case "logout": fetch("/auth/logout", { method: "POST" }).finally(() => location.assign("/login")); break;
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
    try {
        const result = await api("/api/notifications");
        notificationItems = Array.isArray(result.items) ? result.items : [];
        renderNotifications();
    } catch (error) {
        if (!silent) toast(`Could not load notifications: ${error.message}`);
    }
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
        renderNotifications();
    } catch (error) {
        toast(`Could not update notifications: ${error.message}`);
    }
}


async function openNotification(id) {
    const item = notificationItems.find(row => Number(row.id) === Number(id));
    if (!item) return;
    await markNotificationsRead([id]);
    const panel = $("#notificationPanel");
    const button = $("#notificationButton");
    if (panel) panel.hidden = true;
    if (button) button.setAttribute("aria-expanded", "false");

    if (item.kind === "eligible" && item.callsign) {
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
$("#markNotificationsRead")?.addEventListener("click", () => markNotificationsRead());
document.addEventListener("click", event => {
    const panel = $("#notificationPanel");
    if (panel && !event.target.closest(".notification-control")) {
        panel.hidden = true;
        notificationButton?.setAttribute("aria-expanded", "false");
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

    config = await api(
        "/api/config"
    );

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

            dbStatus.textContent =
                "Google Apps Script: online";

            dbStatus.style.color =
                "#56d364";
        }

        await syncStatus();

    } catch {

        const dbStatus = $("#dbStatus");

        if (dbStatus) {

            dbStatus.textContent =
                "Google Apps Script offline";

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

        syncStatusElement.textContent =
            s.synced_at
                ? `Google Sheets live: ${s.members} members | checked ${s.synced_at}`
                : "Google Sheets: waiting for connection";

        syncStatusElement.style.color =
            s.synced_at
                ? "#56d364"
                : "#d29922";

        const syncActivityElement = $("#syncActivityStatus");
        if (syncActivityElement) {
            syncActivityElement.textContent = "Refreshes this page every 15 seconds";
            syncActivityElement.style.color = "#56d364";
        }

        const autoSyncButton = $("#autoSyncBtn");
        if (autoSyncButton) {
            autoSyncButton.textContent = "Auto refresh: 15s";
            autoSyncButton.disabled = true;
            autoSyncButton.title = "The visible roster refreshes from Google Sheets every 15 seconds.";
        }
        const manualSyncButton = $("#syncBtn");
        if (manualSyncButton && !manualSyncButton.dataset.syncing) {
            manualSyncButton.disabled = Boolean(s.sync_running);
        }

        const googleWriteStatusElement = $("#googleWriteStatus");
        if (googleWriteStatusElement) {
            googleWriteStatusElement.textContent = "Edits save directly to Google Sheets";
            googleWriteStatusElement.style.color = "#56d364";
        }

        const archiveStatusElement = $("#archiveStatus");
        if (archiveStatusElement) {
            archiveStatusElement.textContent = "Audit history is stored in the private Google Sheet";
            archiveStatusElement.style.color = "#56d364";
        }

    } catch {}
}


// ============================================================
// MEMBERS
// ============================================================

let memberListRequestInFlight = false;
let memberListRenderKey = "";
const memberCache = new Map();

async function loadMembers(silent = false) {
    if (memberListRequestInFlight) return;
    memberListRequestInFlight = true;

    try {

        const searchElement =
            $("#search");

        const q =
            encodeURIComponent(
                searchElement
                    ? searchElement.value.trim()
                    : ""
            );

        const loadedRows =
            await api(
                "/api/members?search=" + q
            );
        loadedRows.forEach(member => memberCache.set(String(member.callsign || "").toUpperCase(), member));

        const hertFilter = $("#filterHert")?.value || "all";
        const fortInstructorFilter = $("#filterFortInstructor")?.value || "all";
        const hertInstructorFilter = $("#filterHertInstructor")?.value || "all";
        const basicFilter = $("#filterBasic")?.value || "all";
        const advancedFilter = $("#filterAdvanced")?.value || "all";
        const supervisorFilter = $("#filterSupervisorExam")?.value || "all";
        const activityFilter = $("#filterActivity")?.value || "all";
        const rankFilter = $("#filterRank")?.value || "all";

        const renderKey = JSON.stringify([
            loadedRows, q, hertFilter, fortInstructorFilter, hertInstructorFilter,
            basicFilter, advancedFilter,
            supervisorFilter, activityFilter, rankFilter
        ]);
        if (renderKey === memberListRenderKey) return;
        memberListRenderKey = renderKey;

        const rows = loadedRows.filter(m => {
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

            return rankMatches && hertMatches && fortInstructorMatches && hertInstructorMatches
                && basicMatches && advancedMatches
                && supervisorMatches && activityMatches;
        });

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

                                        <button
                                            type="button"
                                            data-action="profile"
                                            data-callsign="${esc(m.callsign)}"
                                        >
                                            View
                                        </button>

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
    }
}

// Apps Script does not hold an SSE connection open. Refresh the visible roster
// periodically instead; every device reads the shared Google Sheet.
setInterval(() => {
    if (!document.hidden && $(".tab.active")?.dataset.tab === "members") loadMembers(true);
}, 60000);
document.addEventListener("visibilitychange", () => {
    if (!document.hidden && $(".tab.active")?.dataset.tab === "members") loadMembers(true);
});


// ============================================================
// ELIGIBLE
// ============================================================

async function loadEligible() {

    try {
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
        const rule = rules[member.rank];
        if (!rule || Number(member.days_in_rank || 0) < rule[1]) return [];
        if (rule[2] && !member.has_basic_firefighting) return [];
        if (rule[3] && !member.has_advanced_firefighting) return [];
        if (rule[4] && !member.has_supervisor_exam) return [];
        return [{ ...member, next_rank: rule[0] }];
    });
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


async function loadInactive() {

    try {
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


async function loadLeaders() {
    const pending = $("#pendingLeadersTable");
    const all = $("#allLeadersTable");
    const instructors = $("#instructorsTable");
    const audit = $("#leaderAuditTable");
    if (!pending && !all && !instructors && !audit) return;

    if (pending) pending.innerHTML = '<div class="empty">Loading...</div>';
    if (all) all.innerHTML = '<div class="empty">Loading...</div>';
    if (instructors) instructors.innerHTML = '<div class="empty">Loading...</div>';
    if (audit) audit.innerHTML = '<div class="empty">Loading...</div>';

    try {
        const [accounts, instructorsData] = await Promise.all([
            api("/api/leaders"),
            api("/api/instructors").catch(() => [])
        ]);
        leaderRows = accounts;
        instructorRows = Array.isArray(instructorsData) ? instructorsData : [];
        leaderAuditRows = Array.isArray(leaderRows.audit) ? leaderRows.audit : [];
        renderLeaders();
    } catch (e) {
        leaderRows = { approved: [], pending: [], deactivated: [] };
        instructorRows = [];
        leaderAuditRows = [];
        const message = empty("Failed to load Leaders: " + e.message);
        if (pending) pending.innerHTML = message;
        if (all) all.innerHTML = message;
        if (instructors) instructors.innerHTML = message;
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
        if (row.is_admin) actions = `
            <button type="button" class="danger" data-action="set-admin" data-account-id="${esc(row.account_id)}" data-enabled="false">Remove Commander</button>
            <button type="button" class="danger" disabled title="Remove Commander access first">Deactivate</button>
            <button type="button" class="danger" disabled title="Remove Commander access first">Delete account</button>`;
        else {
        const memberRoleAction = row.status === "approved"
            ? row.role === "member"
                ? `<button type="button" class="primary" data-action="set-member-role" data-account-id="${esc(row.account_id)}" data-role="leader">Make Leader</button>`
                : `<button type="button" class="primary" data-action="set-member-role" data-account-id="${esc(row.account_id)}" data-role="member">Make Member</button>`
            : "";
        const stateAction = row.status === "deactivated"
            ? `<button type="button" class="primary" data-action="account-status" data-account-id="${esc(row.account_id)}" data-status="reactivate">Activate</button>`
            : `<button type="button" class="danger" data-action="account-status" data-account-id="${esc(row.account_id)}" data-status="deactivate">Deactivate</button>`;
        const adminAction = row.status === "approved"
            ? `<button type="button" class="primary" data-action="set-admin" data-account-id="${esc(row.account_id)}" data-enabled="true">Make Commander</button>` : "";
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
            (roleFilter === "admin" && Boolean(row.is_admin)) ||
            (roleFilter === "leader" && !row.is_admin && row.role !== "member") ||
            (roleFilter === "member" && row.role === "member")
        );
        all.innerHTML = filteredRows.length ? `
            <table>
                <thead><tr>
                    <th>Account</th><th>Linked At</th><th>Approval</th><th>Role</th><th>Role Change</th><th>Actions</th>
                </tr></thead>
                <tbody>${filteredRows.map(row => `
                    <tr>
                        <td class="leader-account-cell"><strong>${esc(row.name || row.display_name)}</strong><small>${row.callsign ? `Callsign ${esc(row.callsign)}` : "No Callsign linked"}</small></td>
                        <td>${esc(row.linked_at || "â€”")}</td>
                        <td class="leader-detail-cell"><span>${esc(row.approved_at || "â€”")}</span><small>By ${esc(row.approved_by || "â€”")}</small></td>
                        <td>${row.is_admin ? "Commander" : row.role === "member" ? "Member" : "Leader"}</td>
                        <td class="leader-detail-cell">${row.admin_changed_at ? `<span>${esc(row.admin_changed_at)}</span><small>By ${esc(row.admin_changed_by || "â€”")}</small>` : "â€”"}</td>
                        <td class="leader-request-actions">${accountActions(row)}</td></tr>
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
                    <tr><td><strong>${esc(row.name)}</strong></td><td>${esc(row.type)}</td><td>${esc(row.date || "â€”")}</td></tr>
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


async function resolveLeader(discordId, decision) {
    try {
        await api(`/api/leaders/${encodeURIComponent(discordId)}/${decision}`, { method: "POST" });
        toast(decision === "allow" ? "Activated" : "Denial queued; saving in background.");
        await loadLeaders();
    } catch (e) {
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
        toast(e.message);
    }
}


async function setLeaderAdmin(discordId, makeAdmin) {
        if (!makeAdmin && !confirm("Remove Commander access for this account?")) return;
    try {
        await api(`/api/leaders/${encodeURIComponent(discordId)}/${makeAdmin ? "admin" : "demote"}`, { method: "POST" });
        toast(makeAdmin ? "Commander promotion queued; saving in background." : "Commander access removal queued; saving in background.");
        await loadLeaders();
    } catch (e) {
        toast(e.message);
    }
}

async function setMemberRole(discordId, role) {
    const makeMember = role === "member";
    if (makeMember && !confirm("Limit this account to Watch Command access?")) return;
    try {
        await api(`/api/leaders/${encodeURIComponent(discordId)}/${makeMember ? "member" : "leader"}`, { method: "POST" });
        toast(makeMember ? "Member role queued; access will be limited to Watch Command." : "Leader role queued.");
        await loadLeaders();
    } catch (e) {
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
            instructors: $("#instructorsView"),
            audit: $("#leaderAuditView")
        };
        Object.entries(views).forEach(([name, view]) => {
            if (view) view.style.display = currentLeaderView === name ? "block" : "none";
        });
    });
});


const leaderRoleFilter = $("#leaderRoleFilter");
if (leaderRoleFilter) leaderRoleFilter.addEventListener("change", renderLeaders);
const instructorTypeFilter = $("#instructorTypeFilter");
if (instructorTypeFilter) instructorTypeFilter.addEventListener("change", renderLeaders);
const instructorSearch = $("#instructorSearch");
if (instructorSearch) instructorSearch.addEventListener("input", renderLeaders);
const clearInstructorSearch = $("#clearInstructorSearch");
if (clearInstructorSearch) clearInstructorSearch.addEventListener("click", () => {
    if (instructorSearch) instructorSearch.value = "";
    renderLeaders();
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

    document.querySelectorAll(".log-tab:not(.leader-view-tab)").forEach(button => {
        button.classList.toggle("active", button.dataset.log === type);
    });

    updateLogFilters(type);

    const container =
        $("#membersLogTable");

    if (!container) {
        return;
    }

    container.innerHTML =
        '<div class="empty">Loadingâ€¦</div>';


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

        if (type === "callsign") {
            currentLogRows = currentLogRows.filter(isCallsignChangeLog);
        }


        renderMembersLog();


    } catch (e) {

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

    const container =
        $("#membersLogTable");

    if (!container) {
        return;
    }


    const searchElement =
        $("#membersLogSearch");

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


            else if (currentLogType === "training") {

                values = [
                    r.log_date,
                    r.callsign,
                    r.member_name,
                    r.training_name,
                    r.action,
                    r.changed_by
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
                        <td>${esc(r.log_date)}</td>
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
let currentUserIsAdmin = false;
let currentUserAccountId = "";
let currentInstructorTypes = [];
let currentUserIsCommand = false;


async function profile(
    cs,
    force = false,
    providedMember = null
) {

    if (
        profileLoading &&
        !force
    ) {
        return;
    }

    profileLoading = true;

    try {
        const normalizedCallsign = String(cs || "").trim().toUpperCase();
        const cachedMember = providedMember || memberCache.get(normalizedCallsign);
        let m;
        if (cachedMember) {
            m = providedMember || Object.assign({}, cachedMember, {
                trainings: [
                    ...(cachedMember.has_basic_firefighting ? ["basic_firefighting"] : []),
                    ...(cachedMember.has_advanced_firefighting ? ["advanced_firefighting"] : [])
                ],
                exams: cachedMember.has_supervisor_exam ? ["supervisor_exam"] : [],
                hert: Boolean(cachedMember.has_hert),
                eligible: false,
                next_rank: "",
                eligibility_reason: "Loading eligibility details…"
            });
            if (!providedMember) {
                api("/api/member/" + encodeURIComponent(cs))
                    .then(fresh => {
                        memberCache.set(normalizedCallsign, fresh);
                        profile(cs, true, fresh);
                    })
                    .catch(error => console.warn("Could not refresh member profile:", error));
            }
        } else {
            m = await api("/api/member/" + encodeURIComponent(cs));
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

                            ${requirementStatus(
                                trainings,
                                "Basic_Firefighting",
                                "Basic FORT"
                            )}

                            ${requirementStatus(
                                trainings,
                                "Advanced_Firefighting",
                                "Advanced FORT"
                            )}

                        </div>

                    </div>


                    <div class="card">

                        <b>Exams</b>

                        <div>

                            ${requirementStatus(
                                exams,
                                "Supervisor_exam",
                                "Supervisor Exam"
                            )}

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


                    ${(currentUserIsAdmin || (m.eligible && String(m.rank || "").trim().toLowerCase() === "emt" && String(m.next_rank || "").trim().toLowerCase() === "aemt")) ? `<button
                        type="button"
                        class="primary"
                        data-action="promote"
                        data-callsign="${esc(m.callsign)}"
                    >
                        Promote
                    </button>
                    ` : ""}


                    <button
                        type="button"
                        data-action="open-manage"
                        data-callsign="${esc(m.callsign)}"
                    >
                        Manage
                    </button>


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

    if (!currentUserIsAdmin) {
        $("#modalContent").innerHTML = `
            <h2>Change callsign for ${esc(cs)}</h2>
            <label>
                New callsign
                <input id="newcs" value="${esc(cs)}" placeholder="New callsign">
            </label>
            <button type="button" class="primary" data-action="change-callsign" data-callsign="${esc(cs)}">Change Callsign</button>
        `;
        const modal = $("#modal");
        modal?.classList.remove("hidden");
        return;
    }

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
    const showRankDate = currentRankIndex < 0 || leadParamedicIndex < 0 || currentRankIndex > leadParamedicIndex;

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

                <label>

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

                </label>


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

                <div class="activity-actions">

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

            ${currentUserIsCommand ? `
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


            ${currentUserIsAdmin ? `
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


            <hr>


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
            </button>


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


                <button
                    type="button"
                    data-action="rank-tools" data-callsign="${esc(cs)}"
                >
                    Rank / Callsign Tools
                </button>


                <button
                    type="button"
                    class="danger"
                    data-action="terminate" data-callsign="${esc(cs)}"
                >
                    Terminate
                </button>


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
        toast(error.message);
    }
}


function updateTrainingPermission() {
    const selected = String($("#training")?.value || "").trim().toLowerCase();
    const requiredType = selected === "hert" ? "HERT" : "FORT";
    const hasInstructorCertificate = currentInstructorTypes.length > 0;
    const allowed = currentInstructorTypes.includes(requiredType);
    const trainingField = $("#trainingField");
    if (trainingField) trainingField.style.display = hasInstructorCertificate ? "" : "none";
    ["#addTrainingButton", "#deleteTrainingButton"].forEach(selector => {
        const button = $(selector);
        if (!button) return;
        button.style.display = allowed ? "" : "none";
        button.title = allowed ? "" : `Only a ${requiredType} Instructor can change this training.`;
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

    const trainingName = String($("#training")?.value || "").trim().toLowerCase();
    const requiredType = trainingName === "hert" ? "HERT" : "FORT";
    if (!currentInstructorTypes.includes(requiredType)) {
        toast(`Only a ${requiredType} Instructor can add or delete this training.`);
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
            `Promoted to ${r.new_rank} â€” ${r.new_callsign}`
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

        toast(
            e.message
        );
    }
}


// ============================================================
// RANK / CALLSIGN TOOLS
// ============================================================

function openRankTools(cs) {

    if (!currentUserIsAdmin) {
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

                    ${config.ranks.map(
                        x =>
                            `<option>${esc(x)}</option>`
                    ).join("")}

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

        if (e.code === "rank_mismatch" && confirm(
            `This callsign corresponds to ${e.expected}, while the member is ${e.actual}. Continue and update the rank to ${e.expected}?`
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
            `Changed to ${r.new_rank} â€” ${r.new_callsign}`
        );


        closeModal();


        await Promise.all([

            loadMembers(),

            loadMembersLog(
                "promotion"
            )

        ]);


    } catch (e) {

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
            `Demoted to ${r.new_rank} â€” ${r.new_callsign}`
        );


        closeModal();


        await Promise.all([

            loadMembers(),

            loadMembersLog(
                "promotion"
            )

        ]);


    } catch (e) {

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
            `Changed to ${r.new_rank} â€” ${r.new_callsign}`
        );


        closeModal();


        await Promise.all([

            loadMembers(),

            loadMembersLog(
                "promotion"
            )

        ]);


    } catch (e) {

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
                        .forEach(
                            x =>
                                x.classList.remove(
                                    "active"
                                )
                        );


                    b.classList.add(
                        "active"
                    );


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

                        loadMembersLog(
                            currentLogType
                        );
                    }


                    if (b.dataset.tab === "leaders") {
                        loadLeaders();
                    }

                }
            );

        }
    );


// ============================================================
// MEMBERS LOG SUB-TABS
// ============================================================

document
    .querySelectorAll(".log-tab:not(.leader-view-tab)")
    .forEach(
        b => {

            b.addEventListener(
                "click",
                () => {

                    document
                        .querySelectorAll(".log-tab")
                        .forEach(
                            x =>
                                x.classList.remove(
                                    "active"
                                )
                        );


                    b.classList.add(
                        "active"
                    );

                    updateLogFilters(b.dataset.log);

                    loadMembersLog(
                        b.dataset.log
                    );

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


                toast(
                    `Google Sheet synchronized - ${r.result?.members ?? 0} members`
                );

                const sourceMembers = await api("/api/members");
                memberCache.clear();
                sourceMembers.forEach(member => memberCache.set(String(member.callsign || "").toUpperCase(), member));
                memberListRenderKey = "";

                const activeTab = $(".tab.active")?.dataset.tab;
                await Promise.all([
                    loadMembers(),
                    syncStatus(),
                    ...(activeTab === "eligible" ? [loadEligible()] : []),
                    ...(activeTab === "inactive" && currentUserIsAdmin ? [loadInactive()] : [])
                ]);

                if (activeProfileMember?.callsign) profile(activeProfileMember.callsign, true);


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

const autoSyncButton = $("#autoSyncBtn");
if (autoSyncButton) {
    autoSyncButton.addEventListener("click", async () => {
        autoSyncButton.disabled = true;
        try {
            const status = await api("/api/sync-status");
            const result = await api("/api/sync/auto", {
                method: "POST",
                body: JSON.stringify({ enabled: !status.auto_sync_enabled }),
            });
            toast(`Automatic sync ${result.auto_enabled ? "enabled" : "disabled"}`);
            await syncStatus();
        } catch (error) {
            toast(error.message);
        } finally {
            autoSyncButton.disabled = false;
        }
    });
}


// ============================================================
// SEARCH
// ============================================================

// ------------------------------------------------------------
// MEMBERS SEARCH - REAL TIME
// ------------------------------------------------------------

const memberSearch =
    $("#search");


if (memberSearch) {

    memberSearch.addEventListener(
        "input",
        () => {

            loadMembers();

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

async function loadAccount() {
    try {
        const user = await api("/auth/me");
        // Pages serves every HTML file as a public static asset. Keep members
        // on their permitted Watch Command view before initializing the roster UI.
        if (user.role === "member" && location.pathname !== "/watch-command") {
            location.replace("/watch-command");
            return;
        }
        currentUserIsAdmin = Boolean(user.is_admin);
        currentUserAccountId = String(user.account_id || user.id || "");
        currentUserIsCommand = Boolean(user.is_command);
        const commandSyncPanel = $("#commandSyncPanel");
        if (commandSyncPanel) commandSyncPanel.hidden = user.role === "member";
        const autoSyncControl = $("#autoSyncBtn");
        if (autoSyncControl) autoSyncControl.hidden = !(currentUserIsCommand || currentUserIsAdmin);
        currentInstructorTypes = String(user.instructor_type || "")
            .split("/").map(value => value.trim().toUpperCase()).filter(Boolean);
        const account = $("#accountName");
        if (account) account.textContent = user.name;
        const nameDisplay = $("#accountNameDisplay");
        if (nameDisplay) nameDisplay.textContent = `Signed in as ${user.name}`;
        const emailDisplay = $("#accountEmailDisplay");
        if (emailDisplay) emailDisplay.textContent = user.email || "";
        const leadersTab = $("#leadersTab");
        if (leadersTab) leadersTab.style.display = user.is_admin ? "" : "none";
        const inactiveTab = $("#inactiveTab");
        if (inactiveTab) inactiveTab.style.display = user.is_admin ? "" : "none";
        const terminationLogTab = $("#terminationLogTab");
        if (terminationLogTab) terminationLogTab.style.display = user.is_admin ? "" : "none";
        const instructorLogTab = $("#instructorLogTab");
        if (instructorLogTab) instructorLogTab.style.display = user.is_admin ? "" : "none";
    } catch {
        location.assign("/login");
    }
}

const accountDialog = $("#accountDialog");
accountDialog?.querySelectorAll("[data-toggle-passwords]").forEach(toggle => toggle.addEventListener("change", () => {
    const form = toggle.closest("form");
    form?.querySelectorAll('input[type="password"], input[type="text"][data-password-field]').forEach(input => {
        input.type = toggle.checked ? "text" : "password";
        input.toggleAttribute("data-password-field", toggle.checked);
    });
}));
$("#manageAccountButton")?.addEventListener("click", () => accountDialog?.classList.remove("hidden"));
$("#closeAccountDialog")?.addEventListener("click", () => accountDialog?.classList.add("hidden"));
accountDialog?.addEventListener("click", event => {
    if (event.target === accountDialog) accountDialog.classList.add("hidden");
});
$("#changePasswordForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    try {
        await api("/api/account/password", { method: "POST", body: JSON.stringify(body) });
        form.reset();
        accountDialog?.classList.add("hidden");
        toast("Password change queued; saving in background.");
    } catch (error) {
        toast(error.message);
    }
});

(async () => {

    await loadAccount();
    try {
        // Independent startup requests run together to avoid serial network
        // round trips before the portal becomes useful.
        await Promise.all([
            health(),
            loadNotifications(),
            loadConfig(),
            loadMembers(),
            loadMembersLog("promotion"),
        ]);
    } catch (e) {
        toast(e.message);
    }

})();

setInterval(() => { if (!document.hidden) syncStatus(); }, 60000);
setInterval(() => {
    if (!document.hidden) loadNotifications();
}, 120000);
