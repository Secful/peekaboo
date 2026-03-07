/* Filtering, sorting, and pagination */

function updateMethodFilters() {
  const methods = [...new Set(appState.endpoints.map(e => e.method))].sort();
  const container = document.getElementById('methodFilters');
  container.innerHTML = '';
  methods.forEach(m => {
    const btn = document.createElement('span');
    btn.className = 'filter-btn' + (appState.activeFilters.has(m) ? ' active' : '');
    btn.textContent = m;
    btn.onclick = () => {
      appState.activeFilters.has(m) ? appState.activeFilters.delete(m) : appState.activeFilters.add(m);
      appState.currentPage = 1; // Reset to first page when filter changes
      applyFilters();
      updateMethodFilters();
    };
    container.appendChild(btn);
  });
}

function setDomainFilter(filter) {
  appState.domainFilter = filter;
  // Update button states
  ['All', 'Subdomain', 'External'].forEach(f => {
    const btn = document.getElementById(`domain${f}`);
    if (btn) {
      btn.classList.toggle('active', f.toLowerCase() === filter);
    }
  });
  appState.currentPage = 1; // Reset to first page when filter changes
  applyFilters();
}

function setApiFilter(filter) {
  appState.apiFilter = filter;
  // Update button states
  ['All', 'Confirmed', 'Maybe', 'None'].forEach(f => {
    const btn = document.getElementById(`api${f}`);
    if (btn) {
      btn.classList.toggle('active', f.toLowerCase() === filter);
    }
  });
  appState.currentPage = 1; // Reset to first page when filter changes
  applyFilters();
}

function setStatusFilter(filter) {
  appState.statusFilter = filter;
  // Update button states
  ['All', '2xx', '3xx', '4xx', '5xx', 'None'].forEach(f => {
    const btn = document.getElementById(`status${f}`);
    if (btn) {
      btn.classList.toggle('active', f.toLowerCase() === filter);
    }
  });
  appState.currentPage = 1; // Reset to first page when filter changes
  applyFilters();
}

function applyFilters() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  const matchingRows = [];

  // First pass: determine which rows match filters
  document.querySelectorAll('#tbody tr').forEach(tr => {
    const text = `${tr.dataset.method} ${tr.dataset.path} ${tr.dataset.host}`.toLowerCase();
    const matchQ = !q || text.includes(q);
    const matchM = appState.activeFilters.size === 0 || appState.activeFilters.has(tr.dataset.method);

    // Domain filter
    let matchD = true;
    if (appState.domainFilter !== 'all' && appState.targetDomain) {
      const isSub = isSubdomainEndpoint(tr.dataset.host);
      matchD = (appState.domainFilter === 'subdomain' && isSub) ||
               (appState.domainFilter === 'external' && !isSub);
    }

    // API confidence filter
    let matchAPI = true;
    if (appState.apiFilter !== 'all') {
      const ep = JSON.parse(tr.dataset.endpoint);
      if (appState.apiFilter === 'confirmed') {
        matchAPI = ep.api_confidence === 'API';
      } else if (appState.apiFilter === 'maybe') {
        matchAPI = ep.api_confidence === 'Maybe API';
      } else if (appState.apiFilter === 'none') {
        matchAPI = !ep.api_confidence || (ep.api_confidence !== 'API' && ep.api_confidence !== 'Maybe API');
      }
    }

    // Status code filter
    let matchStatus = true;
    if (appState.statusFilter !== 'all') {
      const ep = JSON.parse(tr.dataset.endpoint);
      const status = ep.response_status;
      if (appState.statusFilter === '2xx') {
        matchStatus = status >= 200 && status < 300;
      } else if (appState.statusFilter === '3xx') {
        matchStatus = status >= 300 && status < 400;
      } else if (appState.statusFilter === '4xx') {
        matchStatus = status >= 400 && status < 500;
      } else if (appState.statusFilter === '5xx') {
        matchStatus = status >= 500 && status < 600;
      } else if (appState.statusFilter === 'none') {
        matchStatus = !status;
      }
    }

    const matches = matchQ && matchM && matchD && matchAPI && matchStatus;
    if (matches) {
      matchingRows.push(tr);
    }
  });

  // Calculate pagination
  const totalMatching = matchingRows.length;
  const totalPages = Math.ceil(totalMatching / appState.itemsPerPage);

  // Ensure current page is valid
  if (appState.currentPage > totalPages && totalPages > 0) {
    appState.currentPage = totalPages;
  }
  if (appState.currentPage < 1) {
    appState.currentPage = 1;
  }

  const startIdx = (appState.currentPage - 1) * appState.itemsPerPage;
  const endIdx = startIdx + appState.itemsPerPage;

  // Second pass: show/hide rows based on filters and pagination
  let rowIndex = 0;
  document.querySelectorAll('#tbody tr').forEach(tr => {
    const isMatching = matchingRows.includes(tr);
    const isInPage = isMatching && rowIndex >= startIdx && rowIndex < endIdx;
    tr.style.display = isInPage ? '' : 'none';

    // Update row number for visible rows
    if (isMatching) {
      const rowNumber = rowIndex + 1; // 1-based numbering
      const rowNumberCell = tr.querySelector('.row-number');
      if (rowNumberCell) {
        rowNumberCell.textContent = rowNumber;
      }
      rowIndex++;
    }
  });

  // Show/hide empty state
  const emptyState = document.getElementById('emptyState');
  const tbody = document.getElementById('tbody');
  if (tbody.children.length === 0) {
    emptyState.innerHTML = '<div class="icon">📡</div><div>Waiting for API endpoints to appear...</div>';
    emptyState.style.display = 'block';
  } else if (totalMatching === 0) {
    emptyState.innerHTML = '<div class="icon">🔍</div><div>No records found</div>';
    emptyState.style.display = 'block';
  } else {
    emptyState.style.display = 'none';
  }

  // Update pagination UI
  updatePagination(totalMatching, totalPages);
}

function updatePagination(totalMatching, totalPages) {
  const pagination = document.getElementById('pagination');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const pageNumbers = document.getElementById('pageNumbers');

  // Show pagination only if more than itemsPerPage endpoints
  if (totalMatching > appState.itemsPerPage) {
    pagination.style.display = 'flex';

    // Update button states
    prevBtn.disabled = appState.currentPage === 1;
    nextBtn.disabled = appState.currentPage === totalPages;

    // Render page numbers (show max 7 page buttons)
    pageNumbers.innerHTML = '';
    const maxButtons = 7;
    let startPage = Math.max(1, appState.currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);

    // Adjust start if we're near the end
    if (endPage - startPage < maxButtons - 1) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }

    // First page button
    if (startPage > 1) {
      const btn = createPageButton(1);
      pageNumbers.appendChild(btn);
      if (startPage > 2) {
        const ellipsis = document.createElement('span');
        ellipsis.textContent = '...';
        ellipsis.style.padding = '0.4rem 0.5rem';
        ellipsis.style.color = 'var(--text-muted)';
        pageNumbers.appendChild(ellipsis);
      }
    }

    // Page number buttons
    for (let i = startPage; i <= endPage; i++) {
      const btn = createPageButton(i);
      pageNumbers.appendChild(btn);
    }

    // Last page button
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        const ellipsis = document.createElement('span');
        ellipsis.textContent = '...';
        ellipsis.style.padding = '0.4rem 0.5rem';
        ellipsis.style.color = 'var(--text-muted)';
        pageNumbers.appendChild(ellipsis);
      }
      const btn = createPageButton(totalPages);
      pageNumbers.appendChild(btn);
    }
  } else {
    pagination.style.display = 'none';
  }
}

function createPageButton(pageNum) {
  const btn = document.createElement('span');
  btn.className = 'page-num' + (pageNum === appState.currentPage ? ' active' : '');
  btn.textContent = pageNum;
  btn.onclick = () => {
    appState.currentPage = pageNum;
    applyFilters();
  };
  return btn;
}

function changePage(delta) {
  appState.currentPage += delta;
  applyFilters();
}

function sortBy(col) {
  if (appState.sortCol === col) appState.sortAsc = !appState.sortAsc;
  else { appState.sortCol = col; appState.sortAsc = true; }
  const colIdx = {method:0,path:1,host:2,status:3,reason:4}[col];
  const tbody = document.getElementById('tbody');
  const rows = [...tbody.querySelectorAll('tr')];
  rows.sort((a,b) => {
    const av = a.children[colIdx].textContent.trim();
    const bv = b.children[colIdx].textContent.trim();
    return appState.sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
  });
  rows.forEach(r => tbody.appendChild(r));
  applyFilters(); // Re-apply filters and pagination after sorting
}
