(() => {
  const currentPath = location.pathname.replace(/\/$/, '') || '/';
  const pages = [
    {
      href: '/', title: 'LVFR EMS Operations', items: [
        { label: 'Members', tab: 'members' },
        { label: 'Eligible', tab: 'eligible' },
        { label: 'Do not Promote', tab: 'doNotPromote', availability: '#doNotPromoteTab' },
        { label: 'Inactive', tab: 'inactive' },
        { label: 'Members Log', tab: 'membersLog' },
        { label: 'Promotion Log', tab: 'membersLog', log: 'promotion', sub: true },
        { label: 'Callsign Log', tab: 'membersLog', log: 'callsign', sub: true },
        { label: 'Termination Log', tab: 'membersLog', log: 'termination', availability: '#terminationLogTab', sub: true },
        { label: 'Training Log', tab: 'membersLog', log: 'training', sub: true },
        { label: 'Exam Log', tab: 'membersLog', log: 'exam', sub: true },
        { label: 'Notes Log', tab: 'membersLog', log: 'note', sub: true },
        { label: 'Activity Log', tab: 'membersLog', log: 'activity', sub: true },
        { label: 'Instructor Log', tab: 'membersLog', log: 'instructor', availability: '#instructorLogTab', sub: true },
        { label: 'Instructors Directory', tab: 'instructorsDirectory', availability: '#instructorsDirectoryTab' },
        { label: 'Statistics', tab: 'statistics', availability: '#statisticsTab' },
        { label: 'Supervisors', tab: 'leaders', availability: '#leadersTab' },
        { label: 'Pending requests', tab: 'leaders', leader: 'pending', availability: '#leadersTab', sub: true },
        { label: 'All supervisors', tab: 'leaders', leader: 'all', availability: '#leadersTab', sub: true },
        { label: 'Supervisor history', tab: 'leaders', leader: 'audit', availability: '#leadersTab', sub: true }
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
        { label: 'Accounts', anchor: '#accountsHeading' },
        { label: 'All accounts', status: 'all', sub: true },
        { label: 'Pending accounts', status: 'pending', sub: true },
        { label: 'Active accounts', status: 'approved', sub: true },
        { label: 'Deactivated accounts', status: 'deactivated', sub: true },
        { label: 'Recent account activity', anchor: '#auditHeading' }
      ]
    }
  ];

  const esc = value => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const groupMarkup = (page, index) => `
    <section class="sidebar-page-group" data-sidebar-group ${page.admin ? 'data-admin-group="true"' : ''}>
      <div class="sidebar-page-head">
        <a class="sidebar-page-link" href="${page.href}" ${currentPath === page.href ? 'aria-current="page"' : ''}>${esc(page.title)}</a>
        <button type="button" class="sidebar-expand" aria-label="Show ${esc(page.title)} menus" aria-expanded="false" aria-controls="sidebarItems${index}">⌄</button>
      </div>
      <div class="sidebar-items" id="sidebarItems${index}" hidden>${page.items.map(item => {
        const cls = item.sub ? ' class="sidebar-subitem"' : '';
        const availability = item.availability ? ` data-availability="${item.availability}"` : '';
        if (item.anchor) return `<a${cls} href="${page.href}${item.anchor}" data-sidebar-item${availability}>${esc(item.label)}</a>`;
        const attrs = item.tab ? ` data-tab="${item.tab}"` : '';
        const extra = item.log ? ` data-log="${item.log}"` : item.leader ? ` data-leader="${item.leader}"` : item.status ? ` data-status="${item.status}"` : '';
        return `<button type="button"${cls} data-sidebar-item${attrs}${extra}${availability}>${esc(item.label)}</button>`;
      }).join('')}</div>
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
  sidebar.innerHTML = `<div class="sidebar-head"><strong>Navigation</strong><button type="button" class="sidebar-close" aria-label="Close navigation">×</button></div>
    <label class="sidebar-search"><input type="search" placeholder="Search pages and menus" aria-label="Search pages and menus"></label>
    <nav class="sidebar-nav">${pages.map(groupMarkup).join('')}</nav>`;
  document.body.append(backdrop, sidebar);

  const bottomNav = document.createElement('nav');
  bottomNav.className = 'bottom-app-nav';
  bottomNav.setAttribute('aria-label', 'Applications');
  bottomNav.innerHTML = pages.map(page => `<a href="${page.href}"${currentPath === page.href ? ' aria-current="page"' : ''}${page.admin ? ' data-admin-app="true"' : ''}><span aria-hidden="true">${page.href === '/' ? '⌂' : page.href === '/watch-command' ? '◷' : '⚙'}</span><small>${page.href === '/' ? 'EMS' : page.href === '/watch-command' ? 'Watch' : 'Command'}</small></a>`).join('');
  document.body.append(bottomNav);

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
      expand.setAttribute('aria-expanded', String(!isExpanded));
      items.hidden = isExpanded;
      return;
    }
    const item = event.target.closest('[data-sidebar-item]');
    if (!item) return;
    const targetTab = item.dataset.tab;
    if (targetTab) {
      document.querySelector(`[data-tab="${targetTab}"]`)?.click();
      if (item.dataset.log) document.querySelector(`[data-log="${item.dataset.log}"]`)?.click();
      if (item.dataset.leader) document.querySelector(`[data-leader-view="${item.dataset.leader}"]`)?.click();
      close();
      return;
    }
    if (item.dataset.status) {
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
    sidebar.querySelectorAll('[data-sidebar-group]').forEach(group => {
      const accessAllowed = !group.dataset.adminGroup || adminAllowed;
      const pageLink = group.querySelector('.sidebar-page-link');
      const pageMatch = pageLink.textContent.toLocaleLowerCase().includes(query);
      const itemsContainer = group.querySelector('.sidebar-items');
      const expandButton = group.querySelector('.sidebar-expand');
      let anyVisible = false;
      group.querySelectorAll('[data-sidebar-item]').forEach(item => {
        const available = !item.dataset.availability || (() => {
          const node = document.querySelector(item.dataset.availability);
          return !!node && getComputedStyle(node).display !== 'none';
        })();
        const matches = !query || pageMatch || item.textContent.toLocaleLowerCase().includes(query);
        item.hidden = !available || !matches;
        if (!item.hidden) anyVisible = true;
      });
      itemsContainer.hidden = expandButton.getAttribute('aria-expanded') !== 'true';
      group.hidden = !accessAllowed || (!pageMatch && !anyVisible);
    });
  });

  const refreshAccess = () => {
    const user = window.lvfrCachedUser?.();
    const adminLink = bottomNav.querySelector('[data-admin-app]');
    if (adminLink) adminLink.hidden = currentPath !== '/administration' && !user?.is_admin;
    sidebar.querySelector('input').dispatchEvent(new Event('input'));
  };
  refreshAccess();
  if (document.querySelector('.tabs')) {
    new MutationObserver(refreshAccess).observe(document.querySelector('.tabs'), { subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  }
  window.addEventListener('pageshow', refreshAccess);
})();
