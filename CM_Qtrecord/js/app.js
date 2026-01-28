let distributionMap = {}; // { baseRoomKey: Set(seatStr) }
        let itemNameDisplay = "(업로드 전)";
        let localSessionLogs = []; // Session log storage

        function normalize(str) {
            return String(str || "").replace(/\s+/g, "").trim();
        }

        // Match only up to "관" + "층" (ignore trailing room section number like ...층1/2/3)
        // Examples:
        // 1관B1층1 -> 1관B1층
        // 1관5층2  -> 1관5층
        // 3관(두원) 2층3 -> 3관(두원)2층
        function baseRoomKey(str) {
            const s = normalize(str);

            // Handle 3관(두원)
            if (s.startsWith('3관(두원)')) {
                const m = s.match(/^(3관\(두원\))(B1층|\d+층)/);
                if (m) return `${m[1]}${m[2]}`;
                return s;
            }

            const b = s.match(/^(\d+관)/);
            const building = b ? b[1] : '';

            if (s.includes('B1층')) {
                return `${building}B1층`;
            }

            const f = s.match(/(\d+)층/);
            if (f) {
                return `${building}${f[1]}층`;
            }

            // Fallback to full normalized string
            return s;
        }

        function escapeHtml(s) {
            return String(s || '')
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#39;');
        }

        function setHeader(tabId) {
            const pageTitleEl = document.getElementById('pageTitle');
            if (!pageTitleEl) return;

            if (tabId === 'MAIN') {
                pageTitleEl.innerHTML = `
                    <div class="title-room">메인</div>
                    <div class="title-item">${escapeHtml(itemNameDisplay)}</div>
                `;
                document.title = `${itemNameDisplay} 메인 배부명단`;
                return;
            }

            if (tabId === 'SUMMARY') {
                pageTitleEl.innerHTML = `
                    <div class="title-room">총배부 수량</div>
                    <div class="title-item">${escapeHtml(itemNameDisplay)}</div>
                `;
                document.title = `${itemNameDisplay} 총배부 수량`;
                return;
            }

            pageTitleEl.innerHTML = `
                <div class="title-room">${escapeHtml(tabId)}</div>
                <div class="title-item">${escapeHtml(itemNameDisplay)}</div>
            `;
            document.title = `${tabId} - ${itemNameDisplay}`;
        }

        function openTab(evt, tabName) {
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-button').forEach(el => el.classList.remove('active'));

            document.getElementById(tabName).classList.add('active');
            if (evt) evt.currentTarget.classList.add('active');

            setHeader(tabName);
        }

        // Summary grouping label, already at 관/층 granularity
        function roomGroupLabelFromTabId(tabId) {
            if (!tabId) return "";
            if (tabId.startsWith('3관(두원)')) {
                const m = tabId.match(/^(3관\(두원\))\s*(B1층|\d+층)/);
                if (m) return `${m[1]} ${m[2]}`;
                return '3관(두원)';
            }
            const bm = tabId.match(/^(\d+관)/);
            const building = bm ? bm[1] : '';
            if (tabId.includes('B1층')) return `${building} B1층`;
            const fm = tabId.match(/(\d+)층/);
            if (fm) return `${building} ${fm[1]}층`;
            return building || tabId;
        }

        function updateSummaryPage() {
            const listEl = document.getElementById('summaryList');
            if (!listEl) return;

            // Build stable list of all 관/층 labels that exist as tabs
            const sortLabel = (a, b) => {
                const parse = (label) => {
                    const m1 = label.match(/^(\d+)관/);
                    const building = m1 ? parseInt(m1[1], 10) : 99;
                    let floor = 99;
                    if (label.includes('B1층')) floor = -1;
                    else {
                        const m2 = label.match(/(\d+)층/);
                        if (m2) floor = parseInt(m2[1], 10);
                    }
                    return { building, floor, label };
                };
                const pa = parse(a);
                const pb = parse(b);
                if (pa.building !== pb.building) return pa.building - pb.building;
                if (pa.floor !== pb.floor) return pa.floor - pb.floor;
                return pa.label.localeCompare(pb.label, 'ko');
            };

            const allLabels = Array.from(new Set(
                Array.from(document.querySelectorAll('.tab-content'))
                    .map(el => el.id)
                    .filter(id => id !== 'MAIN' && id !== 'SUMMARY')
                    .map(id => roomGroupLabelFromTabId(id))
            )).sort(sortLabel);

            // Map label -> base key to sum distributionMap
            const labelToBaseKey = new Map();
            for (const id of Array.from(document.querySelectorAll('.tab-content')).map(el => el.id)) {
                if (id === 'MAIN' || id === 'SUMMARY') continue;
                const label = roomGroupLabelFromTabId(id);
                if (!labelToBaseKey.has(label)) {
                    labelToBaseKey.set(label, baseRoomKey(id));
                }
            }

            listEl.innerHTML = '';
            for (const label of allLabels) {
                const baseKey = labelToBaseKey.get(label);
                const count = (baseKey && distributionMap[baseKey]) ? distributionMap[baseKey].size : 0;
                const li = document.createElement('li');
                li.className = 'summary-item';
                li.innerHTML = `<span class="summary-name">${escapeHtml(label)}</span><span class="summary-count">${String(count).padStart(2,'0')}부</span>`;
                listEl.appendChild(li);
            }
        }

        async function handleFileUpload(event) {
            const file = event.target.files[0];
            if (!file) return;

            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data, { type: 'array' });

            let sheetName = workbook.SheetNames.find(n => n.includes("반별 컨텐츠 구매 명단"));
            if (!sheetName) sheetName = workbook.SheetNames[0];

            const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });

            const itemSet = new Set();
            for (const row of jsonData) {
                const v = String(row['항목명'] || '').trim();
                if (v) itemSet.add(v);
            }
            if (itemSet.size === 1) itemNameDisplay = Array.from(itemSet)[0];
            else if (itemSet.size > 1) itemNameDisplay = `${itemSet.size}개 항목`;
            else itemNameDisplay = "(항목명 없음)";

            distributionMap = {};
            let count = 0;
            for (const row of jsonData) {
                const room = row['독서실명'];
                const seat = row['자리'];
                const key = baseRoomKey(room);
                const seatStr = String(seat).trim();
                if (!key || !seatStr) continue;

                if (!distributionMap[key]) distributionMap[key] = new Set();
                distributionMap[key].add(seatStr);
                count++;
            }

            document.getElementById('status-message').textContent = `✅ ${count}건 로드 완료`;
            document.getElementById('status-message').style.color = '#27ae60';
            document.getElementById('resetBtn').style.display = 'inline-flex';
            document.getElementById('downloadBtn').style.display = 'inline-flex';

            applyHighlightsGlobal();
            updateSummaryPage();
            const activeTabId = document.querySelector('.tab-content.active')?.id || 'MAIN';
            setHeader(activeTabId);
        }

        function resetData() {
            distributionMap = {};
            itemNameDisplay = "(업로드 전)";
            document.getElementById('fileInput').value = '';
            applyHighlightsGlobal();
            updateSummaryPage();
            document.getElementById('status-message').textContent = "데이터가 초기화되었습니다.";
            document.getElementById('status-message').style.color = '#7f8c8d';
            document.getElementById('resetBtn').style.display = 'none';
            document.getElementById('downloadBtn').style.display = 'none';
            const activeTabId = document.querySelector('.tab-content.active')?.id || 'MAIN';
            setHeader(activeTabId);
        }

        function applyHighlightsGlobal() {
            document.querySelectorAll('.seat.target').forEach(el => {
                el.classList.remove('target');
                el.removeAttribute('title');
            });

            if (Object.keys(distributionMap).length === 0) return;

            document.querySelectorAll('.seat[data-seat]').forEach(el => {
                const seatNum = el.getAttribute('data-seat');
                const tabDiv = el.closest('.tab-content');
                if (!tabDiv) return;

                const roomKey = baseRoomKey(tabDiv.id);
                if (distributionMap[roomKey] && distributionMap[roomKey].has(seatNum)) {
                    el.classList.add('target');
                    el.title = '배부 대상';
                }
            });
        }

        async function downloadAllScreenshots() {
            const overlay = document.getElementById('loading-overlay');
            const progressText = document.getElementById('loading-text');
            overlay.style.display = 'flex';

            try {
                const tabs = document.querySelectorAll('.tab-content');
                const originalActive = document.querySelector('.tab-content.active');

                const downloadImage = (blob, name) => {
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = name;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                };

                for (const tab of tabs) {
                    if (tab.id === 'MAIN') continue;

                    progressText.innerText = `이미지 저장 중... (${tab.id})`;

                    tab.classList.add('active');
                    tab.style.display = 'block';
                    tab.style.animation = 'none';

                    const isSummary = (tab.id === 'SUMMARY');
                    const roomText = isSummary ? '총배부 수량' : tab.id;
                    const itemText = itemNameDisplay;

                    const titleNode = document.createElement('div');
                    titleNode.style.textAlign = 'center';
                    titleNode.style.marginBottom = '15px';
                    titleNode.style.fontFamily = "'Pretendard', sans-serif";

                    const line1 = document.createElement('div');
                    line1.innerText = roomText;
                    line1.style.color = '#2c3e50';
                    line1.style.fontSize = '22px';
                    line1.style.fontWeight = '900';
                    line1.style.lineHeight = '1.1';

                    const line2 = document.createElement('div');
                    line2.innerText = itemText;
                    line2.style.color = '#2c3e50';
                    line2.style.fontSize = '16px';
                    line2.style.fontWeight = '600';
                    line2.style.marginTop = '6px';

                    titleNode.appendChild(line1);
                    titleNode.appendChild(line2);

                    tab.insertBefore(titleNode, tab.firstChild);

                    const originalPadding = tab.style.padding;
                    tab.style.padding = '30px';
                    tab.style.backgroundColor = '#ffffff';
                    tab.style.width = 'fit-content';
                    tab.style.margin = '0 auto';

                    const canvas = await html2canvas(tab, {
                        scale: 2,
                        backgroundColor: '#ffffff',
                        logging: false
                    });

                    const safeRoom = String(roomText || '').replace(/[\\/:*?\"<>|]/g, '_');
                    const safeItem = String(itemText || '').replace(/[\\/:*?\"<>|]/g, '_');
                    const filename = `${safeRoom}_${safeItem}.jpg`;

                    canvas.toBlob((blob) => {
                        downloadImage(blob, filename);
                    }, 'image/jpeg', 0.9);

                    tab.removeChild(titleNode);
                    tab.style.padding = originalPadding;
                    tab.style.backgroundColor = '';
                    tab.style.width = '';
                    tab.style.margin = '';

                    tab.style.animation = '';
                    tab.style.display = '';
                    tab.classList.remove('active');

                    await new Promise(r => setTimeout(r, 400));
                }

                if (originalActive) originalActive.classList.add('active');
            } catch (err) {
                alert("오류 발생: " + err.message);
                console.error(err);
            } finally {
                overlay.style.display = 'none';
            }
        }

        window.addEventListener('DOMContentLoaded', () => {
            document.getElementById('resetBtn').style.display = 'none';
            document.getElementById('downloadBtn').style.display = 'none';
            updateSummaryPage();
            setHeader('MAIN');
        });

// ==========================================
// 설정
// ==========================================
const READ_SHEET_ID = '1T1FWnYIu-a3fJituoUeFwL0r5YR2cYQAnSUSLxsdZto';
const READ_SHEET_NAME = '마스터';
const READ_SHEET_GID = '0';

const LOG_SHEET_NAME = '퀀텀관 지도 일지'; // ← 실제 시트 이름으로 수정
const LOG_SHEET_GID = '0';

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzCfzBoSCraE8ctS3PNVNnFgkSpdOEkOBCgW-95b_rjvxWEzuMaZPWpHwHEpxhGzPGI/exec';

// ==========================================
// 전역
// ==========================================
let currentUser = '';
let occupiedSeats = {};
let currentSeatInfo = {};

const requestQueue = [];
let isProcessing = false;

let alertRows = [];

// ==========================================
// 유틸
// ==========================================
function normalizeLocationKey(v) { return String(v || '').replace(/\s+/g, ''); }

// ==========================================
// 모바일 드롭다운
// ==========================================
function initMobileDropdown() {
  const select = document.getElementById('mobile-location-select');
  if (!select) return;

  const existing = new Set(Array.from(select.options).map(o => o.value));
  document.querySelectorAll('.tab-button').forEach(btn => {
    const text = (btn.innerText || '').trim();
    const on = btn.getAttribute('onclick') || '';
    const match = on.match(/'([^']+)'/);
    if (!match) return;
    const tabId = match[1];
    if (existing.has(tabId)) return;
    const opt = document.createElement('option');
    opt.value = tabId;
    opt.text = text;
    select.appendChild(opt);
    existing.add(tabId);
  });
}

function handleMobileSelect(tabId) {
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.style.display = 'none';
    tab.classList.remove('active');
  });
  const selected = document.getElementById(tabId);
  if (selected) {
    selected.style.display = 'block';
    selected.classList.add('active');
    selected.scrollLeft = 0;
    window.scrollTo(0,0);
    renderAlertsForActiveTab();
  }
}

// ==========================================
// 사용자명 입력
// ==========================================
function promptForUser() {
  initMobileDropdown();

  const userBar = document.getElementById('user-display-bar');
  const tabs = document.querySelector('.tabs');
  if (tabs && window.getComputedStyle(tabs).display !== 'none') {
    tabs.parentNode.insertBefore(userBar, tabs.nextSibling);
  }

  // (삭제됨: 초기 강제 입력 로직 제거)

  ensureAlertsPanel();

  loadSheetData();
  loadAlertData();
  setInterval(() => { loadSheetData(); loadAlertData(); }, 30000);
}

// ==========================================
// 이탈 방지 + 큐
// ==========================================
window.addEventListener('beforeunload', (event) => {
  if (requestQueue.length > 0 || isProcessing) {
    event.preventDefault();
    event.returnValue = '';
  }
});

function addToQueue(payload) {
  requestQueue.push(payload);
  processQueue();
}

async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;
  isProcessing = true;

  const payload = requestQueue[0];
  updateStatus(`📤 전송 중... (${requestQueue.length}건) ⚠️ 닫지 마세요!`, 'red');

  try {
    // Modified to read response
    const response = await fetch(SCRIPT_URL, {
      method: 'POST',
      // mode: 'no-cors', // Removed to allow reading response
      // Use text/plain to avoid CORS preflight (OPTIONS)
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, 
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (result.status === 'success') {
        // Show alert if message exists
        if (result.message && result.message.trim() !== "") {
            // Alert Popup Removed

            // Add to session log
            const now = new Date();
            const timeStr = now.getHours().toString().padStart(2,'0') + ":" + now.getMinutes().toString().padStart(2,'0');

            localSessionLogs.push({
                time: timeStr,
                location: payload.location,
                seat: payload.seat,
                classNum: payload.classNum,
                studentId: payload.studentId,
                name: payload.name,
                alertText: result.message
            });

            renderAlertsForActiveTab();
        }
        requestQueue.shift();
    } else {
        throw new Error(result.message || "Server Error");
    }

    if (requestQueue.length > 0) {
      processQueue();
    } else {
      updateStatus('✅ 저장 완료', 'green');
      loadSheetData();
      loadAlertData();
      setTimeout(() => updateStatus('✅ 준비 완료', 'green'), 2500);
    }

  } catch (e) {
    console.error(e);
    updateStatus('❌ 실패 - 재시도 중...', 'red');
    setTimeout(() => { isProcessing = false; processQueue(); }, 3000);
    return;
  }

  isProcessing = false;
  if (requestQueue.length > 0) processQueue();
}

// ==========================================
// 마스터 시트
// ==========================================
function handleSheetData(response) {
  if (response.status === 'error') {
    updateStatus('❌ 에러: ' + response.errors[0].message, 'red');
    return;
  }

  try {
    const rows = response.table.rows || [];
    occupiedSeats = {};

    for (const r of rows) {
      const c = r.c;
      if (!c) continue;

      const classNum = c[0]?.v || '';
      const studentId = c[1]?.v || '';
      const name = c[2]?.v || '';
      const location = c[4]?.v;
      let seatNum = c[5]?.v;

      if (location && seatNum) {
        const key = normalizeLocationKey(location);
        seatNum = String(seatNum).trim();
        if (!occupiedSeats[key]) occupiedSeats[key] = {};
        occupiedSeats[key][seatNum] = { classNum, studentId, name, locationName: location };
      }
    }

    updateSeatColors();
    updateStatus('✅ 준비 완료', 'green');
  } catch (e) {
    console.error(e);
    updateStatus('❌ 파싱 에러', 'red');
  }
}

function loadSheetData() {
  if (requestQueue.length > 0) return;

  const old = document.getElementById('gviz_master_script');
  if (old) old.remove();

  const script = document.createElement('script');
  script.id = 'gviz_master_script';
  script.src = `https://docs.google.com/spreadsheets/d/${READ_SHEET_ID}/gviz/tq?tqx=responseHandler:handleSheetData&sheet=${encodeURIComponent(READ_SHEET_NAME)}&gid=${READ_SHEET_GID}`;
  document.body.appendChild(script);
}

function updateSeatColors() {
  document.querySelectorAll('.seat').forEach(s => {
    s.classList.remove('occupied');
    s.style.cursor = 'default';
    s.onclick = null;
  });

  document.querySelectorAll('.tab-content').forEach(tab => {
    const tabKey = normalizeLocationKey(tab.id);

    for (const [sheetKey, seatObj] of Object.entries(occupiedSeats)) {
      if (!tabKey.startsWith(sheetKey)) continue;

      for (const [seatNum, info] of Object.entries(seatObj)) {
        const seatEl = tab.querySelector(`.seat[data-seat="${seatNum}"]`);
        if (seatEl) {
          seatEl.classList.add('occupied');
          seatEl.style.cursor = 'pointer';
          seatEl.onclick = () => openModal(seatNum, info);
        }
      }
    }
  });

  renderAlertsForActiveTab();
}

// ==========================================
// 알림 데이터 (O열 읽기)
// ==========================================
function handleAlertData(response) {
  if (response.status === 'error') {
    console.error('alert data error', response.errors);
    alertRows = [];
    renderAlertsForActiveTab();
    return;
  }

  alertRows = [];

  try {
    const rows = response.table.rows || [];
    for (const r of rows) {
      const c = r.c;
      if (!c) continue;

      const location = c[2]?.v || '';
      const seat = c[3]?.v || '';
      const classNum = c[4]?.v || '';
      const studentId = c[5]?.v || '';
      const name = c[6]?.v || '';
      const alertText = c[14]?.v || ''; // O열

      if (!alertText || !location || !seat) continue;

      alertRows.push({
        location,
        seat: String(seat).trim(),
        classNum,
        studentId,
        name,
        alertText
      });
    }
  } catch (e) {
    console.error(e);
    alertRows = [];
  }

  renderAlertsForActiveTab();
}

function loadAlertData() {
  const old = document.getElementById('gviz_alert_script');
  if (old) old.remove();

  const script = document.createElement('script');
  script.id = 'gviz_alert_script';
  script.src = `https://docs.google.com/spreadsheets/d/${READ_SHEET_ID}/gviz/tq?tqx=responseHandler:handleAlertData&sheet=${encodeURIComponent(LOG_SHEET_NAME)}&gid=${LOG_SHEET_GID}`;
  document.body.appendChild(script);
}

// ==========================================
// 누적 패널
// ==========================================
function ensureAlertsPanel() {
  let panel = document.getElementById('alerts-panel');
  if (panel) return panel;

  panel = document.createElement('div');
  panel.id = 'alerts-panel';
  panel.innerHTML = `
    <div class="alerts-header">
      <div class="alerts-title">📌 실시간 지도 알림 로그</div>
    </div>
    <div id="alerts-container" style="flex:1; overflow-y:auto; background:#fff; border:1px solid #ccc; padding:0;">
        <div style="color:#999; text-align:center; padding:20px; font-size:13px;">아직 기록된 알림이 없습니다.</div>
    </div>
  `;

  return panel;
}

function getActiveTabElement() {
  let active = document.querySelector('.tab-content.active');
  if (active) return active;
  const tabs = Array.from(document.querySelectorAll('.tab-content'));
  return tabs.find(t => window.getComputedStyle(t).display !== 'none');
}

function mountAlertsPanelToActiveTab() {
  const panel = ensureAlertsPanel();
  const activeTab = getActiveTabElement();
  if (!activeTab) return;
  if (panel.parentElement !== activeTab) activeTab.appendChild(panel);
}

function buildAlertsTextForTab(tabEl) {
  if (!tabEl) return '';

  const tabKey = normalizeLocationKey(tabEl.id);

  const filtered = alertRows.filter(row => {
    const locKey = normalizeLocationKey(row.location);
    return tabKey.startsWith(locKey);
  });

  if (filtered.length === 0) return '';

  filtered.sort((a, b) => {
    const na = Number(a.seat), nb = Number(b.seat);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return String(a.seat).localeCompare(String(b.seat));
  });

  const lines = filtered.map(row => {
    return `${row.location} ${row.seat} ${row.classNum || ''} ${row.studentId || ''} ${row.name || ''} ${row.alertText}`.replace(/\s+/g,' ').trim();
  });

  return lines.join('\n');
}

function renderAlertsForActiveTab() {
  mountAlertsPanelToActiveTab();
  const container = document.getElementById('alerts-container');
  if (!container) return;

  if (!localSessionLogs || localSessionLogs.length === 0) {
      container.innerHTML = '<div style="color:#999; text-align:center; padding:20px; font-size:13px;">아직 기록된 알림이 없습니다.</div>';
      return;
  }

  container.innerHTML = '';

  localSessionLogs.forEach(log => {
      const lineText = `[${log.time}] ${log.location} ${log.seat}번 ${log.classNum ? log.classNum + '반 ' : ''}${log.studentId ? log.studentId + ' ' : ''}${log.name} : ${log.alertText}`;

      const itemDiv = document.createElement('div');
      itemDiv.className = 'log-item';

      const textSpan = document.createElement('span');
      textSpan.className = 'log-text';
      textSpan.textContent = lineText;

      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = '복사';
      btn.onclick = () => {
          navigator.clipboard.writeText(lineText).then(() => {
              btn.textContent = '✓';
              btn.style.color = 'green';
              btn.style.borderColor = 'green';
              setTimeout(() => {
                  btn.textContent = '복사';
                  btn.style.color = '#555';
                  btn.style.borderColor = '#ddd';
              }, 1500);
          }).catch(() => {
              alert('복사 실패');
          });
      };

      itemDiv.appendChild(textSpan);
      itemDiv.appendChild(btn);
      container.appendChild(itemDiv);
  });

  container.scrollTop = container.scrollHeight;
}

async function copyAlertsText() {
  const ta = document.getElementById('alerts-text');
  if (!ta) return;
  const text = (ta.value || '').trim();
  if (!text) { alert('복사할 내용이 없습니다.'); return; }

  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    ta.focus();
    ta.select();
    document.execCommand('copy');
  }

  updateStatus('✅ 복사 완료', 'green');
  setTimeout(() => updateStatus('✅ 준비 완료', 'green'), 1500);
}

// ==========================================
// 모달
// ==========================================
function openModal(seatNum, info) {
  currentSeatInfo = info;
  currentSeatInfo.seatNum = seatNum;

  document.getElementById('form_class').value = info.classNum || '';
  document.getElementById('form_id').value = info.studentId || '';
  document.getElementById('form_name').value = info.name || '';
  document.getElementById('form_location').value = info.locationName || '';
  document.getElementById('form_seat').value = seatNum || '';

  document.getElementById('form_note').value = '';
  const radios = document.getElementsByName('guidance_type');
  for (const r of radios) r.checked = false;

  document.getElementById('guidanceModal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('guidanceModal').style.display = 'none';
}

function submitForm() {
  if (SCRIPT_URL === 'YOUR_APPS_SCRIPT_URL_HERE') {
    alert('⚠️ SCRIPT_URL을 설정해주세요!');
    return;
  }

  const note = document.getElementById('form_note').value;
  let type = '';
  const radios = document.getElementsByName('guidance_type');
  for (const r of radios) if (r.checked) type = r.value;
  if (!type) { alert('지도 항목을 선택해주세요.'); return; }

  // [Corrected] Read values BEFORE closing modal
  const payload = {
    location: document.getElementById('form_location').value,
    seat: document.getElementById('form_seat').value,
    classNum: document.getElementById('form_class').value,
    studentId: document.getElementById('form_id').value,
    name: document.getElementById('form_name').value,
    type: type,
    note: note,
    user: currentUser
  };

  addToQueue(payload);
  closeModal();
}

// ==========================================
// 상태바
// ==========================================
function updateStatus(msg, color) {
  const el = document.getElementById('status_msg');
  if (!el) return;
  el.innerText = msg;
  el.style.color = color;
}

function hookOpenTab() {
  if (typeof window.openTab !== 'function') return;
  if (window.__openTabHooked) return;

  const original = window.openTab;
  window.openTab = function(evt, tabName) {
    const r = original.apply(this, arguments);
    setTimeout(() => { renderAlertsForActiveTab(); }, 0);
    return r;
  };
  window.__openTabHooked = true;
}

window.addEventListener('load', () => {
  hookOpenTab();

  const bar = document.createElement('div');
  bar.id = 'status_msg_container';
  bar.style.cssText = 'position:fixed; bottom:10px; right:10px; background:white; padding:10px; border:2px solid #333; z-index:9000; border-radius:8px; font-weight:900; font-size:12px; box-shadow:0 2px 10px rgba(0,0,0,0.2);';
  bar.innerHTML = '<span id="status_msg">준비</span> <button onclick="loadSheetData(); loadAlertData();" style="margin-left:10px; padding:5px; font-weight:900;">↻</button>';
  document.body.appendChild(bar);

  setTimeout(promptForUser, 100);
});

function enterRoom() {
    const select = document.getElementById('room-select');
    const selectedRoom = select.value;

    if (!selectedRoom) {
        alert('관을 선택해주세요!');
        return;
    }

    document.getElementById('main-landing').style.display = 'none';
    document.querySelector('.container').style.display = 'block';

    if (typeof openTab === 'function') {
        openTab(null, selectedRoom);
    }

    const mobileSelect = document.getElementById('mobile-location-select');
    if (mobileSelect) {
        mobileSelect.value = selectedRoom;
    }
}

// ==========================================
// [수정] 관 선택 시 진입 (이름 체크 + 탭/드롭다운 필터링)
// ==========================================
function enterBuilding(buildingName) {
    // 1. 감독관 이름 확인
    if (!currentUser) {
        const storedName = sessionStorage.getItem('supervisorName');
        if (storedName) {
            currentUser = storedName;
        } else {
            let nameInput = '';
            while (!nameInput) {
                nameInput = prompt('감독관 이름을 입력해주세요 (필수):', '');
                if (nameInput === null) return;
                nameInput = nameInput.trim();
                if (!nameInput) alert('이름을 입력해야 관리 화면으로 이동할 수 있습니다.');
            }
            currentUser = nameInput;
            sessionStorage.setItem('supervisorName', currentUser);
        }
    }

    // 2. 사용자 이름 표시
    const userBar = document.getElementById('user-display-bar');
    if (userBar) {
        userBar.innerText = `현재 사용자 : ${currentUser}`;
        userBar.style.display = 'block';
    }

    // 3. 화면 전환
    const landing = document.getElementById('main-landing');
    if (landing) landing.style.display = 'none';

    const container = document.querySelector('.container');
    if (container) container.style.display = 'block';

    // ============================================================
    // [핵심 변경] 4. 탭 버튼 & 모바일 드롭다운 동시 필터링
    // ============================================================
    const tabButtons = document.querySelectorAll('.tab-button');
    const mobileSelect = document.getElementById('mobile-location-select');

    // 드롭다운 초기화 (기본 옵션만 남기기)
    if (mobileSelect) {
        mobileSelect.innerHTML = '<option value="" disabled selected>🔽 층 선택 (터치)</option>';
    }

    let firstVisibleTab = null;

    tabButtons.forEach(btn => {
        // 홈 버튼은 항상 표시
        if (btn.classList.contains('home-tab')) {
            btn.style.display = 'inline-flex';
            return;
        }

        const onClickText = btn.getAttribute('onclick') || '';
        const match = onClickText.match(/'([^']+)'/);

        if (match) {
            const tabId = match[1];
            const btnText = btn.innerText.trim();

            // 선택한 관(buildingName)과 일치하는지 확인
            if (tabId.startsWith(buildingName)) {
                // 1) PC 탭 표시
                btn.style.display = 'inline-block';

                // 2) 모바일 드롭다운에 옵션 추가
                if (mobileSelect) {
                    const opt = document.createElement('option');
                    opt.value = tabId;
                    opt.text = btnText;
                    mobileSelect.appendChild(opt);
                }

                if (!firstVisibleTab) firstVisibleTab = tabId;
            } else {
                // 일치하지 않으면 숨김
                btn.style.display = 'none';
            }
        }
    });

    // 5. 첫 번째 층 자동 선택
    if (firstVisibleTab) {
        openTab(null, firstVisibleTab);
        // 드롭다운 값도 동기화
        if (mobileSelect) mobileSelect.value = firstVisibleTab;
    } else {
        alert('해당 관에 등록된 층이 없습니다.');
    }
}


// ==========================================
// [추가] 홈 버튼 기능: 초기 화면으로 복귀
// ==========================================
function goToHome() {
    if (!confirm('초기 화면으로 돌아가시겠습니까?')) return;

    const container = document.querySelector('.container');
    if (container) container.style.display = 'none';

    const landing = document.getElementById('main-landing');
    if (landing) landing.style.display = 'flex'; // CSS에 맞게 flex 또는 block
}
