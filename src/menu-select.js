function iconChevron() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'chev');
  svg.setAttribute('viewBox', '0 0 10 10');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M1.5 3.5 5 7l3.5-3.5');
  svg.appendChild(path);
  return svg;
}

/**
 * 브라우저가 그리는 OS 기본 메뉴 대신 기존 select의 값·change 이벤트를 보존하는
 * 유리 표면 메뉴를 만든다. select는 데이터의 단일 진실 공급원으로 남는다.
 */
export function createMenuSelect(select, { mobileBreakpoint = 720 } = {}) {
  if (!select || select.dataset.menuSelectReady === 'true') return null;
  select.dataset.menuSelectReady = 'true';
  const wrap = document.createElement('div');
  wrap.className = 'dropdown';
  select.before(wrap);
  wrap.appendChild(select);
  select.classList.add('dropdown-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'dropdown-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', `${select.id}-menu`);
  if (select.title) trigger.title = select.title;
  const label = document.createElement('span');
  label.className = 'dropdown-label';
  trigger.append(label, iconChevron());
  wrap.appendChild(trigger);

  const list = document.createElement('ul');
  list.id = `${select.id}-menu`;
  list.className = 'dropdown-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.appendChild(list);

  let optionEls = [];
  const buildOptions = () => {
    list.innerHTML = '';
    optionEls = [...select.options].map((option) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.className = 'dropdown-option';
      li.textContent = option.textContent;
      li.dataset.value = option.value;
      li.tabIndex = -1;
      list.appendChild(li);
      return li;
    });
  };
  const syncLabel = () => {
    label.textContent = select.options[select.selectedIndex]?.textContent ?? '';
    optionEls.forEach((option) => option.setAttribute('aria-selected', String(option.dataset.value === select.value)));
  };
  const close = ({ restoreFocus = false } = {}) => {
    list.hidden = true;
    wrap.classList.remove('dropdown-open', 'dropdown-sheet');
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  };
  const open = () => {
    const sheet = window.matchMedia(`(max-width: ${mobileBreakpoint}px)`).matches;
    wrap.classList.toggle('dropdown-sheet', sheet);
    wrap.classList.add('dropdown-open');
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    (optionEls.find((option) => option.dataset.value === select.value) ?? optionEls[0])?.focus();
  };
  const choose = (option) => {
    if (!option?.dataset?.value) return;
    select.value = option.dataset.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    syncLabel();
    close({ restoreFocus: true });
  };

  trigger.addEventListener('click', () => (list.hidden ? open() : close()));
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });
  list.addEventListener('click', (event) => choose(event.target.closest('.dropdown-option')));
  list.addEventListener('keydown', (event) => {
    const index = optionEls.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); optionEls[Math.min(optionEls.length - 1, index + 1)]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); optionEls[Math.max(0, index - 1)]?.focus(); }
    else if (event.key === 'Home') { event.preventDefault(); optionEls[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); optionEls.at(-1)?.focus(); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(document.activeElement); }
    else if (event.key === 'Escape') { event.preventDefault(); close({ restoreFocus: true }); }
    else if (event.key === 'Tab') close();
  });
  select.addEventListener('change', syncLabel);
  document.addEventListener('click', (event) => { if (!wrap.contains(event.target)) close(); });
  window.addEventListener('resize', () => { if (!list.hidden) close(); });

  buildOptions();
  syncLabel();
  return { close, refresh: () => { buildOptions(); syncLabel(); }, trigger, list };
}
