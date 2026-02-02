/* =========================================
   [1] 구글 시트 ID 및 설정
   ========================================= */
const READSHEETID = '1T1FWnYIu-a3fJituoUeFwL0r5YR2cYQAnSUSLxsdZto';
const CLASSSHEETID = '1jtye6oY0gHPDn7xJla75uG_fhdy_yktx9v4SObCFHRg';
const CLASSSHEETNAME = '학생별수업';

const LOGSHEETNAME = '퀀텀관 지도 일지';
const LOGSHEETGID = '0';

const SCRIPTURL = 'https://script.google.com/macros/s/AKfycbzCfzBoSCraE8ctS3PNVNnFgkSpdOEkOBCgW-95b_rjvxWEzuMaZPWpHwHEpxhGzPGI/exec';


/* =========================================
   [2] 전역 변수
   ========================================= */
let currentUser = "";
let occupiedSeats = {};
let distributionMap = {};
let localSessionLogs = [];
let currentSeatInfo = null;
const requestQueue = [];
let isProcessing = false;
let alertRows = [];


/* =========================================
   [3] 유틸리티 함수
   ========================================= */
function normalizeLocationKey(v) {
    return String(v).replace(/\s+/g, "").trim();
}

function roomGroupLabelFromTabId(tabId) {
    if (!tabId) return "";
    if (tabId.startsWith('3')) {
        const m = tabId.match(/^(3B1)/);
        if (m) return m[1];
        return "3";
    }
    const bm = tabId.match(/^(\d+)B1/);
    if (bm) return bm[1] + "B1";
    const fm = tabId.match(/^(\d+)F/);
    if (fm) return fm[1] + "F";
    return tabId;
}

function getCurrentPeriod(dateObj) {
    if (!dateObj) dateObj = new Date();
    const day = dateObj.getDay();
    if (day === 0 || day === 6) return "주말";

    const currentMinutes = (dateObj.getHours() * 60) + dateObj.getMinutes();

    const t0750 = 7 * 60 + 50; const t0900 = 9 * 60; const t0950 = 9 * 60 + 50;
    const t1100 = 11 * 60; const t1150 = 11 * 60 + 50; const t1300 = 13 * 60;
    const t1400 = 14 * 60; const t1450 = 14 * 60 + 50; const t1600 = 16 * 60;
    const t1650 = 16 * 60 + 50; const t1800 = 18 * 60; const t1900 = 19 * 60;
    const t2000 = 20 * 60; const t2200 = 22 * 60; const t2300 = 23 * 60;

    if (currentMinutes >= t0750 && currentMinutes < t0900) return "1";
    if (currentMinutes >= t0900 && currentMinutes < t0950) return "2";
    if (currentMinutes >= t0950 && currentMinutes < t1100) return "3";
    if (currentMinutes >= t1100 && currentMinutes < t1150) return "4";
    if (currentMinutes >= t1300 && currentMinutes < t1400) return "5";
    if (currentMinutes >= t1400 && currentMinutes < t1450) return "6";
    if (currentMinutes >= t1450 && currentMinutes < t1600) return "7";
    if (currentMinutes >= t1600 && currentMinutes < t1650) return "8";
    if (currentMinutes >= t1650 && currentMinutes < t1800) return "9";

    if (currentMinutes >= t1900 && currentMinutes < t2000) return "야1";
    if (currentMinutes >= t2000 && currentMinutes < t2200) return "야2";
    if (currentMinutes >= t2200 && currentMinutes < t2300) return "야3";

    return "쉬는시간";
}

function getColumnIndexForCurrentTime() {
    const now = new Date();
    const day = now.getDay();
    if (day < 1 || day > 5) return -1;
    const periodLabel = getCurrentPeriod(now);
    if (periodLabel === "쉬는시간" || periodLabel === "주말") return -1;

    const periodMap = {
        "1": 0, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5,
        "7": 6, "8": 7, "9": 8, "야1": 9, "야2": 10, "야3": 11
    };
    const pIdx = periodMap[periodLabel];
    if (pIdx === undefined) return -1;
    return 4 + ((day - 1) * 12) + pIdx;
}


/* =========================================
   [4] 탭 및 UI
   ========================================= */
function openTab(evt, tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-button').forEach(el => el.classList.remove('active'));

    const tabContent = document.getElementById(tabName);
    if (tabContent) tabContent.classList.add('active');

    if (evt && evt.currentTarget) evt.currentTarget.classList.add('active');

    const pageTitleEl = document.getElementById('pageTitle');
    if (pageTitleEl) {
        pageTitleEl.innerHTML = `<div class="title-room">${tabName}</div>`;
    }

    mountAlertsPanelToActiveTab();
    renderAlertsForActiveTab();

    const mobileSelect = document.getElementById('mobile-location-select');
    if (mobileSelect && mobileSelect.value !== tabName) {
        for (let i = 0; i < mobileSelect.options.length; i++) {
            if (mobileSelect.options[i].value === tabName) {
                mobileSelect.value = tabName;
                break;
            }
        }
    }
}

function handleMobileSelect(arg) {
    const val = arg.value !== undefined ? arg.value : arg;
    if (val === "HOME") { goToHome(); return; }
    if (val) openTab(null, val);
}


/* =========================================
   [5] 데이터 로딩
   ========================================= */
function loadSheetData() {
    if (requestQueue.length > 0) return;

    const oldMaster = document.getElementById('gviz_master_script');
    if (oldMaster) oldMaster.remove();
    const oldClass = document.getElementById('gviz_class_script');
    if (oldClass) oldClass.remove();
    const oldAlert = document.getElementById('gviz_alert_script');
    if (oldAlert) oldAlert.remove();

    updateStatus('좌석 데이터 요청 중...', 'black');

    const script = document.createElement('script');
    script.id = 'gviz_master_script';
    script.src = `https://docs.google.com/spreadsheets/d/${READSHEETID}/gviz/tq?tq=select%20*&tqx=responseHandler:handleMasterData`;
    document.body.appendChild(script);
}

function handleMasterData(response) {
    if (response.status === 'error') {
        updateStatus('마스터 데이터 에러', 'red');
        return;
    }
    try {
        const rows = response.table.rows;
        occupiedSeats = {};
        distributionMap = {};

        for (const r of rows) {
            const c = r.c;
            if (!c) continue;
            const classNum = c[0]?.v;
            const studentId = c[1]?.v;
            const name = c[2]?.v;
            const location = c[4]?.v;
            const seatNum = c[5]?.v;

            if (location && seatNum && studentId) {
                const key = normalizeLocationKey(location);
                const seatKey = String(seatNum).trim();
                const stdIdStr = String(studentId).trim();

                if (!occupiedSeats[key]) occupiedSeats[key] = {};
                occupiedSeats[key][seatKey] = {
                    classNum: classNum, studentId: stdIdStr, name: name, locationName: location, status: '정상'
                };

                if (!distributionMap[key]) distributionMap[key] = new Set();
                distributionMap[key].add(seatKey);
            }
        }
        updateStatus('출결 시트 로딩 중...', 'blue');
        loadClassData();
    } catch (e) {
        console.error(e);
        updateStatus('마스터 파싱 오류', 'red');
    }
}

function loadClassData() {
    const script = document.createElement('script');
    script.id = 'gviz_class_script';
    script.src = `https://docs.google.com/spreadsheets/d/${CLASSSHEETID}/gviz/tq?tq=select%20*&tqx=responseHandler:handleClassData&sheet=${encodeURIComponent(CLASSSHEETNAME)}`;
    document.body.appendChild(script);
}

/* =========================================
   [수정] 수업 데이터(출결) 로딩 및 상태 반영 로직 복구
   ========================================= */
function handleClassData(response) {
    if (response.status !== 'error') {
        try {
            const rows = response.table.rows;
            // 1. 현재 교시에 해당하는 열 인덱스 가져오기
            const targetColIndex = getColumnIndexForCurrentTime();

            // 디버깅용: 현재 상태 확인 (필요시 콘솔 확인)
            // console.log("Target Column Index:", targetColIndex);

            if (targetColIndex !== -1) {
                // 2. 수업 시트의 모든 행을 순회하며 상태 매칭
                for (const r of rows) {
                    const c = r.c;
                    if (!c) continue;

                    // C열(인덱스 2)에 있는 학번을 가져옴 (핵심 매칭 키)
                    const classSheetStudentId = c[2]?.v;
                    if (!classSheetStudentId) continue;

                    // 학번 정규화 (문자열 변환 및 공백 제거)
                    const targetStudentId = String(classSheetStudentId).trim();

                    // 현재 교시(targetColIndex)의 셀 값 가져오기 (예: "수업", "조퇴")
                    const cell = c[targetColIndex];
                    const statusValue = cell ? String(cell.v).trim() : "";

                    // 상태 값이 없으면 건너뜀
                    if (!statusValue) continue;

                    // 3. occupiedSeats 전체를 뒤져서 해당 학번 학생 찾기
                    // (비효율적일 수 있으나 원본 로직 유지)
                    for (const roomKey in occupiedSeats) {
                        for (const seatKey in occupiedSeats[roomKey]) {
                            const seatInfo = occupiedSeats[roomKey][seatKey];

                            // [핵심] 학번이 일치하면 status 업데이트
                            if (String(seatInfo.studentId).trim() === targetStudentId) {
                                seatInfo.status = statusValue; // "정상" -> "수업" 등으로 변경됨
                            }
                        }
                    }
                }
                updateStatus("출결 데이터 반영 완료", "green");
            } else {
                updateStatus("현재는 정규 수업 시간이 아닙니다 (기본 상태)", "green");
            }

            // 4. 변경된 status를 바탕으로 색상 다시 칠하기
            updateSeatColors();

        } catch (e) {
            console.error(e);
            updateStatus("출결 데이터 처리 중 오류", "red");
        }
    } else {
        updateStatus("수업 데이터 로딩 실패", "red");
        updateSeatColors(); // 실패하더라도 기본 좌석은 표시
    }

    // 다음 단계(로그 데이터) 로딩
    loadAlertData();
}


function loadAlertData() {
    const script = document.createElement('script');
    script.id = 'gviz_alert_script';
    script.src = `https://docs.google.com/spreadsheets/d/${READSHEETID}/gviz/tq?tqx=responseHandler:handleAlertData&sheet=${encodeURIComponent(LOGSHEETNAME)}&gid=${LOGSHEETGID}`;
    document.body.appendChild(script);
}

function handleAlertData(response) {
    if (response.status === 'error') return;
    try {
        const rows = response.table.rows;
        alertRows = [];
        for (const r of rows) {
            const c = r.c;
            if (!c) continue;

            const location = c[2]?.v;
            const seat = c[3]?.v;
            const classNum = c[4]?.v;
            const studentId = c[5]?.v;
            const name = c[6]?.v;
            const alertText = c[14]?.v;

            if (!alertText && !location) continue;

            alertRows.push({
                location: location || "",
                seat: String(seat || "").trim(),
                classNum: classNum || "",
                studentId: studentId || "",
                name: name || "",
                alertText: alertText || ""
            });
        }
        renderAlertsForActiveTab();
    } catch (e) {
        console.error(e);
    }
}


/* =========================================
   [6] Alerts Panel (이미지 스타일 복원)
   ========================================= */
function ensureAlertsPanel() {
    let panel = document.getElementById('alerts-panel');
    if (panel) return panel;

    // 이미지와 같은 디자인 적용
    panel = document.createElement('div');
    panel.id = 'alerts-panel';
    panel.style.cssText = "border:1px solid #ddd; border-radius:8px; padding:15px; margin-top:20px; background:#fff; box-shadow:0 2px 5px rgba(0,0,0,0.05);";

    panel.innerHTML = `
        <div style="font-weight:bold; color:#d9534f; margin-bottom:10px; display:flex; align-items:center;">
            <span style="margin-right:5px;">📌</span> 실시간 지도 알림 로그
        </div>
        <div id="alerts-container" style="max-height:200px; overflow-y:auto;"></div>
        <!-- 숨겨진 복사용 textarea (기능 유지용) -->
        <textarea id="alerts-text" style="width:1px; height:1px; opacity:0; position:absolute;"></textarea>
    `;
    return panel;
}

function getActiveTabElement() {
    const active = document.querySelector('.tab-content.active');
    if (active) return active;
    return document.querySelector('.tab-content');
}

function mountAlertsPanelToActiveTab() {
    const panel = ensureAlertsPanel();
    const activeTab = getActiveTabElement();
    if (!activeTab) return;

    if (panel.parentElement !== activeTab) {
        activeTab.appendChild(panel);
    }
}

function renderAlertsForActiveTab() {
    const container = document.getElementById('alerts-container');
    const ta = document.getElementById('alerts-text');
    if (!container) return;

    let html = "";

    // 로그 아이템 생성 함수 (스타일 적용)
    const createItem = (text) => {
        return `
        <div class="log-item" style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #eee; font-size:13px; color:#555;">
            <span style="flex:1;">${text}</span>
            <button onclick="copySingleLog(this)" style="margin-left:10px; padding:2px 8px; border:1px solid #ddd; background:#fff; border-radius:4px; cursor:pointer; font-size:11px; color:#666;">복사</button>
        </div>`;
    };

    // 1. 현재 세션 로그
    localSessionLogs.forEach(log => {
        // [09:15] 2관 2층 1번 K반 1312 이해린 : 내용
        const fullText = `[${log.time}] ${log.location} ${log.seat}번 ${log.classNum}반 ${log.studentId} ${log.name} : ${log.alertText}`;
        html += createItem(fullText);
    });

    // 2. 과거 로그 필터링
    const activeTab = getActiveTabElement();
    let filtered = [];
    if (activeTab) {
        const tabKey = normalizeLocationKey(activeTab.id);
        filtered = alertRows.filter(r => {
            const locKey = normalizeLocationKey(r.location);
            return tabKey.startsWith(locKey);
        });

        filtered.forEach(row => {
            // 과거 로그엔 시간 정보가 없을 수 있으므로 [기록]으로 대체
            const fullText = `[기록] ${row.location} ${row.seat}번 ${row.classNum}반 ${row.studentId} ${row.name} : ${row.alertText}`;
            html += createItem(fullText);
        });
    }

    container.innerHTML = html || "<div style='text-align:center; padding:20px; color:#999; font-size:12px;'>표시할 알림 로그가 없습니다.</div>";
    container.scrollTop = container.scrollHeight;

    // 전체 복사용 텍스트 업데이트 (숨김 처리됨)
    if (ta) {
        // ... (필요하다면 전체 텍스트 갱신)
    }
}

// 개별 로그 복사 기능
async function copySingleLog(btn) {
    const text = btn.parentElement.querySelector('span').innerText;
    try {
        await navigator.clipboard.writeText(text);
        const originalText = btn.innerText;
        btn.innerText = "완료";
        btn.style.color = "green";
        setTimeout(() => {
            btn.innerText = originalText;
            btn.style.color = "#666";
        }, 1000);
    } catch (e) {
        alert("복사 실패");
    }
}


/* =========================================
   [7] 좌석 색상 및 모달
   ========================================= */
function updateSeatColors() {
    document.querySelectorAll('.seat').forEach(s => {
        s.classList.remove('occupied', 'status-class', 'status-leave', 'status-out', 'status-self', 'status-absent');
        s.style.cursor = 'default';
        s.onclick = null;
        s.title = "";
    });

    document.querySelectorAll('.tab-content').forEach(tab => {
        const tabKey = normalizeLocationKey(tab.id);
        for (const [sheetKey, seatObj] of Object.entries(occupiedSeats)) {
            if (!tabKey.startsWith(sheetKey)) continue;

            for (const [seatNum, info] of Object.entries(seatObj)) {
                const seatEl = tab.querySelector(`.seat[data-seat="${seatNum}"]`);
                if (seatEl) {
                    seatEl.classList.add('occupied');

                    const st = String(info.status).replace(/\s+/g, "");
                    if (st === '수업') seatEl.classList.add('status-class');
                    else if (st === '조퇴') seatEl.classList.add('status-leave');
                    else if (st === '외출') seatEl.classList.add('status-out');
                    else if (st === '결석') seatEl.classList.add('status-absent');
                    else seatEl.classList.add('status-self');

                    seatEl.style.cursor = 'pointer';
                    seatEl.onclick = () => openModal(seatNum, info);
                    seatEl.title = `${info.name} (${info.status})`;
                }
            }
        }
    });
}


/* =========================================
   [8] 화면 진입 (관 선택)
   ========================================= */
function enterBuilding(buildingName) {
    if (!currentUser) {
        const storedName = sessionStorage.getItem('supervisorName');
        if (storedName) {
            currentUser = storedName;
        } else {
            let nameInput = prompt("감독관 이름을 입력해주세요:", "") || "";
            nameInput = nameInput.trim();
            if (!nameInput) { alert("이름 필수"); return; }
            currentUser = nameInput;
            sessionStorage.setItem('supervisorName', currentUser);
        }
    }

    const userBar = document.getElementById('user-display-bar');
    if (userBar) {
        userBar.innerText = `감독관: ${currentUser}`;
        userBar.style.display = 'block';
    }

    const landing = document.getElementById('main-landing');
    if (landing) landing.style.display = 'none';
    const container = document.querySelector('.container');
    if (container) container.style.display = 'block';

    const tabButtons = document.querySelectorAll('.tab-button');
    const mobileSelect = document.getElementById('mobile-location-select');

    if (mobileSelect) {
        mobileSelect.innerHTML = "<option value='HOME' style='color:red; font-weight:bold'>← 처음 화면</option><option disabled>──────────</option>";
    }

    let firstVisibleTab = null;
    const searchKey = buildingName.replace('관', '').trim();

    tabButtons.forEach(btn => {
        if (btn.classList.contains('home-tab')) {
            btn.style.display = 'inline-flex';
            return;
        }
        const onClickText = btn.getAttribute('onclick');
        const match = onClickText ? onClickText.match(/openTab\s*\(\s*[^,]+,\s*['"]([^'"]+)['"]\s*\)/) : null;

        if (match) {
            const tabId = match[1];
            const btnText = btn.innerText.trim();

            if (tabId.startsWith(searchKey)) {
                btn.style.display = 'inline-block';
                if (mobileSelect) {
                    const opt = document.createElement('option');
                    opt.value = tabId;
                    opt.text = btnText;
                    mobileSelect.appendChild(opt);
                }
                if (!firstVisibleTab) firstVisibleTab = tabId;
            } else {
                btn.style.display = 'none';
            }
        }
    });

    if (firstVisibleTab) {
        openTab(null, firstVisibleTab);
        if (mobileSelect) mobileSelect.value = firstVisibleTab;
    } else {
        alert("해당하는 탭을 찾을 수 없습니다.");
    }

    loadSheetData();
    if (window.refreshInterval) clearInterval(window.refreshInterval);
    window.refreshInterval = setInterval(loadSheetData, 30000);
}

function goToHome() {
    if (!confirm("처음 화면으로 돌아가시겠습니까?")) return;
    document.querySelector('.container').style.display = 'none';
    document.getElementById('main-landing').style.display = 'flex';
}

function updateStatus(msg, color) {
    const el = document.getElementById('status_msg');
    if (!el) return;
    el.innerText = msg;
    el.style.color = color || 'black';
}


/* =========================================
   [9] 모달 및 전송
   ========================================= */
function openModal(seatNum, info) {
    currentSeatInfo = info;
    currentSeatInfo.seatNum = seatNum;
    document.getElementById('form_class').value = info.classNum || "";
    document.getElementById('form_id').value = info.studentId || "";
    document.getElementById('form_name').value = info.name || "";
    document.getElementById('form_location').value = info.locationName || "";
    document.getElementById('form_seat').value = seatNum;
    document.getElementById('form_note').value = "";
    document.getElementsByName('guidance_type').forEach(r => r.checked = false);
    document.getElementById('guidanceModal').style.display = 'flex';
}
function closeModal() { document.getElementById('guidanceModal').style.display = 'none'; }
function submitForm() {
    const note = document.getElementById('form_note').value;
    let type = "";
    document.getElementsByName('guidance_type').forEach(r => { if (r.checked) type = r.value; });
    if (!type) { alert("유형 선택 필요"); return; }

    const payload = {
        location: document.getElementById('form_location').value,
        seat: document.getElementById('form_seat').value,
        classNum: document.getElementById('form_class').value,
        studentId: document.getElementById('form_id').value,
        name: document.getElementById('form_name').value,
        type: type, note: note, user: currentUser
    };
    addToQueue(payload);
    closeModal();
}
function addToQueue(p) { requestQueue.push(p); processQueue(); }

async function processQueue() {
    if (isProcessing || requestQueue.length === 0) return;
    isProcessing = true;

    const payload = requestQueue[0];

    // 상태 메시지 표시
    if (typeof updateStatus === 'function') {
        updateStatus("전송 중...", "blue");
    }

    try {
        // [중요] 변수명 자동 감지 (SCRIPT_URL 또는 SCRIPTURL 사용)
        const targetUrl = (typeof SCRIPT_URL !== 'undefined') ? SCRIPT_URL : SCRIPTURL;

        const response = await fetch(targetUrl, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        // ====================================================
        // [수정된 부분] 수면 로그 필터링 로직 (3회 미만 숨김)
        // ====================================================
        let alertMsg = result.message || "";

        // "수면" 또는 "수면주의"가 1회, 2회인 경우 문구에서 삭제
        alertMsg = alertMsg.replace(/(수면(?:주의)?\s*[12]회(?:,\s*)?|,\s*수면(?:주의)?\s*[12]회)/g, '').trim();
        // 앞뒤 콤마 정리
        alertMsg = alertMsg.replace(/^,\s*|\s*,$/g, '');

        // 메시지가 있을 때만 로그에 추가
        if (alertMsg && alertMsg !== "") {
            const now = new Date();
            const timeStr = now.getHours().toString().padStart(2, '0') + ":" + now.getMinutes().toString().padStart(2, '0');

            localSessionLogs.push({
                time: timeStr,
                location: payload.location,
                seat: payload.seat,
                classNum: payload.classNum,
                studentId: payload.studentId,
                name: payload.name,
                alertText: alertMsg // 필터링된 메시지 사용
            });

            if (typeof renderAlertsForActiveTab === 'function') {
                renderAlertsForActiveTab();
            }
        }
        // ====================================================

        requestQueue.shift();

        if (typeof updateStatus === 'function') {
            updateStatus("전송 완료", "green");
        }

        setTimeout(() => {
            isProcessing = false;
            if (requestQueue.length > 0) processQueue();
        }, 1500);

    } catch (e) {
        console.error(e);
        if (typeof updateStatus === 'function') {
            updateStatus("전송 실패", "red");
        }
        setTimeout(() => {
            isProcessing = false;
            processQueue();
        }, 3000);
    }
}


window.addEventListener('load', () => {
    const bar = document.createElement('div');
    bar.id = 'status_msg_container';
    bar.style.cssText = "position:fixed; bottom:10px; right:10px; background:white; padding:10px; border:2px solid #333; z-index:9000; border-radius:8px; font-weight:900; font-size:12px; box-shadow:0 2px 10px rgba(0,0,0,0.2);";
    bar.innerHTML = `<span id="status_msg">대기 중...</span> <button onclick="loadSheetData()" style="margin-left:10px; padding:5px; font-weight:900;">↻</button>`;
    document.body.appendChild(bar);
});
