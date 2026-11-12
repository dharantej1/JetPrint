(() => {
  const params = new URLSearchParams(window.location.search);
  let machineId = (params.get('machine_id') || '').trim();

  const state = {
    pricing: { bwPerPagePaise: 200, colorPerPagePaise: 1000, shopName: '' },
    files: [], // { file: File, estPages: number }
    color: false,
    copies: 1,
    currentJob: null,
    pollTimer: null,
  };

  const els = {
    shopName: document.getElementById('shopName'),
    kioskStatus: document.getElementById('kioskStatus'),
    machineLookupCard: document.getElementById('machineLookupCard'),
    machineForm: document.getElementById('machineForm'),
    machineIdInput: document.getElementById('machineIdInput'),
    kioskOfflineBanner: document.getElementById('kioskOfflineBanner'),
    errorBanner: document.getElementById('errorBanner'),
    uploadSection: document.getElementById('uploadSection'),
    bwRate: document.getElementById('bwRate'),
    colorRate: document.getElementById('colorRate'),
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    fileList: document.getElementById('fileList'),
    btnBw: document.getElementById('btnBw'),
    btnColor: document.getElementById('btnColor'),
    copiesMinus: document.getElementById('copiesMinus'),
    copiesPlus: document.getElementById('copiesPlus'),
    copiesVal: document.getElementById('copiesVal'),
    estPages: document.getElementById('estPages'),
    estTotal: document.getElementById('estTotal'),
    payBtn: document.getElementById('payBtn'),
    paymentSection: document.getElementById('paymentSection'),
    paymentSummary: document.getElementById('paymentSummary'),
    devPayBox: document.getElementById('devPayBox'),
    devPayBtn: document.getElementById('devPayBtn'),
    razorpayWaitingBox: document.getElementById('razorpayWaitingBox'),
    reopenRazorpayBtn: document.getElementById('reopenRazorpayBtn'),
    otpSection: document.getElementById('otpSection'),
    otpDisplay: document.getElementById('otpDisplay'),
    jobIdLabel: document.getElementById('jobIdLabel'),
    newPrintBtn: document.getElementById('newPrintBtn'),
  };

  function formatInr(paise) {
    return '₹' + (paise / 100).toFixed(2);
  }

  function showError(msg) {
    els.errorBanner.textContent = msg;
    els.errorBanner.hidden = !msg;
  }

  async function estimatePdfPages(file) {
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      return 1;
    }
    try {
      const text = await file.text();
      const matches = text.match(/\/Type\s*\/Page\b(?!s)/g);
      return matches && matches.length > 0 ? matches.length : 1;
    } catch {
      return 1;
    }
  }

  async function loadMachine() {
    if (!machineId) {
      els.kioskStatus.textContent = 'No Kiosk';
      els.machineLookupCard.hidden = false;
      els.uploadSection.hidden = true;
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
        els.uploadSection.hidden = true;
        return;
      }
      const data = await res.json();
      state.pricing = data.pricing;
      els.shopName.textContent = data.pricing.shopName || `Kiosk ${machineId}`;
      els.bwRate.textContent = formatInr(data.pricing.bwPerPagePaise);
      els.colorRate.textContent = formatInr(data.pricing.colorPerPagePaise);

      if (data.online) {
        els.kioskStatus.textContent = 'Online';
        els.kioskStatus.className = 'status-pill online';
        els.kioskOfflineBanner.hidden = true;
      } else {
        els.kioskStatus.textContent = 'Offline';
        els.kioskStatus.className = 'status-pill offline';
        els.kioskOfflineBanner.hidden = false;
      }

      els.uploadSection.hidden = false;
      renderSummary();
    } catch {
      showError('Unable to reach Cloud Relay server.');
    }
  }

  function renderFileList() {
    els.fileList.innerHTML = '';
    state.files.forEach((entry, idx) => {
      const li = document.createElement('li');
      li.className = 'file-item';
      const kb = Math.max(1, Math.round(entry.file.size / 1024));
      li.innerHTML = `
        <div class="file-meta">
          <div class="file-name">${escapeHtml(entry.file.name)}</div>
          <div class="file-sub">${kb} KB • ~${entry.estPages} page${entry.estPages > 1 ? 's' : ''}</div>
        </div>
        <button type="button" class="remove-btn" aria-label="Remove file">✕</button>
      `;
      li.querySelector('.remove-btn').addEventListener('click', () => {
        state.files.splice(idx, 1);
        renderFileList();
        renderSummary();
      });
      els.fileList.appendChild(li);
    });
  }

  function renderSummary() {
    const pagesPerCopy = state.files.reduce((sum, f) => sum + f.estPages, 0);
    const totalPages = pagesPerCopy * state.copies;
    const rate = state.color
      ? state.pricing.colorPerPagePaise
      : state.pricing.bwPerPagePaise;
    const totalPaise = totalPages * rate;

    els.copiesVal.textContent = String(state.copies);
    els.estPages.textContent = String(totalPages);
    els.estTotal.textContent = formatInr(totalPaise);
    els.payBtn.disabled = state.files.length === 0;
    els.payBtn.textContent =
      state.files.length === 0
        ? 'Upload & Pay'
        : `Upload & Pay ${formatInr(totalPaise)}`;
  }

  async function addFiles(fileList) {
    showError('');
    for (const file of Array.from(fileList)) {
      if (state.files.length >= 10) break;
      const estPages = await estimatePdfPages(file);
      state.files.push({ file, estPages });
    }
    renderFileList();
    renderSummary();
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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
      description: `${job.total_pages} page(s) • ${job.print_settings.color ? 'Color' : 'B&W'}`,
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
        startStatusPolling(job.job_id);
      },
    };
    const rzp = new window.Razorpay(options);
    rzp.open();
  }

  function showOtp(jobId, otp) {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
    els.paymentSection.hidden = true;
    els.uploadSection.hidden = true;
    els.otpSection.hidden = false;
    els.otpDisplay.textContent = otp;
    els.jobIdLabel.textContent = `Job ID: ${jobId}`;
  }

  function startStatusPolling(jobId) {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/status`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.otp) {
          showOtp(jobId, data.otp);
        }
      } catch {
        // ignore transient poll errors
      }
    }, 1500);
  }

  // Event listeners
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

  els.btnBw.addEventListener('click', () => {
    state.color = false;
    els.btnBw.classList.add('active');
    els.btnColor.classList.remove('active');
    renderSummary();
  });

  els.btnColor.addEventListener('click', () => {
    state.color = true;
    els.btnColor.classList.add('active');
    els.btnBw.classList.remove('active');
    renderSummary();
  });

  els.copiesMinus.addEventListener('click', () => {
    if (state.copies > 1) {
      state.copies -= 1;
      renderSummary();
    }
  });

  els.copiesPlus.addEventListener('click', () => {
    if (state.copies < 100) {
      state.copies += 1;
      renderSummary();
    }
  });

  els.payBtn.addEventListener('click', async () => {
    if (state.files.length === 0) return;
    showError('');
    els.payBtn.disabled = true;
    els.payBtn.textContent = 'Uploading…';

    try {
      const form = new FormData();
      form.append('machine_id', machineId);
      form.append('copies', String(state.copies));
      form.append('color', String(state.color));
      for (const entry of state.files) {
        form.append('files', entry.file);
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
      els.uploadSection.hidden = true;
      els.paymentSection.hidden = false;
      els.paymentSummary.textContent = `${data.total_pages} page(s) • ${
        data.print_settings.color ? 'Color' : 'B&W'
      } • Total ${formatInr(data.amount_paise)}`;

      if (data.dev_mode) {
        els.devPayBox.hidden = false;
        els.razorpayWaitingBox.hidden = true;
      } else {
        els.devPayBox.hidden = true;
        els.razorpayWaitingBox.hidden = false;
        await loadRazorpayScript();
        openRazorpayCheckout(data);
        startStatusPolling(data.job_id);
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Upload failed');
      renderSummary();
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
      showOtp(data.job_id, data.otp);
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

  els.newPrintBtn.addEventListener('click', () => {
    state.files = [];
    state.copies = 1;
    state.color = false;
    state.currentJob = null;
    els.btnBw.classList.add('active');
    els.btnColor.classList.remove('active');
    els.otpSection.hidden = true;
    els.paymentSection.hidden = true;
    els.devPayBtn.disabled = false;
    els.devPayBtn.textContent = 'Simulate UPI Payment (GPay / PhonePe / Paytm)';
    els.uploadSection.hidden = false;
    renderFileList();
    renderSummary();
  });

  void loadMachine();
})();
