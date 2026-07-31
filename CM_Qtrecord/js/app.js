/* =========================================
   [1] 구글 시트 ID 및 설정
   ========================================= */

const SUPABASE_URL = 'https://cdugpffigeboqqlxkvzr.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkdWdwZmZpZ2Vib3FxbHhrdnpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2MjI2NjIsImV4cCI6MjA5MTE5ODY2Mn0.tTHORlm0EwXTD8u_PAULRZ-lLFMVzNR5QodXY_dmPTM'
const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

const CLASSSHEETID = '1jtye6oY0gHPDn7xJla75uG_fhdy_yktx9v4SObCFHRg';
const CLASSSHEETNAME = '학생별수업';

/* =========================================
   [2] 전역 변수
   ========================================= */
let currentUser = "";
let occupiedSeats = {};
let distributionMap = {};
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
   [5-1] 좌석 마스터 로딩 - Supabase students
   ========================================= */
async function loadSheetData() {
    if (requestQueue.length > 0) return;

    updateStatus('좌석 데이터 요청 중...', 'black');

    try {
        const { data: students, error } = await supabaseClient
            .from('students')
            .select('student_id, class_name, name, study_room, seat_number')
            .not('study_room', 'is', null)
            .not('seat_number', 'is', null);

        if (error) throw error;

        occupiedSeats = {};
        distributionMap = {};

        for (const student of students || []) {
            const location = String(student.study_room || '').trim();
            const seatKey = String(student.seat_number || '').trim();
            const studentId = String(student.student_id || '').trim();

            // 관/좌석/학번이 하나라도 없으면 좌석 배정 대상에서 제외
            if (!location || !seatKey || !studentId) continue;

            const roomKey = normalizeLocationKey(location);

            if (!occupiedSeats[roomKey]) {
                occupiedSeats[roomKey] = {};
            }

            occupiedSeats[roomKey][seatKey] = {
                classNum: student.class_name || '',
                studentId: studentId,
                name: student.name || '',
                locationName: location,
                status: '정상'
            };

            if (!distributionMap[roomKey]) {
                distributionMap[roomKey] = new Set();
            }

            distributionMap[roomKey].add(seatKey);
        }

        updateStatus('출결 시트 로딩 중...', 'blue');
        loadClassData();
        loadAlertData();

    } catch (error) {
        console.error('[Supabase students 로딩 오류]', error);
        updateStatus(`좌석 데이터 오류: ${error.message}`, 'red');

        // 좌석 데이터가 불러와지지 않아도 이전 화면 잔상은 제거
        occupiedSeats = {};
        distributionMap = {};
        updateSeatColors();
    }
}

function loadClassData() {
    const oldClass = document.getElementById('gviz_class_script');
    if (oldClass) oldClass.remove();

    const script = document.createElement('script');
    script.id = 'gviz_class_script';
    script.src =
        `https://docs.google.com/spreadsheets/d/${CLASSSHEETID}/gviz/tq` +
        `?tq=select%20*&tqx=responseHandler:handleClassData` +
        `&sheet=${encodeURIComponent(CLASSSHEETNAME)}`;

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
}


/* =========================================
   [5-3] 과거 지도 알림 로그 - Supabase
   ========================================= */
async function loadAlertData() {
    try {
        const today = new Date();

        const recordDate = [
            today.getFullYear(),
            String(today.getMonth() + 1).padStart(2, '0'),
            String(today.getDate()).padStart(2, '0')
        ].join('-');

        const { data: records, error } = await supabaseClient
            .from('supervisor_records')
            .select(`
                id,
                record_date,
                record_time,
                study_room,
                seat_number,
                class_name,
                student_id,
                student_name,
                guidance_type,
                note,
                alert_text
            `)
            .eq('record_date', recordDate)
            .neq('alert_text', '')
            .order('id', { ascending: true });

        if (error) throw error;

        alertRows = (records || []).map(record => ({
            id: record.id,
            time: String(record.record_time || '').slice(0, 5),
            location: record.study_room || '',
            seat: String(record.seat_number || '').trim(),
            classNum: record.class_name || '',
            studentId: record.student_id || '',
            name: record.student_name || '',
            note: String(record.note || '').trim(),
            alertText: record.alert_text || '',
            isNewSession: false
        }));

        console.log('[Supabase 알림 로그 조회 완료]', alertRows);

        renderAlertsForActiveTab();

    } catch (error) {
        console.error('[Supabase 알림 로그 조회 실패]', error);
        alertRows = [];
        renderAlertsForActiveTab();
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

    const createItem = (text, isNewSession) => {
        const newBadge = isNewSession
            ? `<span style="
                    display:inline-block;
                    margin-right:6px;
                    padding:1px 5px;
                    border-radius:4px;
                    background:#e7f5eb;
                    color:#2f7d42;
                    font-size:10px;
                    font-weight:bold;
                ">방금 입력</span>`
            : '';

        return `
            <div class="log-item" style="
                display:flex;
                justify-content:space-between;
                align-items:center;
                padding:8px 0;
                border-bottom:1px solid #eee;
                font-size:13px;
                color:${isNewSession ? '#333' : '#666'};
                font-weight:${isNewSession ? '600' : '400'};
            ">
                <span style="flex:1;">
                    ${newBadge}${text}
                </span>
                <button
                    onclick="copySingleLog(this)"
                    style="
                        margin-left:10px;
                        padding:2px 8px;
                        border:1px solid #ddd;
                        background:#fff;
                        border-radius:4px;
                        cursor:pointer;
                        font-size:11px;
                        color:#666;
                    "
                >복사</button>
            </div>
        `;
    };

    const createSectionTitle = (title, isNewSession) => {
        return `
            <div style="
                margin-top:12px;
                padding:8px 0 6px;
                border-bottom:1px solid #ddd;
                color:${isNewSession ? '#2f7d42' : '#777'};
                font-size:12px;
                font-weight:bold;
            ">
                ${isNewSession ? '●' : '•'} ${title}
            </div>
        `;
    };

    const activeTab = getActiveTabElement();

    if (!activeTab) {
        container.innerHTML =
            "<div style='text-align:center; padding:20px; color:#999; font-size:12px;'>표시할 알림 로그가 없습니다.</div>";
        return;
    }

    const tabKey = normalizeLocationKey(activeTab.id);

    // 현재 관의 로그만 남긴 뒤, 최신 저장 ID가 위로 오도록 정렬
    const currentRoomLogs = alertRows
        .filter(row => {
            const locationKey = normalizeLocationKey(row.location);
            return tabKey.startsWith(locationKey);
        })
        .sort((a, b) => Number(b.id) - Number(a.id));

    // 이번 접속 중 직접 저장한 로그
    const newSessionLogs = currentRoomLogs.filter(
        row => row.isNewSession === true
    );

    // 관 진입 시 DB에서 불러온 기존 로그
    const previousLogs = currentRoomLogs.filter(
        row => row.isNewSession !== true
    );

    const createLogText = (row) => {
        const timeLabel = row.time ? `[${row.time}]` : '[기록]';

        // 기타는 alertText 자체가 "기타(note)"이므로 note를 중복 표기하지 않음
        const isEtcAlert = String(row.alertText || '').startsWith('기타(');
        const noteSuffix = row.note && !isEtcAlert
            ? ` (${row.note})`
            : '';

        return (
            `${timeLabel} ${row.location} ${row.seat}번 ` +
            `${row.classNum}반 ${row.studentId} ${row.name} : ` +
            `${row.alertText}${noteSuffix}`
        );
    };

    let html = '';

    if (newSessionLogs.length > 0) {
        html += createSectionTitle('이번 접속에서 입력한 알림', true);

        newSessionLogs.forEach(row => {
            html += createItem(createLogText(row), true);
        });
    }

    if (previousLogs.length > 0) {
        html += createSectionTitle('오늘 기존 알림', false);

        previousLogs.forEach(row => {
            html += createItem(createLogText(row), false);
        });
    }

    container.innerHTML = html ||
        "<div style='text-align:center; padding:20px; color:#999; font-size:12px;'>표시할 알림 로그가 없습니다.</div>";

    // 최신 로그가 상단에 있으므로 상단을 보여줌
    container.scrollTop = 0;

    if (ta) {
        ta.value = container.innerText;
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

    // 관 진입 직후: 좌석 배정 + 현재 수업상태 + 오늘 지도알림을 1회 로딩
    loadSheetData();

    // 이후 1분마다: 학생별수업 상태만 다시 가져옴
    // handleClassData() 내부에서 loadAlertData()도 이어서 실행됨
    if (window.refreshInterval) clearInterval(window.refreshInterval);

    window.refreshInterval = setInterval(() => {
        if (requestQueue.length === 0 && !isProcessing) {
            loadClassData();
        }
    }, 60000);
}

function goToHome() {
    if (!confirm("처음 화면으로 돌아가시겠습니까?")) return;
    if (window.refreshInterval) {
        clearInterval(window.refreshInterval);
        window.refreshInterval = null;
    }
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

    updateStatus("당일 누적 기록 확인 중...", "blue");

    try {
        // 브라우저의 한국 현지 날짜/시간을 DB에 명시적으로 저장
        const now = new Date();

        const recordDate = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, '0'),
            String(now.getDate()).padStart(2, '0')
        ].join('-');

        const recordTime = [
            String(now.getHours()).padStart(2, '0'),
            String(now.getMinutes()).padStart(2, '0'),
            String(now.getSeconds()).padStart(2, '0')
        ].join(':');

        const studentId = String(payload.studentId || '').trim();
        const rawType = String(payload.type || '').trim();

        // GAS normalizeType()와 동일한 지도유형 정규화
        let currentType = rawType;
        if (currentType.includes('전자기기')) {
            currentType = '전자기기 위반';
        } else if (currentType.includes('수업참여')) {
            currentType = '수업참여';
        } else if (currentType === '정숙주의') {
            currentType = '정숙주의';
        } else if (currentType === '수면주의') {
            currentType = '수면주의';
        }

        // 1. 오늘 이 학생의 기존 감독기록만 조회
        const { data: todayRecords, error: selectError } = await supabaseClient
            .from('supervisor_records')
            .select('guidance_type')
            .eq('student_id', studentId)
            .eq('record_date', recordDate);

        if (selectError) throw selectError;

        // 2. 기존 기록 + 지금 입력한 유형을 합산
        const counts = {
            sleep: 0,
            device: 0,
            quiet: 0,
            participation: 0,
            nightUnconfirmed: 0
        };

        const allTypes = [
            ...(todayRecords || []).map(record => String(record.guidance_type || '').trim()),
            currentType
        ];

        for (const type of allTypes) {
            if (type === '수면주의') {
                counts.sleep++;
            } else if (type.includes('전자기기')) {
                counts.device++;
            } else if (type === '정숙주의') {
                counts.quiet++;
            } else if (type.includes('수업참여')) {
                counts.participation++;
            } else if (type === '야간자습 미확인') {
                counts.nightUnconfirmed++;
            }
        }

        // 3. 현재 입력한 지도유형 기준의 경고 문구 생성
        let alertText = '';

        if (currentType === '수면주의' && counts.sleep >= 3) {
            alertText = `수면주의 ${counts.sleep}회`;
        } else if (
            currentType === '야간자습 미확인' &&
            counts.nightUnconfirmed >= 1
        ) {
            alertText = `야간자습 미확인 ${counts.nightUnconfirmed}회`;
        } else if (currentType === '전자기기 위반' && counts.device >= 1) {
            alertText = `전자기기 위반 ${counts.device}회`;
        } else if (currentType === '정숙주의' && counts.quiet >= 1) {
            alertText = `정숙주의 ${counts.quiet}회`;
        } else if (currentType === '수업참여' && counts.participation >= 1) {
            alertText = `수업참여 ${counts.participation}회`;
        } else if (rawType === '기타') {
            const noteText = String(payload.note || '').trim() || '내용 없음';
            alertText = `기타(${noteText})`;
        }

        updateStatus("Supabase에 기록 저장 중...", "blue");

        // 4. 누적값과 경고 문구를 포함하여 신규 기록 저장
        const { data: savedRecord, error: insertError } = await supabaseClient
            .from('supervisor_records')
            .insert({
                record_date: recordDate,
                record_time: recordTime,
                study_room: String(payload.location || '').trim(),
                seat_number: String(payload.seat || '').trim(),
                class_name: String(payload.classNum || '').trim(),
                student_id: studentId,
                student_name: String(payload.name || '').trim(),
                guidance_type: rawType,
                note: String(payload.note || '').trim(),
                sleep_count: counts.sleep,
                device_count: counts.device,
                quiet_count: counts.quiet,
                participation_count: counts.participation,
                manager_name: String(payload.user || '').trim(),
                alert_text: alertText
            })
            .select()
            .single();

        if (insertError) throw insertError;

        console.log('[감독기록 저장 완료]', savedRecord);
        // 저장 직후: DB에 실제로 저장된 경고 기록을 알림 데이터에도 반영
        if (savedRecord.alert_text) {
            alertRows.push({
                id: savedRecord.id,
                time: String(savedRecord.record_time || '').slice(0, 5),
                location: savedRecord.study_room || '',
                seat: String(savedRecord.seat_number || '').trim(),
                classNum: savedRecord.class_name || '',
                studentId: savedRecord.student_id || '',
                name: savedRecord.student_name || '',
                note: String(savedRecord.note || '').trim(),
                alertText: savedRecord.alert_text,
                isNewSession: true
            });
        }

        renderAlertsForActiveTab();

        const popupText = alertText || rawType;

        alert(
            `✅ 기록되었습니다!\n\n` +
            `학생: ${payload.name}\n` +
            `내용: ${popupText}`
        );

        requestQueue.shift();
        updateStatus("Supabase 저장 완료", "green");

    } catch (error) {
        console.error('[감독기록 저장 실패]', error);

        updateStatus(`저장 실패: ${error.message}`, "red");

        alert(
            `❌ 기록 저장에 실패했습니다.\n\n` +
            `${error.message}\n\n` +
            `콘솔의 [감독기록 저장 실패] 오류를 확인해주세요.`
        );
    } finally {
        isProcessing = false;

        if (requestQueue.length > 0) {
            setTimeout(processQueue, 1500);
        }
    }
}






window.addEventListener('load', () => {
    const bar = document.createElement('div');
    bar.id = 'status_msg_container';
    bar.style.cssText = "position:fixed; bottom:10px; right:10px; background:white; padding:10px; border:2px solid #333; z-index:9000; border-radius:8px; font-weight:900; font-size:12px; box-shadow:0 2px 10px rgba(0,0,0,0.2);";
    bar.innerHTML = `<span id="status_msg">대기 중...</span> <button onclick="loadSheetData()" style="margin-left:10px; padding:5px; font-weight:900;">↻</button>`;
    document.body.appendChild(bar);
});
