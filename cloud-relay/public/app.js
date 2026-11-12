(() => {
  const STORAGE_KEY = 'jetprint_active_jobs';
  const params = new URLSearchParams(window.location.search);
  let machineId = (params.get('machine_id') || '').trim();

  const state = {
    pricing: { bwPerPagePaise: 200, colorPerPagePaise: 1000, shopName: '' },
    docs: [], // { id, file, pageCount, pdfDoc, objectUrl, settings: { copies, color, duplex, orientation, pagesPerSheet, pageRange } }
    activeIndex: 0,
    moreExpanded: false,
    currentJob: null,
    activeOtps: [], // [{ jobId, otp, machineId, status, error, createdAt }]
    otpPollTimer: null,
    razorpayPollTimer: null,
    modalPage: 1,
  };

  const els = {
    shopName: document.getElementById('shopName'),
    kioskStatus: document.getElementById('kioskStatus'),
    topUploadBtn: document.getElementById('topUploadBtn'),
    fileInput: document.getElementById('fileInput'),
    activeOtpContainer: document.getElementById('activeOtpContainer'),
    machineLookupCard: document.getElementById('machineLookupCard'),
    machineForm: document.getElementById('machineForm'),
    machineIdInput: document.getElementById('machineIdInput'),
    kioskOfflineBanner: document.getElementById('kioskOfflineBanner'),
    errorBanner: document.getElementById('errorBanner'),
    emptyUploadCard: document.getElementById('emptyUploadCard'),
    bwRateEmpty: document.getElementById('bwRateEmpty'),
    colorRateEmpty: document.getElementById('colorRateEmpty'),
    dropzone: document.getElementById('dropzone'),
    workspaceSection: document.getElementById('workspaceSection'),
    docCounter: document.getElementById('docCounter'),
    activeDocName: document.getElementById('activeDocName'),
    deleteDocBtn: document.getElementById('deleteDocBtn'),
    prevDocBtn: document.getElementById('prevDocBtn'),
    nextDocBtn: document.getElementById('nextDocBtn'),
    thumbSheetStage: document.getElementById('thumbSheetStage'),
    thumbDuplexBadge: document.getElementById('thumbDuplexBadge'),
    openPreviewBtn: document.getElementById('openPreviewBtn'),
    activeDocPages: document.getElementById('activeDocPages'),
    activeDocCost: document.getElementById('activeDocCost'),
    copiesMinus: document.getElementById('copiesMinus'),
    copiesPlus: document.getElementById('copiesPlus'),
    copiesVal: document.getElementById('copiesVal'),
    btnBw: document.getElementById('btnBw'),
    btnColor: document.getElementById('btnColor'),
    bwRateBtn: document.getElementById('bwRateBtn'),
    colorRateBtn: document.getElementById('colorRateBtn'),
    btn1Sided: document.getElementById('btn1Sided'),
    btn2Sided: document.getElementById('btn2Sided'),
    btnPortrait: document.getElementById('btnPortrait'),
    btnLandscape: document.getElementById('btnLandscape'),
    moreToggleBtn: document.getElementById('moreToggleBtn'),
    moreToggleIcon: document.getElementById('moreToggleIcon'),
    morePanel: document.getElementById('morePanel'),
    ppsGroup: document.getElementById('ppsGroup'),
    btnRangeAll: document.getElementById('btnRangeAll'),
    btnRangeCustom: document.getElementById('btnRangeCustom'),
    pageRangeInput: document.getElementById('pageRangeInput'),
    paymentSection: document.getElementById('paymentSection'),
    paymentSummary: document.getElementById('paymentSummary'),
    devPayBox: document.getElementById('devPayBox'),
    devPayBtn: document.getElementById('devPayBtn'),
    razorpayWaitingBox: document.getElementById('razorpayWaitingBox'),
    reopenRazorpayBtn: document.getElementById('reopenRazorpayBtn'),
    cancelPayBtn: document.getElementById('cancelPayBtn'),
    stickyFooter: document.getElementById('stickyFooter'),
    totalPagesLabel: document.getElementById('totalPagesLabel'),
    totalCostLabel: document.getElementById('totalCostLabel'),
    payBtn: document.getElementById('payBtn'),
    previewModal: document.getElementById('previewModal'),
    modalDocTitle: document.getElementById('modalDocTitle'),
    closePreviewBtn: document.getElementById('closePreviewBtn'),
    modalSheetStage: document.getElementById('modalSheetStage'),
    modalPageNav: document.getElementById('modalPageNav'),
    modalPrevPage: document.getElementById('modalPrevPage'),
    modalNextPage: document.getElementById('modalNextPage'),
    modalPageLabel: document.getElementById('modalPageLabel'),
  };

  function formatInr(paise) {
    return '₹' + (paise / 100).toFixed(2);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showError(msg) {
    els.errorBanner.textContent = msg;
    els.errorBanner.hidden = !msg;
  }

  function getSelectedPageList(pageRange, totalPages) {
    const maxPage = Math.max(1, totalPages);
    const trimmed = (pageRange || '').trim().toLowerCase();
    if (!trimmed || trimmed === 'all') {
      return Array.from({ length: maxPage }, (_, i) => i + 1);
    }

    const selected = [];
    const seen = new Set();
    for (const part of trimmed.split(',')) {
      const token = part.trim();
      if (!token) continue;
      const m = /^(\d+)\s*-\s*(\d+)$/.exec(token);
      if (m) {
        const a = Math.max(1, Math.min(maxPage, Number(m[1])));
        const b = Math.max(1, Math.min(maxPage, Number(m[2])));
        const step = a <= b ? 1 : -1;
        for (let p = a; step > 0 ? p <= b : p >= b; p += step) {
          if (!seen.has(p)) {
            seen.add(p);
            selected.push(p);
          }
        }
      } else {
        const single = Number(token);
        if (Number.isInteger(single) && single >= 1 && single <= maxPage && !seen.has(single)) {
          seen.add(single);
          selected.push(single);
        }
      }
    }

    return selected.length > 0
      ? selected
      : Array.from({ length: maxPage }, (_, i) => i + 1);
  }

  function countSelectedPages(pageRange, totalPages) {
    return getSelectedPageList(pageRange, totalPages).length;
  }

  function buildSheets(doc) {
    const pages = getSelectedPageList(doc.settings.pageRange, doc.pageCount);
    const pps = doc.settings.pagesPerSheet || 1;
    const sheets = [];
    for (let i = 0; i < pages.length; i += pps) {
      sheets.push(pages.slice(i, i + pps));
    }
    if (sheets.length === 0) sheets.push([1]);
    return { sheets, totalSheets: sheets.length };
  }

  function formatSheetLabel(sheetIndex, totalSheets, duplex) {
    if (duplex === '2-sided') {
      const physicalSheet = Math.floor(sheetIndex / 2) + 1;
      const side = sheetIndex % 2 === 0 ? 'Front' : 'Back';
      return `Sheet ${physicalSheet} (${side}) • ${sheetIndex + 1}/${totalSheets}`;
    }
    return `Sheet ${sheetIndex + 1} of ${totalSheets}`;
  }

  function computeDocTotals(doc) {
    const selected = countSelectedPages(doc.settings.pageRange, doc.pageCount);
    const sheetsPerCopy = Math.ceil(selected / doc.settings.pagesPerSheet);
    const billableSheets = sheetsPerCopy * doc.settings.copies;
    const rate = doc.settings.color
      ? state.pricing.colorPerPagePaise
      : state.pricing.bwPerPagePaise;
    return {
      selected,
      billableSheets,
      amountPaise: billableSheets * rate,
    };
  }

  // =========================================================================
  // Persistent Active OTPs (localStorage + polling)
  // =========================================================================

  function loadStoredOtps() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveStoredOtps() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.activeOtps));
    } catch {
      // ignore quota errors
    }
  }

  function addActiveOtp(jobId, otp, targetMachineId) {
    const existing = state.activeOtps.find((item) => item.jobId === jobId);
    if (!existing) {
      state.activeOtps.unshift({
        jobId,
        otp,
        machineId: targetMachineId,
        status: 'dispatched',
        error: null,
        createdAt: Date.now(),
      });
      saveStoredOtps();
    }
    renderActiveOtps();
    ensureOtpPolling();
  }

  function statusLabel(status) {
    switch (status) {
      case 'paid':
      case 'dispatched':
        return 'Waiting for OTP at Kiosk';
      case 'printing':
        return 'Printing...';
      case 'printed':
        return 'Print Completed!';
      case 'failed':
        return 'Print Failed';
      default:
        return 'Waiting for OTP at Kiosk';
    }
  }

  function renderActiveOtps() {
    if (state.activeOtps.length === 0) {
      els.activeOtpContainer.hidden = true;
      els.activeOtpContainer.innerHTML = '';
      return;
    }

    els.activeOtpContainer.hidden = false;
    els.activeOtpContainer.innerHTML = '';

    state.activeOtps.forEach((entry) => {
      const card = document.createElement('div');
      const isDone = entry.status === 'printed' || entry.status === 'failed';
      card.className = `card otp-card${entry.status === 'failed' ? ' failed' : ''}`;
      const badgeClass =
        entry.status === 'printed'
          ? 'printed'
          : entry.status === 'failed'
          ? 'failed'
          : '';
      card.innerHTML = `
        <span class="otp-status-badge ${badgeClass}">${escapeHtml(statusLabel(entry.status))}</span>
        <h2>Active Print OTP</h2>
        <p class="muted">Enter this 6-digit OTP on Kiosk <strong>${escapeHtml(entry.machineId)}</strong></p>
        <div class="otp-display">${escapeHtml(entry.otp)}</div>
        ${entry.error ? `<p class="muted" style="color:#fca5a5">${escapeHtml(entry.error)}</p>` : ''}
        <p class="muted" style="font-size:0.75rem">Job: ${escapeHtml(entry.jobId)}</p>
        ${isDone ? `<button type="button" class="btn btn-secondary dismiss-otp-btn">Dismiss</button>` : ''}
      `;
      if (isDone) {
        card.querySelector('.dismiss-otp-btn').addEventListener('click', () => {
          state.activeOtps = state.activeOtps.filter((x) => x.jobId !== entry.jobId);
          saveStoredOtps();
          renderActiveOtps();
        });
      }
      els.activeOtpContainer.appendChild(card);
    });
  }

  async function pollActiveOtps() {
    const pending = state.activeOtps.filter(
      (x) => x.status !== 'printed' && x.status !== 'failed'
    );
    if (pending.length === 0) {
      if (state.otpPollTimer) {
        clearInterval(state.otpPollTimer);
        state.otpPollTimer = null;
      }
      return;
    }

    let changed = false;
    for (const entry of pending) {
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(entry.jobId)}/status`);
        if (res.status === 404) {
          entry.status = 'failed';
          entry.error = 'Job expired on server';
          changed = true;
          continue;
        }
        if (!res.ok) continue;
        const data = await res.json();
        if (data.status !== entry.status || data.error !== entry.error) {
          entry.status = data.status;
          entry.error = data.error || null;
          changed = true;
        }
      } catch {
        // ignore transient errors
      }
    }

    if (changed) {
      saveStoredOtps();
      renderActiveOtps();
    }
  }

  function ensureOtpPolling() {
    const hasPending = state.activeOtps.some(
      (x) => x.status !== 'printed' && x.status !== 'failed'
    );
    if (hasPending && !state.otpPollTimer) {
      state.otpPollTimer = setInterval(() => {
        void pollActiveOtps();
      }, 2500);
    }
  }

  // =========================================================================
  // PDF.js & File Loading
  // =========================================================================

  async function parseDocMetadata(file) {
    const isPdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const objectUrl = URL.createObjectURL(file);

    if (!isPdf) {
      return { pageCount: 1, pdfDoc: null, objectUrl };
    }

    if (window.pdfjsLib) {
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        const buf = await file.arrayBuffer();
        const pdfDoc = await window.pdfjsLib.getDocument({ data: buf }).promise;
        return { pageCount: pdfDoc.numPages || 1, pdfDoc, objectUrl };
      } catch {
        // fallback below
      }
    }

    try {
      const text = await file.text();
      const matches = text.match(/\/Type\s*\/Page\b(?!s)/g);
      return {
        pageCount: matches && matches.length > 0 ? matches.length : 1,
        pdfDoc: null,
        objectUrl,
      };
    } catch {
      return { pageCount: 1, pdfDoc: null, objectUrl };
    }
  }

  async function renderPdfPageToCanvas(pdfDoc, pageNum, canvas, maxWidth) {
    const page = await pdfDoc.getPage(pageNum);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = maxWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
  }

  async function addFiles(fileList) {
    showError('');
    for (const file of Array.from(fileList)) {
      if (state.docs.length >= 10) break;
      const meta = await parseDocMetadata(file);
      state.docs.push({
        id: Math.random().toString(36).slice(2),
        file,
        pageCount: meta.pageCount,
        pdfDoc: meta.pdfDoc,
        objectUrl: meta.objectUrl,
        settings: {
          copies: 1,
          color: false,
          duplex: '1-sided',
          orientation: 'portrait',
          pagesPerSheet: 1,
          pageRange: 'all',
        },
      });
    }
    if (state.docs.length > 0) {
      state.activeIndex = state.docs.length - 1;
    }
    renderWorkspace();
  }

  function nupGridClass(pps, orientation) {
    if (pps === 2) return orientation === 'landscape' ? 'nup-2-landscape' : 'nup-2-portrait';
    if (pps === 4) return 'nup-4';
    if (pps === 6) return orientation === 'landscape' ? 'nup-6-landscape' : 'nup-6-portrait';
    return 'nup-1';
  }

  async function renderSheetInto(doc, sheetIndex, stageEl, maxCellWidth) {
    const token = String(Number(stageEl.dataset.renderToken || '0') + 1);
    stageEl.dataset.renderToken = token;

    const { sheets } = buildSheets(doc);
    const clampedIdx = Math.max(0, Math.min(sheets.length - 1, sheetIndex));
    const pageNums = sheets[clampedIdx];
    const s = doc.settings;

    const sheet = document.createElement('div');
    sheet.className = [
      'preview-sheet',
      s.orientation === 'landscape' ? 'sheet-landscape' : 'sheet-portrait',
      s.color ? '' : 'is-bw',
      nupGridClass(s.pagesPerSheet, s.orientation),
    ]
      .filter(Boolean)
      .join(' ');

    const isPdf =
      doc.file.type === 'application/pdf' ||
      doc.file.name.toLowerCase().endsWith('.pdf');

    const cells = pageNums.map((pageNum) => {
      const cell = document.createElement('div');
      cell.className = 'nup-cell';
      if (!isPdf) {
        const img = document.createElement('img');
        img.src = doc.objectUrl;
        img.alt = doc.file.name;
        cell.appendChild(img);
      } else if (doc.pdfDoc) {
        const canvas = document.createElement('canvas');
        cell.appendChild(canvas);
        if (s.pagesPerSheet > 1) {
          const tag = document.createElement('span');
          tag.className = 'nup-page-tag';
          tag.textContent = `p.${pageNum}`;
          cell.appendChild(tag);
        }
        void renderPdfPageToCanvas(doc.pdfDoc, pageNum, canvas, maxCellWidth).catch(() => {
          cell.innerHTML = `<div class="nup-fallback">Page ${pageNum}</div>`;
        });
      } else {
        cell.innerHTML = `<div class="nup-fallback">📄<br/>Page ${pageNum}</div>`;
      }
      return cell;
    });

    // Pad empty cells in N-up grid for visual sheet accuracy
    const totalSlots = s.pagesPerSheet;
    for (let i = pageNums.length; i < totalSlots; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = 'nup-cell';
      sheet.appendChild(emptyCell);
    }
    // Insert populated cells before empty slots
    for (let i = cells.length - 1; i >= 0; i--) {
      sheet.prepend(cells[i]);
    }

    if (stageEl.dataset.renderToken === token) {
      stageEl.innerHTML = '';
      stageEl.appendChild(sheet);
    }
  }

  async function renderThumbnail(doc) {
    const { totalSheets } = buildSheets(doc);
    if (doc.settings.duplex === '2-sided') {
      els.thumbDuplexBadge.hidden = false;
      els.thumbDuplexBadge.textContent = `2-sided • ${totalSheets} side${totalSheets > 1 ? 's' : ''}`;
    } else {
      els.thumbDuplexBadge.hidden = false;
      els.thumbDuplexBadge.textContent = `1-sided • ${totalSheets} sheet${totalSheets > 1 ? 's' : ''}`;
    }

    const cellWidth = doc.settings.pagesPerSheet > 1 ? 120 : 220;
    await renderSheetInto(doc, 0, els.thumbSheetStage, cellWidth);
  }

  function renderWorkspace() {
    const hasDocs = state.docs.length > 0;
    els.emptyUploadCard.hidden = hasDocs || !machineId;
    els.workspaceSection.hidden = !hasDocs;
    els.stickyFooter.hidden = !hasDocs;
    els.topUploadBtn.hidden = !machineId;

    if (!hasDocs) {
      return;
    }

    if (state.activeIndex >= state.docs.length) {
      state.activeIndex = state.docs.length - 1;
    }

    const doc = state.docs[state.activeIndex];
    const totals = computeDocTotals(doc);

    els.docCounter.textContent = `${state.activeIndex + 1} / ${state.docs.length}`;
    els.activeDocName.textContent = doc.file.name;
    els.prevDocBtn.disabled = state.activeIndex === 0;
    els.nextDocBtn.disabled = state.activeIndex === state.docs.length - 1;
    els.activeDocPages.textContent = `${doc.pageCount} page${doc.pageCount > 1 ? 's' : ''} (${totals.billableSheets} billable)`;
    els.activeDocCost.textContent = formatInr(totals.amountPaise);

    void renderThumbnail(doc);

    // Sync settings controls to active doc
    const s = doc.settings;
    els.copiesVal.textContent = String(s.copies);
    els.btnBw.classList.toggle('active', !s.color);
    els.btnColor.classList.toggle('active', s.color);
    els.btn1Sided.classList.toggle('active', s.duplex === '1-sided');
    els.btn2Sided.classList.toggle('active', s.duplex === '2-sided');
    els.btnPortrait.classList.toggle('active', s.orientation === 'portrait');
    els.btnLandscape.classList.toggle('active', s.orientation === 'landscape');

    els.ppsGroup.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.pps) === s.pagesPerSheet);
    });

    const isAll = !s.pageRange || s.pageRange.toLowerCase() === 'all';
    els.btnRangeAll.classList.toggle('active', isAll);
    els.btnRangeCustom.classList.toggle('active', !isAll);
    els.pageRangeInput.hidden = isAll;
    if (!isAll) {
      els.pageRangeInput.value = s.pageRange;
    }

    // Grand totals
    let grandPages = 0;
    let grandPaise = 0;
    for (const d of state.docs) {
      const t = computeDocTotals(d);
      grandPages += t.billableSheets;
      grandPaise += t.amountPaise;
    }
    els.totalPagesLabel.textContent = String(grandPages);
    els.totalCostLabel.textContent = formatInr(grandPaise);
    els.payBtn.disabled = false;
    els.payBtn.textContent = `Proceed To Pay`;
  }

  // =========================================================================
  // Preview Modal
  // =========================================================================

  async function renderModalContent() {
    const doc = state.docs[state.activeIndex];
    if (!doc) return;

    const { totalSheets } = buildSheets(doc);
    if (state.modalPage > totalSheets) state.modalPage = totalSheets;
    if (state.modalPage < 1) state.modalPage = 1;

    els.modalDocTitle.textContent = `${doc.file.name} (${doc.settings.color ? 'Color' : 'B&W'})`;
    const cellWidth = doc.settings.pagesPerSheet > 1 ? 220 : 420;
    await renderSheetInto(doc, state.modalPage - 1, els.modalSheetStage, cellWidth);

    els.modalPageNav.hidden = false;
    els.modalPageLabel.textContent = formatSheetLabel(
      state.modalPage - 1,
      totalSheets,
      doc.settings.duplex
    );
    els.modalPrevPage.disabled = state.modalPage <= 1;
    els.modalNextPage.disabled = state.modalPage >= totalSheets;
  }

  // =========================================================================
  // Machine & Payment Flow
  // =========================================================================

  async function loadMachine() {
    if (!machineId) {
      els.kioskStatus.textContent = 'No Kiosk';
      els.machineLookupCard.hidden = false;
      els.emptyUploadCard.hidden = true;
      els.workspaceSection.hidden = true;
      els.stickyFooter.hidden = true;
      return;
    }

    els.machineLookupCard.hidden = true;
    showError('');

    try {
      const res = await fetch(`/api/machines/${encodeURIComponent(machineId)}`);
      if (!res.ok) {
        els.kioskStatus.textContent = 'Not Found';
        els.kioskStatus.className = 'status-pill offline';
        showError(`Kiosk "${machineId}" was not found. Please check the QR code.`);
        return;
      }
      const data = await res.json();
      state.pricing = data.pricing;
      els.shopName.textContent = data.pricing.shopName || `Kiosk ${machineId}`;
      els.bwRateEmpty.textContent = formatInr(data.pricing.bwPerPagePaise);
      els.colorRateEmpty.textContent = formatInr(data.pricing.colorPerPagePaise);
      els.bwRateBtn.textContent = formatInr(data.pricing.bwPerPagePaise);
      els.colorRateBtn.textContent = formatInr(data.pricing.colorPerPagePaise);

      if (data.online) {
        els.kioskStatus.textContent = 'Online';
        els.kioskStatus.className = 'status-pill online';
        els.kioskOfflineBanner.hidden = true;
      } else {
        els.kioskStatus.textContent = 'Offline';
        els.kioskStatus.className = 'status-pill offline';
        els.kioskOfflineBanner.hidden = false;
      }

      renderWorkspace();
    } catch {
      showError('Unable to reach Cloud Relay server.');
    }
  }

  function loadRazorpayScript() {
    return new Promise((resolve, reject) => {
      if (window.Razorpay) return resolve();
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load Razorpay Checkout'));
      document.body.appendChild(script);
    });
  }

  function openRazorpayCheckout(job) {
    const options = {
      key: job.razorpay_key_id,
      amount: job.amount_paise,
      currency: job.currency || 'INR',
      name: state.pricing.shopName || 'JetPrint Kiosk',
      description: `${job.total_pages} billable page(s)`,
      order_id: job.order_id,
      config: {
        display: {
          blocks: {
            upi: {
              name: 'Pay via UPI (GPay, PhonePe, Paytm)',
              instruments: [{ method: 'upi' }],
            },
          },
          sequence: ['block.upi'],
          preferences: { show_default_blocks: true },
        },
      },
      handler: () => {
        startRazorpayPolling(job.job_id);
      },
    };
    const rzp = new window.Razorpay(options);
    rzp.open();
  }

  function startRazorpayPolling(jobId) {
    if (state.razorpayPollTimer) clearInterval(state.razorpayPollTimer);
    state.razorpayPollTimer = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/status`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.otp) {
          clearInterval(state.razorpayPollTimer);
          state.razorpayPollTimer = null;
          onPaymentConfirmed(jobId, data.otp);
        }
      } catch {
        // ignore
      }
    }, 1500);
  }

  function onPaymentConfirmed(jobId, otp) {
    addActiveOtp(jobId, otp, machineId);
    state.docs.forEach((d) => URL.revokeObjectURL(d.objectUrl));
    state.docs = [];
    state.activeIndex = 0;
    state.currentJob = null;
    els.paymentSection.hidden = true;
    els.devPayBtn.disabled = false;
    els.devPayBtn.textContent = 'Simulate UPI Payment (GPay / PhonePe / Paytm)';
    renderWorkspace();
  }

  // =========================================================================
  // Event Listeners
  // =========================================================================

  els.machineForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = els.machineIdInput.value.trim();
    if (!val) return;
    machineId = val;
    const url = new URL(window.location.href);
    url.searchParams.set('machine_id', machineId);
    window.history.replaceState({}, '', url.toString());
    void loadMachine();
  });

  els.topUploadBtn.addEventListener('click', () => els.fileInput.click());

  els.fileInput.addEventListener('change', (e) => {
    if (e.target.files) {
      void addFiles(e.target.files);
      e.target.value = '';
    }
  });

  els.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.dropzone.classList.add('dragover');
  });
  els.dropzone.addEventListener('dragleave', () => {
    els.dropzone.classList.remove('dragover');
  });
  els.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.dropzone.classList.remove('dragover');
    if (e.dataTransfer?.files) {
      void addFiles(e.dataTransfer.files);
    }
  });

  els.prevDocBtn.addEventListener('click', () => {
    if (state.activeIndex > 0) {
      state.activeIndex -= 1;
      renderWorkspace();
    }
  });

  els.nextDocBtn.addEventListener('click', () => {
    if (state.activeIndex < state.docs.length - 1) {
      state.activeIndex += 1;
      renderWorkspace();
    }
  });

  els.deleteDocBtn.addEventListener('click', () => {
    const removed = state.docs.splice(state.activeIndex, 1)[0];
    if (removed) URL.revokeObjectURL(removed.objectUrl);
    if (state.activeIndex >= state.docs.length && state.activeIndex > 0) {
      state.activeIndex -= 1;
    }
    renderWorkspace();
  });

  els.copiesMinus.addEventListener('click', () => {
    const doc = state.docs[state.activeIndex];
    if (doc && doc.settings.copies > 1) {
      doc.settings.copies -= 1;
      renderWorkspace();
    }
  });

  els.copiesPlus.addEventListener('click', () => {
    const doc = state.docs[state.activeIndex];
    if (doc && doc.settings.copies < 100) {
      doc.settings.copies += 1;
      renderWorkspace();
    }
  });

  els.btnBw.addEventListener('click', () => {
    const doc = state.docs[state.activeIndex];
    if (doc) {
      doc.settings.color = false;
      renderWorkspace();
    }
  });

  els.btnColor.addEventListener('click', () => {
    const doc = state.docs[state.activeIndex];
    if (doc) {
      doc.settings.color = true;
      renderWorkspace();
    }
  });

  els.btn1Sided.addEventListener('click', () => {
    const doc = state.docs[state.activeIndex];
    if (doc) {
      doc.settings.duplex = '1-sided';
      renderWorkspace();
    }
  });

  els.btn2Sided.addEventListener('click', () => {
    const doc = state.docs[state.activeIndex];
    if (doc) {
      doc.settings.duplex = '2-sided';
      renderWorkspace();
    }
  });

  els.btnPortrait.addEventListener('click', () => {
    const doc = state.docs[state.activeIndex];
    if (doc) {
      doc.settings.orientation = 'portrait';
      renderWorkspace();
    }
  });

  els.btnLandscape.addEventListener('click', () => {
    const doc = state.docs[state.activeIndex];
    if (doc) {
      doc.settings.orientation = 'landscape';
      renderWorkspace();
    }
  });

  els.moreToggleBtn.addEventListener('click', () => {
    state.moreExpanded = !state.moreExpanded;
    els.morePanel.hidden = !state.moreExpanded;
    els.moreToggleIcon.textContent = state.moreExpanded ? '▴' : '▾';
  });

  els.ppsGroup.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const doc = state.docs[state.activeIndex];
      if (doc) {
        doc.settings.pagesPerSheet = Number(btn.dataset.pps) || 1;
        renderWorkspace();
      }
    });
  });

  els.btnRangeAll.addEventListener('click', () => {
    const doc = state.docs[state.activeIndex];
    if (doc) {
      doc.settings.pageRange = 'all';
      renderWorkspace();
    }
  });

  els.btnRangeCustom.addEventListener('click', () => {
    const doc = state.docs[state.activeIndex];
    if (doc) {
      if (doc.settings.pageRange === 'all') {
        doc.settings.pageRange = `1-${doc.pageCount}`;
      }
      renderWorkspace();
      els.pageRangeInput.focus();
    }
  });

  els.pageRangeInput.addEventListener('input', () => {
    const doc = state.docs[state.activeIndex];
    if (doc) {
      doc.settings.pageRange = els.pageRangeInput.value || 'all';
      const totals = computeDocTotals(doc);
      els.activeDocPages.textContent = `${doc.pageCount} page${doc.pageCount > 1 ? 's' : ''} (${totals.billableSheets} billable)`;
      els.activeDocCost.textContent = formatInr(totals.amountPaise);
      let grandPages = 0;
      let grandPaise = 0;
      for (const d of state.docs) {
        const t = computeDocTotals(d);
        grandPages += t.billableSheets;
        grandPaise += t.amountPaise;
      }
      els.totalPagesLabel.textContent = String(grandPages);
      els.totalCostLabel.textContent = formatInr(grandPaise);
      void renderThumbnail(doc);
    }
  });

  // Preview Modal events
  els.openPreviewBtn.addEventListener('click', () => {
    state.modalPage = 1;
    els.previewModal.hidden = false;
    void renderModalContent();
  });

  els.closePreviewBtn.addEventListener('click', () => {
    els.previewModal.hidden = true;
  });

  els.modalPrevPage.addEventListener('click', () => {
    if (state.modalPage > 1) {
      state.modalPage -= 1;
      void renderModalContent();
    }
  });

  els.modalNextPage.addEventListener('click', () => {
    const doc = state.docs[state.activeIndex];
    if (doc) {
      const { totalSheets } = buildSheets(doc);
      if (state.modalPage < totalSheets) {
        state.modalPage += 1;
        void renderModalContent();
      }
    }
  });

  // Payment events
  els.payBtn.addEventListener('click', async () => {
    if (state.docs.length === 0) return;
    showError('');
    els.payBtn.disabled = true;
    els.payBtn.textContent = 'Uploading…';

    try {
      const form = new FormData();
      form.append('machine_id', machineId);
      form.append(
        'per_file_settings',
        JSON.stringify(state.docs.map((d) => d.settings))
      );
      for (const d of state.docs) {
        form.append('files', d.file);
      }

      const res = await fetch('/api/jobs', {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      state.currentJob = data;
      els.workspaceSection.hidden = true;
      els.stickyFooter.hidden = true;
      els.paymentSection.hidden = false;
      els.paymentSummary.textContent = `${data.files.length} document(s) • ${data.total_pages} billable page(s) • Total ${formatInr(data.amount_paise)}`;

      if (data.dev_mode) {
        els.devPayBox.hidden = false;
        els.razorpayWaitingBox.hidden = true;
      } else {
        els.devPayBox.hidden = true;
        els.razorpayWaitingBox.hidden = false;
        await loadRazorpayScript();
        openRazorpayCheckout(data);
        startRazorpayPolling(data.job_id);
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Upload failed');
      renderWorkspace();
    }
  });

  els.devPayBtn.addEventListener('click', async () => {
    if (!state.currentJob) return;
    els.devPayBtn.disabled = true;
    els.devPayBtn.textContent = 'Processing…';
    try {
      const res = await fetch(
        `/api/dev/jobs/${encodeURIComponent(state.currentJob.job_id)}/pay`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Dev payment failed');
      }
      onPaymentConfirmed(data.job_id, data.otp);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Payment failed');
      els.devPayBtn.disabled = false;
      els.devPayBtn.textContent = 'Simulate UPI Payment (GPay / PhonePe / Paytm)';
    }
  });

  els.reopenRazorpayBtn.addEventListener('click', () => {
    if (state.currentJob && !state.currentJob.dev_mode) {
      openRazorpayCheckout(state.currentJob);
    }
  });

  els.cancelPayBtn.addEventListener('click', () => {
    if (state.razorpayPollTimer) {
      clearInterval(state.razorpayPollTimer);
      state.razorpayPollTimer = null;
    }
    els.paymentSection.hidden = true;
    renderWorkspace();
  });

  // Init
  state.activeOtps = loadStoredOtps();
  renderActiveOtps();
  ensureOtpPolling();
  void pollActiveOtps();
  void loadMachine();
})();
