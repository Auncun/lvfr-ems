(() => {
  const pairs = [
    ['accountMenuButton', 'accountMenu', 340],
    ['topOnlineCount', 'onlineUsersPanel', 320],
    ['notificationButton', 'notificationPanel', 380],
    ['watchNotificationButton', 'watchNotificationPanel', 380]
  ];
  const position = (buttonId, panelId, preferredWidth) => {
    const button = document.getElementById(buttonId);
    const panel = document.getElementById(panelId);
    if (!button || !panel || panel.hidden || window.innerWidth > 700) return;

    const margin = 12;
    const width = Math.min(preferredWidth, window.innerWidth - margin * 2);
    const rect = button.getBoundingClientRect();
    const left = Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin));
    const top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 96));
    panel.style.position = 'fixed';
    panel.style.left = `${left}px`;
    panel.style.right = 'auto';
    panel.style.top = `${top}px`;
    panel.style.width = `${width}px`;
    panel.style.maxWidth = `calc(100vw - ${margin * 2}px)`;
    panel.style.maxHeight = `max(120px, calc(100dvh - ${top + margin}px))`;
    panel.style.overflow = 'auto';
  };

  const repositionOpen = () => pairs.forEach(([buttonId, panelId, width]) => position(buttonId, panelId, width));
  document.addEventListener('click', event => {
    const pair = pairs.find(([buttonId]) => event.target.closest(`#${buttonId}`));
    if (pair) window.setTimeout(() => position(...pair), 0);
  });
  window.addEventListener('resize', repositionOpen);
  window.addEventListener('orientationchange', repositionOpen);
})();
