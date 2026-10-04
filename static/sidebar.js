(() => {
  const currentPath = location.pathname.replace(/\/$/, '') || '/';
  const pages = [
    {
      href: '/', title: 'LVFR EMS Operations', items: [
        { label: 'Members', tab: 'members' },
        { label: 'Training', children: [
          { label: 'FORT', tab: 'trainingDirectory', training: 'FORT' },
          { label: 'HERT', tab: 'trainingDirectory', training: 'HERT' }
        ] },
        { label: 'Eligible', tab: 'eligible' },
        { label: 'Do not Promote', tab: 'doNotPromote', availability: '#doNotPromoteTab' },
        { label: 'Inactive', tab: 'inactive' },
        { label: 'Members Log', tab: 'membersLog', children: [
          { label: 'Promotion Log', tab: 'membersLog', log: 'promotion' },
          { label: 'Callsign Log', tab: 'membersLog', log: 'callsign' },
          { label: 'Termination Log', tab: 'membersLog', log: 'termination', availability: '#terminationLogTab' },
          { label: 'Training Log', tab: 'membersLog', log: 'training' },
          { label: 'Exam Log', tab: 'membersLog', log: 'exam' },
          { label: 'Notes Log', tab: 'membersLog', log: 'note' },
          { label: 'Activity Log', tab: 'membersLog', log: 'activity' },
          { label: 'Instructor Log', tab: 'membersLog', log: 'instructor', availability: '#instructorLogTab' }
        ] },
        { label: 'Instructors Directory', tab: 'instructorsDirectory', availability: '#instructorsDirectoryTab' },
        { label: 'Statistics', tab: 'statistics', availability: '#statisticsTab' },
        { label: 'Supervisors', tab: 'leaders', availability: '#leadersTab', children: [
          { label: 'Pending requests', tab: 'leaders', leader: 'pending', availability: '#leadersTab' },
          { label: 'All supervisors', tab: 'leaders', leader: 'all', availability: '#leadersTab' },
          { label: 'Supervisor history', tab: 'leaders', leader: 'audit', availability: '#leadersTab' }
        ] }
      ]
    },
    {
      href: '/watch-command', title: 'Watch Command', items: [
        { label: 'New Watch Log', anchor: '#watchForm' },
        { label: 'Current Active Status', anchor: '#activePresenceHeading' },
        { label: 'Initial Roll Call', anchor: '#initialRollcallHeading' },
        { label: 'Quick Sign in / Unit Status', anchor: '#quickSigninHeading' },
        { label: 'Sector Coverage', anchor: '#sectorHeading' },
        { label: 'Operational Notes', anchor: '#operationalHeading' },
        { label: 'Recent Watch Logs', anchor: '#previousWatchesHeading' }
      ]
    },
    {
      href: '/administration', title: 'Operation Command', admin: true, items: [
        { label: 'Accounts', anchor: '#accountsHeading', children: [
          { label: 'All accounts', status: 'all' },
          { label: 'Pending accounts', status: 'pending' },
          { label: 'Active accounts', status: 'approved' },
          { label: 'Deactivated accounts', status: 'deactivated' }
        ] },
        { label: 'Recent account activity', anchor: '#auditHeading' }
      ]
    }
  ];

  const esc = value => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  let entryId = 0;
  const itemMarkup = (page, item, depth = 0) => {
    const children = Array.isArray(item.children) ? item.children : [];
    const id = `sidebarTree${entryId++}`;
    const availability = item.availability ? ` data-availability="${item.availability}"` : '';
    const attrs = item.tab ? ` data-tab="${item.tab}"` : '';
    const extra = item.log ? ` data-log="${item.log}"` : item.leader ? ` data-leader="${item.leader}"` : item.status ? ` data-status="${item.status}"` : item.training ? ` data-training="${item.training}"` : '';
    const control = item.anchor
      ? `<a class="sidebar-item-action" href="${page.href}${item.anchor}" data-sidebar-item data-page="${page.href}"${availability}>${esc(item.label)}</a>`
      : `<button class="sidebar-item-action" type="button" data-sidebar-item data-page="${page.href}"${attrs}${extra}${availability}>${esc(item.label)}</button>`;
    const expand = children.length
      ? `<button type="button" class="sidebar-expand sidebar-tree-expand" aria-label="Show ${esc(item.label)} submenus" title="Show submenus" aria-expanded="false" aria-controls="${id}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>`
      : '';
    return `<div class="sidebar-tree-entry" data-sidebar-entry data-page="${page.href}" data-depth="${depth}"${availability}>
      <div class="sidebar-item-row">${control}${expand}</div>
      ${children.length ? `<div class="sidebar-children" id="${id}" hidden>${children.map(child => itemMarkup(page, child, depth + 1)).join('')}</div>` : ''}
    </div>`;
  };
  const groupMarkup = (page, index) => `
    <section class="sidebar-page-group" data-sidebar-group ${page.admin ? 'data-admin-group="true"' : ''}>
      <div class="sidebar-page-head">
        <a class="sidebar-page-link" href="${page.href}" ${currentPath === page.href ? 'aria-current="page"' : ''}>${esc(page.title)}</a>
        <button type="button" class="sidebar-expand" aria-label="Show ${esc(page.title)} menus" title="Show menus" aria-expanded="false" aria-controls="sidebarItems${index}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
      </div>
      <div class="sidebar-items" id="sidebarItems${index}" hidden>${page.items.map(item => itemMarkup(page, item)).join('')}</div>
    </section>`;

  const toggle = document.querySelector('.sidebar-toggle');
  if (!toggle) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  backdrop.hidden = true;
  backdrop.setAttribute('aria-hidden', 'true');
  const sidebar = document.createElement('aside');
  sidebar.id = 'appSidebar';
  sidebar.className = 'app-sidebar';
  sidebar.hidden = true;
  sidebar.setAttribute('aria-label', 'Page navigation');
  const currentPageTitle = pages.find(page => page.href === currentPath)?.title || (currentPath === '/portal' ? 'Portal' : '');
  sidebar.innerHTML = `<div class="sidebar-head"><div class="sidebar-head-title"><strong>Navigation</strong>${currentPageTitle ? `<span class="sidebar-current-page">${esc(currentPageTitle)}</span>` : ''}</div><button type="button" class="sidebar-close" aria-label="Close navigation">×</button></div>
    <label class="sidebar-search"><input type="search" placeholder="Search pages and menus" aria-label="Search pages and menus"></label>
    <nav class="sidebar-nav">${pages.map(groupMarkup).join('')}</nav>`;
  document.body.append(backdrop, sidebar);

  let bottomNav = null;
  if (currentPath !== '/portal') {
    bottomNav = document.createElement('nav');
    bottomNav.className = 'bottom-app-nav';
    bottomNav.setAttribute('aria-label', 'Applications');
    bottomNav.innerHTML = pages.map(page => `<a href="${page.href}"${currentPath === page.href ? ' aria-current="page"' : ''}${page.admin ? ' data-admin-app="true"' : ''}><span aria-hidden="true">${page.href === '/' ? '⌂' : page.href === '/watch-command' ? '◷' : '⚙'}</span><small>${page.href === '/' ? 'EMS' : page.href === '/watch-command' ? 'Watch' : 'Command'}</small></a>`).join('');
    document.body.append(bottomNav);
  }

  const close = () => {
    sidebar.classList.remove('is-open');
    backdrop.hidden = true;
    document.body.classList.remove('sidebar-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus();
    window.setTimeout(() => { if (!sidebar.classList.contains('is-open')) sidebar.hidden = true; }, 210);
  };
  const open = () => {
    sidebar.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add('sidebar-open');
    toggle.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => sidebar.classList.add('is-open'));
    sidebar.querySelector('input').focus();
  };
  toggle.addEventListener('click', open);
  sidebar.querySelector('.sidebar-close').addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !sidebar.hidden) close(); });

  sidebar.addEventListener('click', event => {
    const expand = event.target.closest('.sidebar-expand');
    if (expand) {
      const items = document.getElementById(expand.getAttribute('aria-controls'));
      const isExpanded = expand.getAttribute('aria-expanded') === 'true';
      const group = expand.closest('[data-sidebar-group], [data-sidebar-entry]');
      expand.setAttribute('aria-expanded', String(!isExpanded));
      items.hidden = isExpanded;
      group.classList.toggle('is-expanded', !isExpanded);
      return;
    }
    const item = event.target.closest('[data-sidebar-item]');
    if (!item) return;
    const targetTab = item.dataset.tab;
    if (targetTab) {
      if (item.dataset.page !== currentPath) {
        sessionStorage.setItem('lvfr.sidebar.pending-navigation', JSON.stringify({
          page: item.dataset.page, tab: targetTab, log: item.dataset.log || '', leader: item.dataset.leader || ''
        }));
        location.assign(item.dataset.page);
        return;
      }
      document.querySelector(`[data-tab="${targetTab}"]`)?.click();
      if (item.dataset.training) document.querySelector(`[data-training-view="${item.dataset.training}"]`)?.click();
      if (item.dataset.log) document.querySelector(`[data-log="${item.dataset.log}"]`)?.click();
      if (item.dataset.leader) document.querySelector(`[data-leader-view="${item.dataset.leader}"]`)?.click();
      close();
      return;
    }
    if (item.dataset.status) {
      if (item.dataset.page !== currentPath) {
        sessionStorage.setItem('lvfr.sidebar.pending-navigation', JSON.stringify({ page: item.dataset.page, status: item.dataset.status }));
        location.assign(item.dataset.page);
        return;
      }
      document.querySelector(`.admin-tabs [data-status="${item.dataset.status}"]`)?.click();
      document.querySelector('#accountsHeading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      close();
      return;
    }
    if (item.matches('a') && new URL(item.href).pathname === currentPath) {
      close();
      window.setTimeout(() => document.querySelector(new URL(item.href).hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 220);
    }
  });

  sidebar.querySelector('input').addEventListener('input', event => {
    const query = event.target.value.trim().toLocaleLowerCase();
    const user = window.lvfrCachedUser?.();
    const adminAllowed = currentPath === '/administration' || !!user?.is_admin;
    const filterEntries = container => {
      let anyVisible = false;
      container.querySelectorAll(':scope > [data-sidebar-entry]').forEach(entry => {
        const action = entry.querySelector(':scope > .sidebar-item-row [data-sidebar-item]');
        const expandButton = entry.querySelector(':scope > .sidebar-item-row .sidebar-tree-expand');
        const children = entry.querySelector(':scope > .sidebar-children');
        const available = menuEntryAvailable(entry);
        const ownMatch = !query || action.textContent.toLocaleLowerCase().includes(query);
        const childMatch = children ? filterEntries(children) : false;
        const visible = available && (ownMatch || childMatch);
        entry.hidden = !visible;
        if (action) action.hidden = !available || !ownMatch;
        if (children) {
          const expanded = expandButton.getAttribute('aria-expanded') === 'true';
          children.hidden = !expanded;
          entry.classList.toggle('is-expanded', expanded);
        }
        anyVisible ||= visible;
      });
      return anyVisible;
    };
    sidebar.querySelectorAll('[data-sidebar-group]').forEach(group => {
      const accessAllowed = !group.dataset.adminGroup || adminAllowed;
      const pageLink = group.querySelector('.sidebar-page-link');
      const pageMatch = pageLink.textContent.toLocaleLowerCase().includes(query);
      const itemsContainer = group.querySelector('.sidebar-items');
      const expandButton = group.querySelector('.sidebar-expand');
      const anyVisible = filterEntries(itemsContainer);
      const isExpanded = expandButton.getAttribute('aria-expanded') === 'true';
      itemsContainer.hidden = !isExpanded;
      group.classList.toggle('is-expanded', isExpanded);
      group.hidden = !accessAllowed || (!pageMatch && !anyVisible);
    });
  });

  function menuEntryAvailable(entry) {
    const selector = entry.dataset.availability;
    if (!selector) return true;
    const node = document.querySelector(selector);
    if (node) return getComputedStyle(node).display !== 'none';
    if (entry.dataset.page === currentPath) return false;
    const user = window.lvfrCachedUser?.();
    const role = String(user?.role || '').toLowerCase();
    if (['#doNotPromoteTab', '#terminationLogTab', '#instructorLogTab', '#instructorsDirectoryTab', '#leadersTab'].includes(selector)) return !!user?.is_admin;
    if (selector === '#inactiveTab') return !!(user?.is_admin || user?.is_command);
    if (selector === '#statisticsTab') return !!(user?.is_admin || user?.is_command || ['leader', 'supervisor', 'command', 'commander'].includes(role));
    return true;
  }

  function setActiveMenuItem(action) {
    sidebar.querySelectorAll('.sidebar-item-action.is-active').forEach(item => {
      item.classList.remove('is-active');
      item.removeAttribute('aria-current');
    });
    sidebar.querySelectorAll('.sidebar-tree-entry.is-active, .sidebar-tree-entry.has-active-child').forEach(entry => {
      entry.classList.remove('is-active', 'has-active-child');
    });
    if (!action) return;
    action.classList.add('is-active');
    action.setAttribute('aria-current', 'location');
    let entry = action.closest('[data-sidebar-entry]');
    if (entry) entry.classList.add('is-active');
    while (entry) {
      entry = entry.parentElement.closest('[data-sidebar-entry]');
      if (entry) entry.classList.add('has-active-child');
    }
  }

  function refreshActiveNavigation() {
    if (currentPath === '/') {
      const tab = document.querySelector('.tabs .tab.active')?.dataset.tab;
      if (!tab) return setActiveMenuItem(null);
      let selector = `[data-sidebar-item][data-tab="${tab}"]`;
      if (tab === 'membersLog') {
        const log = document.querySelector('.log-tabs .log-tab.active[data-log]')?.dataset.log;
        if (log) selector += `[data-log="${log}"]`;
      } else if (tab === 'leaders') {
        const view = document.querySelector('.leader-view-tab.active[data-leader-view]')?.dataset.leaderView;
        if (view) selector += `[data-leader="${view}"]`;
      } else {
        selector += ':not([data-log]):not([data-leader])';
      }
      return setActiveMenuItem(sidebar.querySelector(`.sidebar-page-group[data-sidebar-group] .sidebar-item-action${selector}`));
    }
    if (currentPath === '/administration') {
      const auditHeading = document.querySelector('#auditHeading');
      if (auditHeading && auditHeading.getBoundingClientRect().top <= 170) {
        return setActiveMenuItem(sidebar.querySelector('[data-sidebar-item][href$="#auditHeading"]'));
      }
      const status = document.querySelector('.admin-tabs [aria-pressed="true"]')?.dataset.status;
      if (status) return setActiveMenuItem(sidebar.querySelector(`[data-sidebar-item][data-status="${status}"]`));
      return setActiveMenuItem(sidebar.querySelector('[data-sidebar-item][href$="#accountsHeading"]'));
    }
    if (currentPath === '/watch-command') {
      const anchors = [...sidebar.querySelectorAll('.sidebar-page-group[data-sidebar-group] .sidebar-item-action[data-page="/watch-command"][href*="#"]')];
      let active = anchors[0] || null;
      for (const item of anchors) {
        const target = document.querySelector(new URL(item.href).hash);
        if (target && target.getBoundingClientRect().top <= 170) active = item;
      }
      return setActiveMenuItem(active);
    }
    setActiveMenuItem(null);
  }

  function activatePendingNavigation() {
    activatePendingNavigation.attempts = (activatePendingNavigation.attempts || 0) + 1;
    let pending;
    try { pending = JSON.parse(sessionStorage.getItem('lvfr.sidebar.pending-navigation') || 'null'); } catch {}
    if (!pending || pending.page !== currentPath) return;
    if (pending.status) {
      sessionStorage.removeItem('lvfr.sidebar.pending-navigation');
      document.querySelector(`.admin-tabs [data-status="${pending.status}"]`)?.click();
      document.querySelector('#accountsHeading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(null, '', location.pathname);
      return;
    }
    const tab = document.querySelector(`[data-tab="${pending.tab}"]`);
    if (!tab) {
      sessionStorage.removeItem('lvfr.sidebar.pending-navigation');
      return;
    }
    if (getComputedStyle(tab).display === 'none') {
      if (activatePendingNavigation.attempts < 40) window.setTimeout(activatePendingNavigation, 120);
      else sessionStorage.removeItem('lvfr.sidebar.pending-navigation');
      return;
    }
    sessionStorage.removeItem('lvfr.sidebar.pending-navigation');
    tab.click();
    if (pending.log) document.querySelector(`[data-log="${pending.log}"]`)?.click();
    if (pending.leader) document.querySelector(`[data-leader-view="${pending.leader}"]`)?.click();
    history.replaceState(null, '', location.pathname);
  }
  window.setTimeout(activatePendingNavigation, 0);

  const refreshAccess = () => {
    const user = window.lvfrCachedUser?.();
    const adminLink = bottomNav?.querySelector('[data-admin-app]');
    if (adminLink) adminLink.hidden = currentPath !== '/administration' && !user?.is_admin;
    sidebar.querySelector('input').dispatchEvent(new Event('input'));
    refreshActiveNavigation();
  };
  refreshAccess();
  document.addEventListener('click', event => {
    if (event.target.closest('.tabs, .log-tabs, .admin-tabs')) requestAnimationFrame(refreshActiveNavigation);
  });
  const navigationObservers = ['.tabs', '.log-tabs', '.admin-tabs']
    .map(selector => document.querySelector(selector)).filter(Boolean);
  navigationObservers.forEach(container => new MutationObserver(refreshActiveNavigation)
    .observe(container, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-pressed', 'style'] }));
  let scrollUpdatePending = false;
  window.addEventListener('scroll', () => {
    if (currentPath !== '/watch-command' || scrollUpdatePending) return;
    scrollUpdatePending = true;
    requestAnimationFrame(() => { scrollUpdatePending = false; refreshActiveNavigation(); });
  }, { passive: true });
  window.addEventListener('pageshow', refreshAccess);
})();
