// ==========================================
// KONFIGURASI & GLOBAL VARIABEL
// ==========================================
let BIAYA_RUSUM_STANDAR = 6000000;
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzMprNgTOeIFiCUO3BJHKiU4jphHymhQ-JZolmPIt2LiRg2MrTMs1x25oO_AehfEd6B/exec'; // URL Google Apps Script Anda

let transaksiData = []; 
let mahasiswaMaster = []; 

let activeTab = 'form';
let activeAdminSubtab = 'verifikasi';
let activeAngkatanStatusFilter = 'ALL';
let activeReviewItem = null;
let activeKwitansiItem = null;
let isAdminLoggedIn = false;
let selectedModalStatus = 'Pending';
let activeMonitoringMode = 'angkatan'; // 'angkatan' atau 'ta'
let globalTAAktif = '2025/2026'; // Default, nanti ditimpa dari Spreadsheet
let activeVerifikasiStatusFilter = 'ALL';

const defaultStatusNotes = {
    'Pending': 'Pembayaran sedang dalam proses verifikasi data dan mutasi rekening.',
    'Disetujui': 'Pembayaran setoran angsuran telah diverifikasi sah.',
    'Ditolak': 'Bukti transfer tidak valid atau nominal tidak sesuai ketentuan. Silakan perbaiki dan unggah ulang.'
};
// --- HELPER FUNCTIONS ---
const formatRp = (angka) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka || 0);
const getBadge = (status) => {
    const map = { 'Disetujui': 'bg-emerald-100 text-emerald-800', 'Ditolak': 'bg-rose-100 text-rose-800', 'Pending': 'bg-amber-100 text-amber-800' };
    return map[status] || map['Pending'];
};
// ==========================================
// FUNGSI FETCH GOOGLE SHEETS
// ==========================================
async function fetchSpreadsheetData() {
    try {
        showToast("Memuat Data", "Sedang menghubungkan ke database server...");
        const response = await fetch(SCRIPT_URL + "?action=getData");
        const data = await response.json();
        
        if (data.biayaRusum) {
            BIAYA_RUSUM_STANDAR = Number(data.biayaRusum);
        }
        if (data.taAktif) {
            globalTAAktif = String(data.taAktif).trim();
            const badgeTA = document.getElementById('display-ta-aktif');
            if (badgeTA) {
                badgeTA.innerText = globalTAAktif;
            }
        }
        transaksiData = data.transaksi.map(tx => ({
            ...tx,
            nim: String(tx.nim), 
            nominal: Number(tx.nominal)
        })).reverse(); 
        
        mahasiswaMaster = data.mahasiswa.map(m => ({
            ...m,
            nim: String(m.nim)
        }));
        
        populateDynamicFilters();
        showToast("Berhasil", "Data berhasil dimuat dari database Google Sheets.");
        
        if (isAdminLoggedIn) {
            renderAdminDashboard();
        }
    } catch (error) {
        showToast("Error", "Gagal memuat data. Periksa koneksi internet.");
        console.error("Error fetching data:", error);
    }
}

function populateDynamicFilters() {
    const uniqueTA = [...new Set(transaksiData.map(item => item.tahunAkademik))].filter(Boolean).sort().reverse();
    const filterTaAdmin = document.getElementById('filter-ta-admin');
    if (filterTaAdmin) {
        filterTaAdmin.innerHTML = '<option value="Semua">Semua TA</option>' + 
            uniqueTA.map(ta => `<option value="${ta}">${ta}</option>`).join('');
    }
    renderMonitoringFiltersUI();
}

// ==========================================
// LOGIKA KALKULASI & CEK MAHASISWA
// ==========================================
function getStudentPaymentSummary(nim, targetTA = null) {
    let approvedTx = transaksiData.filter(d => d.nim === nim && d.status === 'Disetujui');
    
    if (targetTA && targetTA !== 'ALL') {
        approvedTx = approvedTx.filter(d => d.tahunAkademik === targetTA);
    }

    const totalDibayar = approvedTx.reduce((acc, curr) => acc + (Number(curr.nominal) || 0), 0);
    const sisaTagihan = Math.max(0, BIAYA_RUSUM_STANDAR - totalDibayar);
    const percentPaid = Math.min(100, Math.round((totalDibayar / BIAYA_RUSUM_STANDAR) * 100));

    let statusOverall = 'BELUM_BAYAR';
    if (totalDibayar >= BIAYA_RUSUM_STANDAR) {
        statusOverall = 'LUNAS';
    } else if (totalDibayar > 0) {
        statusOverall = 'DICICIL';
    }

    return { totalDibayar, sisaTagihan, percentPaid, statusOverall, approvedCount: approvedTx.length, ta: targetTA };
}

// Fitur Baru: Autofill Nama dan Info Dasar Mahasiswa
function autofillNama() {
    const nimInput = document.getElementById('input-nim');
    const namaInput = document.getElementById('input-nama');
    const warningText = document.getElementById('nim-warning');

    if (!nimInput || !namaInput) return;

    const query = nimInput.value.trim();

    if (query === '') {
        namaInput.value = '';
        if (warningText) warningText.classList.add('hidden');
        nimInput.classList.remove('border-rose-500', 'ring-rose-200', 'border-emerald-500');
        return;
    }

    const student = mahasiswaMaster.find(m => String(m.nim) === query);

    if (student) {
        namaInput.value = student.nama || '';
        
        // Opsional: Otomatis mengisi prodi dan tingkatan jika elemennya ada
        const inputProdi = document.getElementById('input-prodi');
        const inputTingkatan = document.getElementById('input-tingkatan');
        if (inputProdi && student.prodi) inputProdi.value = student.prodi;
        if (inputTingkatan && student.tingkatan) inputTingkatan.value = student.tingkatan;

        if (warningText) warningText.classList.add('hidden');
        nimInput.classList.remove('border-rose-500', 'ring-rose-200');
        nimInput.classList.add('border-emerald-500'); 
    } else {
        namaInput.value = '';
        if (warningText) warningText.classList.remove('hidden');
        nimInput.classList.remove('border-emerald-500');
        nimInput.classList.add('border-rose-500', 'ring-rose-200');
    }
}

function checkPreviousInstallments() {
    const nim = document.getElementById('input-nim').value.trim();
    const inputTA = document.getElementById('input-ta');
    const ta = inputTA ? inputTA.value : null; 
    const infoDiv = document.getElementById('nim-installment-info');

    // Reset jika kosong atau TA belum dipilih
    if (!nim || !ta) {
        infoDiv.classList.add('hidden');
        return;
    }

    const summary = getStudentPaymentSummary(nim, ta);

    if (summary.totalDibayar > 0) {
        infoDiv.classList.remove('hidden');
        const formattedDibayar = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(summary.totalDibayar);
        const formattedSisa = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(summary.sisaTagihan);

        if (summary.statusOverall === 'LUNAS') {
            infoDiv.innerHTML = `<p class="font-bold text-emerald-800"><i class="fa-solid fa-circle-check"></i> Sudah Lunas (${formattedDibayar}) untuk TA ${ta}</p>`;
        } else {
            infoDiv.innerHTML = `
                <p class="font-bold text-amber-800"><i class="fa-solid fa-calculator"></i> Riwayat Angsuran TA ${ta}:</p>
                <p class="text-slate-700">Telah dibayar: <b>${formattedDibayar}</b> (${summary.percentPaid}%) &bull; Sisa: <b class="text-rose-700">${formattedSisa}</b></p>
            `;
        }
    } else {
        infoDiv.classList.add('hidden');
    }
}

// ==========================================
// DRAG & DROP FILE HANDLER (FOTO/PDF)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    if (!dropZone) return;

    const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
    const toggleHighlight = (add) => dropZone.classList.toggle('border-emerald-500', add) || dropZone.classList.toggle('bg-emerald-50', add);

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, prevent));
    ['dragenter', 'dragover'].forEach(ev => dropZone.addEventListener(ev, () => toggleHighlight(true)));
    ['dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, () => toggleHighlight(false)));
    dropZone.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
});

function handleFileSelect(e) {
    handleFiles(e.target.files);
}

function handleFiles(files) {
    if (files.length === 0) return;
    const file = files[0];
    
    if (file.size > 3 * 1024 * 1024) {
        showToast("File Terlalu Besar", "Maksimal ukuran file adalah 3MB. Silakan kompres file Anda.");
        document.getElementById('input-file').value = '';
        return;
    }

    document.getElementById('file-name').innerText = file.name;
    document.getElementById('file-preview').classList.remove('hidden');

    const reader = new FileReader();
    reader.onload = function(e) {
        document.getElementById('input-resi-base64').value = e.target.result;
        document.getElementById('input-resi-filename').value = file.name;
    }
    reader.readAsDataURL(file);
}

// ==========================================
// NAVIGASI APLIKASI
// ==========================================
function selectTab(tab) {
    activeTab = tab;
    ['form', 'status', 'admin'].forEach(t => {
        const isMatch = t === tab;
        document.getElementById(`tab-content-${t}`).classList.toggle('hidden', !isMatch);
        document.getElementById(`tab-btn-${t}`).className = `px-4 py-2.5 rounded-xl text-xs font-semibold transition flex items-center space-x-2 ${isMatch ? 'bg-emerald-800 text-white shadow-inner' : 'text-emerald-100 hover:bg-emerald-800/60'}`;
        document.getElementById(`m-tab-${t}`).className = `flex-1 py-3 text-center text-xs font-semibold flex flex-col items-center space-y-1 ${isMatch ? 'bg-emerald-800 text-white' : 'text-emerald-200 hover:bg-emerald-900'}`;
    });
    if (tab === 'admin' && isAdminLoggedIn) renderAdminDashboard();
}

function copyRekening() {
    const temp = document.createElement('textarea');
    temp.value = '7000005009';
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    document.body.removeChild(temp);
    showToast("Tersalin!", "Nomor rekening 7000005009 disalin ke clipboard.");
}

// ==========================================
// FORM SUBMIT (MAHASISWA) KE GOOGLE SHEETS
// ==========================================
async function handleFormSubmit(e) {
    e.preventDefault();
    const btnSubmit = document.getElementById('btn-submit-form');
    btnSubmit.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>MENGIRIM KE SERVER...</span>`;
    btnSubmit.disabled = true;

    const nim = document.getElementById('input-nim').value.trim();
    
    // Validasi: Harus 8 angka (24110412) ATAU format 11 karakter dengan titik (21.1.1.0412)
    const isValidNIM = /^\d{8}$/.test(nim) || /^\d{2}\.\d{1}\.\d{1}\.\d{4}$/.test(nim);
    
    if (!isValidNIM) {
        showToast("NIM Tidak Valid", "NIM harus 8 digit angka atau format titik yang benar.");
        btnSubmit.innerHTML = `<i class="fa-solid fa-paper-plane"></i><span>KIRIM KONFIRMASI PEMBAYARAN</span>`;
        btnSubmit.disabled = false;
        return;
    }

    const nama = document.getElementById('input-nama').value.trim();
    const email = document.getElementById('input-email').value.trim();
    const prodi = document.getElementById('input-prodi').value;
    const tingkatan = document.getElementById('input-tingkatan').value;
    const tahunAkademik = document.getElementById('input-ta').value;
    
    const nominalRaw = document.getElementById('input-nominal').value.replace(/\./g, '');
    const nominal = parseInt(nominalRaw) || 0;
    
    const bank = document.getElementById('input-bank').value.trim();
    const tanggal = document.getElementById('input-tanggal').value;
    const catatan = document.getElementById('input-catatan').value.trim();

    const resiBase64 = document.getElementById('input-resi-base64').value;
    const resiFilename = document.getElementById('input-resi-filename').value;

    if (!resiBase64) {
        showToast("Peringatan", "Harap unggah bukti transfer (resi) terlebih dahulu.");
        btnSubmit.innerHTML = `<i class="fa-solid fa-paper-plane"></i><span>KIRIM KONFIRMASI PEMBAYARAN</span>`;
        btnSubmit.disabled = false;
        return;
    }

    const newItem = {
        action: 'addTransaction',
        id: `REQ-${Math.floor(1000 + Math.random() * 9000)}`,
        nim, nama, email, prodi, tingkatan, tahunAkademik, nominal, bank, tanggal,
        resiBase64: resiBase64,
        resiFilename: resiFilename,
        resiUrl: resiBase64,
        catatan: catatan || '-',
        status: 'Pending',
        adminNote: 'Setoran angsuran sedang dalam proses verifikasi mutasi rekening.'
    };

    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(newItem)
        });

        transaksiData.unshift(newItem); 
        document.getElementById('form-konfirmasi').reset();
        document.getElementById('nim-installment-info').classList.add('hidden');
        document.getElementById('file-preview').classList.add('hidden');
        document.getElementById('input-resi-base64').value = '';

        showToast("Pengajuan Terkirim", `Konfirmasi pembayaran untuk ${nama} berhasil disimpan.`);
        selectTab('status');
        document.getElementById('search-status-input').value = nim; // Auto isi form pencarian dengan NIM barusan
        executeStatusSearch(); 
    } catch (error) {
        showToast("Gagal Menyimpan", "Terjadi kesalahan koneksi server.");
    } finally {
        btnSubmit.innerHTML = `<i class="fa-solid fa-paper-plane"></i><span>KIRIM KONFIRMASI PEMBAYARAN</span>`;
        btnSubmit.disabled = false;
    }
}

// ==========================================
// PENCARIAN STATUS & DROPDOWN TA DINAMIS
// ==========================================
function updateStatusTADisplay(ta, nim, totalTAs = 1) {
    // 1. Siapkan data transaksi khusus mahasiswa ini
    const studentTx = transaksiData.filter(d => d.nim === nim);
    let filteredTx = studentTx;
    
    let totalDibayar = 0;
    let sisaTagihan = 0;
    
    let labelDisetujui = 'Total Disetujui';
    let labelSisa = 'Sisa Tagihan';

    // 2. Logika Pemisahan (Jika 'Semua TA' dipilih vs 'TA Spesifik')
    if (ta === 'ALL') {
        // Hitung total dari SEMUA TA yang disetujui
        const approvedTx = studentTx.filter(d => d.status === 'Disetujui');
        totalDibayar = approvedTx.reduce((acc, curr) => acc + (Number(curr.nominal) || 0), 0);
        
        // Kalkulasi sisa hutang dari keseluruhan masa studi yang tercatat
        sisaTagihan = Math.max(0, (totalTAs * BIAYA_RUSUM_STANDAR) - totalDibayar);
        
        labelDisetujui = 'Total Disetujui (Semua TA)';
        labelSisa = 'Total Sisa (Keseluruhan)';
    } else {
        // Saring transaksi hanya untuk TA yang dipilih
        filteredTx = studentTx.filter(d => d.tahunAkademik === ta);
        
        const summary = getStudentPaymentSummary(nim, ta);
        totalDibayar = summary.totalDibayar;
        sisaTagihan = summary.sisaTagihan;
    }

    const formattedTotal = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(totalDibayar);
    const formattedSisa = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(sisaTagihan);
    
    // Logika Warna Status (Hijau jika Lunas, Merah jika Nunggak)
    const isLunas = sisaTagihan <= 0;
    const boxColor = isLunas ? 'bg-emerald-800/80 border-emerald-500' : 'bg-rose-950 border-rose-500';
    const textColor = isLunas ? 'text-emerald-300' : 'text-rose-300';
    const iconSign = isLunas ? '<i class="fa-solid fa-check-circle"></i>' : '<i class="fa-solid fa-triangle-exclamation"></i>';

    // 3. CETAK KOTAK KALKULASI
    const calcContainer = document.getElementById('status-calculation-box');
    if (calcContainer) {
        calcContainer.innerHTML = `
            <div class="bg-white/10 p-3.5 rounded-xl border border-white/10">
                <span class="text-emerald-200 text-[10px] font-bold uppercase block">${labelDisetujui}</span>
                <span class="text-lg font-black">${formattedTotal}</span>
            </div>
            <div class="${boxColor} p-3.5 rounded-xl border-2 shadow-inner transition-colors">
                <span class="${textColor} text-[10px] font-extrabold uppercase block tracking-wider">${iconSign} ${labelSisa}</span>
                <span class="text-xl font-black text-white">${formattedSisa}</span>
            </div>
        `;
    }

    // 4. CETAK DAFTAR RIWAYAT TRANSAKSI (Sesuai Filter)
    const historyContainer = document.getElementById('status-history-list');
    if (historyContainer) {
        if (filteredTx.length === 0) {
            historyContainer.innerHTML = `<div class="text-center py-6 text-slate-400 text-xs italic">Belum ada riwayat transaksi ${ta !== 'ALL' ? 'di TA ini' : ''}.</div>`;
        } else {
            historyContainer.innerHTML = filteredTx.map((item, index) => {
                const formattedNominal = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(item.nominal || 0);
                let badge = item.status === 'Disetujui' ? 'bg-emerald-100 text-emerald-800' : (item.status === 'Ditolak' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800');
                let cleanDate = formatTanggalWaktu(item.tanggal);
                let btn = item.status === 'Disetujui' ? `<button onclick="openKwitansiPreview('${item.id}')" class="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-900 text-white rounded-xl text-xs font-bold shadow-sm flex items-center space-x-1.5"><i class="fa-solid fa-receipt"></i><span>Cetak Kwitansi</span></button>` : '';

                return `
                    <div class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3 text-xs mt-3">
                        <div class="flex justify-between items-center border-b border-slate-100 pb-2.5">
                            <div class="flex items-center space-x-2">
                                <span class="font-mono text-[11px] font-bold text-slate-400">#${filteredTx.length - index}</span>
                                <span class="font-extrabold text-slate-800">${item.id}</span>
                                <span class="text-slate-300">|</span>
                                <span class="text-slate-600 font-medium">${formattedNominal} <span class="text-[10px] text-slate-400 font-normal">(TA ${item.tahunAkademik})</span></span>
                            </div>
                            <span class="px-2.5 py-0.5 rounded-lg text-[11px] font-bold ${badge}">${item.status}</span>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-600 text-[11px]">
                            <div><b class="text-slate-400">Bank & Tgl:</b> ${item.bank || '-'} (${cleanDate})</div>
                            <div><b class="text-slate-400">Catatan:</b> ${item.catatan || '-'}</div>
                            <div class="sm:col-span-2"><b class="text-slate-400">Admin Note:</b> <span class="italic text-slate-700">${item.adminNote || '-'}</span></div>
                        </div>

                        ${btn ? `<div class="pt-1 flex justify-end">${btn}</div>` : ''}
                    </div>
                `;
            }).join('');
        }
    }
}

function executeStatusSearch() {
    const query = document.getElementById('search-status-input').value.trim().toLowerCase();
    const resultsContainer = document.getElementById('search-status-results');

    if (!query) {
        resultsContainer.innerHTML = `<div class="text-center py-12 border-2 border-dashed border-slate-200 rounded-2xl"><h4 class="text-xs font-bold text-slate-700">Ketik NIM atau Nama Untuk Mencari</h4></div>`;
        return;
    }

    const student = mahasiswaMaster.find(m => 
        (m.nim && String(m.nim).toLowerCase() === query) || 
        (m.nama && m.nama.toLowerCase().includes(query))
    );

    const studentTx = transaksiData.filter(d => 
        (student && d.nim === student.nim) || 
        (!student && ((d.nim && String(d.nim).toLowerCase() === query) || (d.nama && d.nama.toLowerCase().includes(query))))
    );

    if (!student && studentTx.length === 0) {
        resultsContainer.innerHTML = `<div class="text-center py-12 border border-slate-200 bg-slate-50 rounded-2xl"><p class="text-xs font-bold text-slate-700">Data Tidak Ditemukan</p></div>`;
        return;
    }

    // Ambil Data Identitas
    const targetNim = student ? student.nim : studentTx[0].nim;
    const studentName = student ? student.nama : studentTx[0].nama;
    const studentProdi = student ? student.prodi : (studentTx[0].prodi || '-');
    const studentTingkatan = student ? student.tingkatan : (studentTx[0].tingkatan || '-');
    const studentAngkatan = student ? parseInt(student.angkatan) : parseInt((studentTx[0].tahunAkademik || globalTAAktif).split('/')[0]);

    // Kalkulasi Jangkauan TA
    const tahunAktifStart = parseInt(globalTAAktif.split('/')[0]);
    const startYear = studentAngkatan || tahunAktifStart;
    
    const allTxYears = studentTx.map(t => parseInt((t.tahunAkademik || '').split('/')[0])).filter(n => !isNaN(n));
    const maxTxYear = allTxYears.length > 0 ? Math.max(...allTxYears) : tahunAktifStart;
    
    let batasAtasTA = Math.max(tahunAktifStart, maxTxYear);

    if (student) {
        const statusMhs = String(student.status || '').toLowerCase();
        if (['lulus', 'keluar', 'do', 'pindah', 'non-aktif'].includes(statusMhs)) {
            batasAtasTA = Math.max(maxTxYear, startYear + 3);
        }
    }

    // Bangun daftar dropdown TA
    let listTA = [];
    for (let y = batasAtasTA; y >= startYear; y--) {
        listTA.push(`${y}/${y+1}`);
    }
    if (listTA.length === 0) listTA = [globalTAAktif];
    const initialTA = listTA.includes(globalTAAktif) ? globalTAAktif : listTA[0];

    // BENTUK KERANGKA HTML
    let html = `
        <div class="bg-emerald-900 text-white rounded-2xl p-6 shadow-md space-y-4">
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-emerald-800 pb-4 gap-4 sm:gap-0">
                <div>
                    <h3 class="text-lg font-extrabold">${studentName} (${targetNim})</h3>
                    <p class="text-xs text-emerald-200">${studentProdi} - ${studentTingkatan}</p>
                </div>

                <!-- DROPDOWN TA -->
                <div class="relative shrink-0 flex items-center group">
                    <div class="absolute left-3 pointer-events-none transition group-hover:text-emerald-300 text-emerald-500">
                        <i class="fa-regular fa-calendar-days text-[11px]"></i>
                    </div>
                    
                    <!-- Menambahkan Opsi 'Semua TA' di Paling Atas -->
                    <select onchange="updateStatusTADisplay(this.value, '${targetNim}', ${listTA.length})" class="appearance-none bg-emerald-950/50 border border-emerald-700/60 text-emerald-100 text-[11px] font-bold rounded-xl pl-8 pr-8 py-1.5 focus:outline-none focus:border-emerald-400 hover:border-emerald-500 cursor-pointer shadow-sm transition w-full">
                        <option value="ALL" class="bg-emerald-900">Semua TA</option>
                        ${listTA.map(ta => `<option value="${ta}" ${ta === initialTA ? 'selected' : ''} class="bg-emerald-900">${ta}</option>`).join('')}
                    </select>
                    
                    <div class="absolute right-3 pointer-events-none transition group-hover:text-emerald-300 text-emerald-500">
                        <i class="fa-solid fa-chevron-down text-[9px]"></i>
                    </div>
                </div>
            </div>
            
            <!-- KOTAK KALKULASI (Wadah Kosong) -->
            <div id="status-calculation-box" class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs"></div>
        </div>
        
        <h4 class="text-xs font-bold text-slate-700 uppercase pt-4 pb-1 border-b border-slate-200">Riwayat Transaksi</h4>
        
        <!-- DAFTAR RIWAYAT TRANSAKSI (Wadah Kosong) -->
        <div id="status-history-list"></div>
    `;

    resultsContainer.innerHTML = html;

    // OTOMATIS JALANKAN PEMBARUAN SETELAH HTML DIBUAT
    updateStatusTADisplay(initialTA, targetNim, listTA.length);
}

// ==========================================
// ADMIN DASHBOARD & SECURE LOGIN
// ==========================================
async function loginAdmin() {
    const pin = document.getElementById('admin-pin-input').value.trim();
    const btnLogin = document.getElementById('btn-login-admin');

    if (!pin) {
        showToast("Peringatan", "Masukkan PIN terlebih dahulu.");
        return;
    }

    btnLogin.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i><span>Memverifikasi...</span>`;
    btnLogin.disabled = true;

    try {
        const response = await fetch(SCRIPT_URL + "?action=verifyPin&pin=" + encodeURIComponent(pin));
        const result = await response.json();

        if (result.success) {
            isAdminLoggedIn = true;
            document.getElementById('admin-pin-input').value = '';
            renderAdminDashboard();
            showToast("Login Berhasil", "Selamat datang di Panel Admin Keuangan.");
        } else {
            showToast("Akses Ditolak", "PIN yang Anda masukkan salah.");
            document.getElementById('admin-pin-input').value = '';
        }
    } catch (error) {
        showToast("Error", "Gagal menghubungi server. Periksa koneksi Anda.");
    } finally {
        btnLogin.innerHTML = `<span>Login Panel</span><i class="fa-solid fa-arrow-right-to-bracket ml-2"></i>`;
        btnLogin.disabled = false;
    }
}

function logoutAdmin() {
    isAdminLoggedIn = false;
    document.getElementById('admin-login-card').classList.remove('hidden');
    document.getElementById('admin-dashboard').classList.add('hidden');
    document.getElementById('admin-pin-input').value = '';
    showToast("Logout", "Anda telah keluar dari Panel Admin.");
}

function switchAdminSubtab(subtab) {
    activeAdminSubtab = subtab;
    const btnVerifikasi = document.getElementById('admin-subtab-verifikasi');
    const btnAngkatan = document.getElementById('admin-subtab-angkatan');
    const viewVerifikasi = document.getElementById('admin-view-verifikasi');
    const viewAngkatan = document.getElementById('admin-view-angkatan');

    if (subtab === 'verifikasi') {
        btnVerifikasi.className = "flex-1 py-2.5 px-4 rounded-xl text-xs font-bold bg-white text-emerald-900 shadow-sm flex items-center justify-center space-x-2";
        btnAngkatan.className = "flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-slate-600 flex items-center justify-center space-x-2";
        viewVerifikasi.classList.remove('hidden');
        viewAngkatan.classList.add('hidden');
        filterAdminTable();
    } else {
        btnAngkatan.className = "flex-1 py-2.5 px-4 rounded-xl text-xs font-bold bg-white text-emerald-900 shadow-sm flex items-center justify-center space-x-2";
        btnVerifikasi.className = "flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-slate-600 flex items-center justify-center space-x-2";
        viewAngkatan.classList.remove('hidden');
        viewVerifikasi.classList.add('hidden');
        renderAngkatanMonitoring();
    }
}

function renderAdminDashboard() {
    document.getElementById('admin-login-card').classList.add('hidden');
    document.getElementById('admin-dashboard').classList.remove('hidden');
    if (activeAdminSubtab === 'verifikasi') {
        updateAdminStats();
        filterAdminTable();
    } else {
        renderAngkatanMonitoring();
    }
}

function updateAdminStats() {
    let total = 0, pending = 0, disetujui = 0, ditolak = 0;
    let totalUang = 0;
    let uniqueStudents = new Set();
    const filterTaElement = document.getElementById('filter-ta-admin');
    const selectedTA = filterTaElement ? filterTaElement.value : 'Semua';

    transaksiData.forEach(item => {
        if (selectedTA !== 'Semua' && item.tahunAkademik !== selectedTA) return;

        total++;
        if (item.status === 'Pending') pending++;
        else if (item.status === 'Disetujui') {
            disetujui++;
            totalUang += parseFloat(item.nominal) || 0;
            uniqueStudents.add(item.nim);
        }
        else if (item.status === 'Ditolak') ditolak++;
    });

    const elTotal = document.getElementById('admin-stat-total');
    if (elTotal) elTotal.innerText = total;

    const elPending = document.getElementById('admin-stat-pending');
    if (elPending) elPending.innerText = pending;

    const elDisetujui = document.getElementById('admin-stat-disetujui');
    if (elDisetujui) elDisetujui.innerText = disetujui;

    const elDitolak = document.getElementById('admin-stat-ditolak');
    if (elDitolak) elDitolak.innerText = ditolak;

    const elUang = document.getElementById('admin-stat-penerimaan');
    if (elUang) elUang.innerText = 'Rp ' + totalUang.toLocaleString('id-ID');
    const elMhsCount = document.getElementById('admin-stat-mhs-count');
    if (elMhsCount) {
        elMhsCount.innerText = `${uniqueStudents.size} Mhs`;
    }
}

function filterVerifikasiStatus(status) {
    activeVerifikasiStatusFilter = status;
    
    const btnAll = document.getElementById('verif-filter-all');
    const btnPending = document.getElementById('verif-filter-pending');
    const btnDisetujui = document.getElementById('verif-filter-disetujui');
    const btnDitolak = document.getElementById('verif-filter-ditolak');
    
    [btnAll, btnPending, btnDisetujui, btnDitolak].forEach(btn => {
        if (btn) btn.className = "flex-1 sm:flex-none px-3 py-1.5 rounded-md text-slate-600 font-medium hover:text-slate-800 transition";
    });

    if (status === 'ALL' && btnAll) {
        btnAll.className = "flex-1 sm:flex-none px-3 py-1.5 rounded-md bg-white shadow font-bold text-slate-800";
    } else if (status === 'Pending' && btnPending) {
        btnPending.className = "flex-1 sm:flex-none px-3 py-1.5 rounded-md bg-white shadow font-bold text-amber-600";
    } else if (status === 'Disetujui' && btnDisetujui) {
        btnDisetujui.className = "flex-1 sm:flex-none px-3 py-1.5 rounded-md bg-white shadow font-bold text-emerald-600";
    } else if (status === 'Ditolak' && btnDitolak) {
        btnDitolak.className = "flex-1 sm:flex-none px-3 py-1.5 rounded-md bg-white shadow font-bold text-rose-600";
    }
    
    filterAdminTable();
}

function filterAdminTable() {
    const query = document.getElementById('admin-filter-search').value.toLowerCase();
    const filterTaElement = document.getElementById('filter-ta-admin');
    const taFilter = filterTaElement ? filterTaElement.value : 'Semua';

    const filtered = transaksiData.filter(item => {
        const matchQuery = item.nim.toLowerCase().includes(query) || 
                           item.nama.toLowerCase().includes(query);
                           
        const matchTA = (taFilter === 'Semua') || (item.tahunAkademik === taFilter);
        const matchStatus = (activeVerifikasiStatusFilter === 'ALL') || (item.status === activeVerifikasiStatusFilter);

        return matchQuery && matchTA && matchStatus;
    });

    renderAdminTable(filtered);
}

function renderAdminTable(data) {
    const tbody = document.getElementById('admin-table-body');
    if (!tbody) return;
    if (data.length === 0) return tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400 text-xs">Tidak ada data.</td></tr>`;

    tbody.innerHTML = data.map(item => `
        <tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors">
            <td class="p-3.5"><div class="text-xs font-bold text-slate-800">${item.nama}</div><div class="text-[11px] text-slate-500 font-mono mt-0.5">${item.nim}</div></td>
            <td class="p-3.5 text-xs text-slate-600">${item.prodi}</td>
            <td class="p-3.5"><div class="text-xs font-bold text-slate-700">${formatRp(item.nominal)}</div><div class="text-[10px] text-slate-400 mt-0.5">TA ${item.tahunAkademik}</div></td>
            <td class="p-3.5 text-xs"><div class="text-slate-700">${item.bank || '-'}</div><div class="text-[10px] text-slate-400 mt-0.5">${formatTanggalWaktu(item.tanggal)}</div></td>
            <td class="p-3.5 text-center"><span class="px-2.5 py-1 rounded-lg text-[10px] font-bold ${getBadge(item.status)}">${item.status}</span></td>
            <td class="p-3.5 text-center"><button onclick="openAdminDetailModal('${item.id}')" class="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition shadow-sm inline-flex items-center space-x-1.5 mx-auto"><i class="fa-solid fa-eye"></i><span>Tinjau</span></button></td>
        </tr>
    `).join('');
}

// ==========================================
// PEMANTAUAN ANGKATAN (FILTER PINTAR)
// ==========================================
function switchMonitoringMode(mode) {
    activeMonitoringMode = mode;
    const btnAngkatan = document.getElementById('mode-btn-angkatan');
    const btnTA = document.getElementById('mode-btn-ta');

    if (mode === 'angkatan') {
        btnAngkatan.className = "flex-1 py-2 text-xs font-bold rounded-lg bg-white text-slate-800 shadow-sm transition-all";
        btnTA.className = "flex-1 py-2 text-xs font-bold rounded-lg text-slate-500 hover:text-slate-800 transition-all";
    } else {
        btnTA.className = "flex-1 py-2 text-xs font-bold rounded-lg bg-white text-slate-800 shadow-sm transition-all";
        btnAngkatan.className = "flex-1 py-2 text-xs font-bold rounded-lg text-slate-500 hover:text-slate-800 transition-all";
    }

    renderMonitoringFiltersUI();
    renderAngkatanMonitoring();
}

function renderMonitoringFiltersUI() {
    const container = document.getElementById('monitoring-filters-container');
    if (!container) return;

    const uniqueTA = [...new Set(transaksiData.map(item => item.tahunAkademik))].filter(Boolean).sort().reverse();
    const uniqueAngkatan = [...new Set(mahasiswaMaster.map(item => item.angkatan))].filter(Boolean).sort().reverse();
    const uniqueTingkatan = [...new Set(mahasiswaMaster.map(item => item.tingkatan))].filter(Boolean);

    if (activeMonitoringMode === 'angkatan') {
        container.innerHTML = `
            <div class="flex flex-col sm:flex-row gap-3 w-full">
                <div class="flex-1">
                    <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">Filter Utama: Angkatan</label>
                    <select id="filter-utama-angkatan" onchange="renderCabangTA(); renderAngkatanMonitoring()" class="form-input font-bold text-slate-700">
                        <option value="ALL">Semua Angkatan</option>
                        ${uniqueAngkatan.map(a => `<option value="${a}">Angkatan ${a}</option>`).join('')}
                    </select>
                </div>
                <div class="flex-1" id="cabang-ta-wrapper"></div>
            </div>
        `;
        renderCabangTA();
    } else {
        container.innerHTML = `
            <div class="flex flex-col sm:flex-row gap-3 w-full items-center">
                <div class="flex-1">
                    <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">Filter Utama: Tahun Akademik</label>
                    <select id="filter-utama-ta" onchange="onMainTAChanged()" class="form-input font-bold text-emerald-800 bg-emerald-50 border-emerald-200">
                        ${uniqueTA.map(ta => `<option value="${ta}" ${ta === globalTAAktif ? 'selected' : ''}>TA ${ta}</option>`).join('')}
                    </select>
                </div>
                <div class="flex-1" id="branch-tingkatan-wrapper"></div>
            </div>
        `;
        onMainTAChanged();
    }
}

function renderCabangTA() {
    const angkatanVal = document.getElementById('filter-utama-angkatan').value;
    const wrapper = document.getElementById('cabang-ta-wrapper');
    
    if (angkatanVal === 'ALL') {
        wrapper.innerHTML = `<div class="text-[11px] text-slate-400 italic pt-6"><i class="fa-solid fa-circle-info"></i> Pilih angkatan untuk memunculkan riwayat TA.</div>`;
        return;
    }

    const mhsAngkatanIni = mahasiswaMaster.filter(m => String(m.angkatan) === angkatanVal);
    const nimAngkatanIni = mhsAngkatanIni.map(m => m.nim);
    const txAngkatanIni = transaksiData.filter(tx => nimAngkatanIni.includes(tx.nim));

    let taRelevan = [...new Set(txAngkatanIni.map(item => item.tahunAkademik))].filter(Boolean).sort().reverse();

    if (taRelevan.length === 0) {
        wrapper.innerHTML = `<div class="text-[11px] text-rose-500 italic pt-6 font-semibold"><i class="fa-solid fa-circle-info"></i> Belum ada data transaksi untuk angkatan ini.</div>`;
        return;
    }

    wrapper.innerHTML = `
        <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">Cabang: Pilih TA Riwayat</label>
        <select id="filter-cabang-ta" onchange="renderAngkatanMonitoring()" class="form-input font-bold text-emerald-800 bg-emerald-50 border-emerald-200 shadow-sm cursor-pointer hover:bg-emerald-100 transition">
            ${taRelevan.map(ta => `<option value="${ta}" ${ta === globalTAAktif ? 'selected' : ''}>TA ${ta}</option>`).join('')}
        </select>
    `;
}

function onMainTAChanged() {
    const selectedTA = document.getElementById('filter-utama-ta').value;
    const wrapper = document.getElementById('branch-tingkatan-wrapper');
    if (!wrapper) return;

    if (selectedTA === globalTAAktif) {
        const tahunMulaiTA = parseInt(globalTAAktif.split('/')[0]);
        
        const mhsWajibBayar = mahasiswaMaster.filter(mhs => {
            const tahunMasuk = parseInt(mhs.angkatan) || tahunMulaiTA;
            const statusMhs = String(mhs.status || '').toLowerCase();
            const tingkatanMhs = String(mhs.tingkatan || '').toLowerCase();
            const taCuti = String(mhs.taCuti || '').trim();
            const sedangCuti = (taCuti === globalTAAktif);
            
            let sudahTidakAktif = false;
            
            if (mhs.tahunKeluar && parseInt(mhs.tahunKeluar) < tahunMulaiTA) sudahTidakAktif = true;
            else if (['lulus', 'keluar', 'do', 'pindah', 'non-aktif'].includes(statusMhs)) sudahTidakAktif = true; 
            if (['tamhidi', 'lulus'].includes(tingkatanMhs)) sudahTidakAktif = true;
            
            return (tahunMulaiTA >= tahunMasuk) && !sedangCuti && !sudahTidakAktif;
        });

        const forbiddenOptions = ['tamhidi', 'lulus'];
        const uniqueTingkatan = [...new Set(mhsWajibBayar.map(item => item.tingkatan))]
            .filter(Boolean)
            .filter(t => !forbiddenOptions.includes(String(t).toLowerCase()));
        
        wrapper.innerHTML = `
            <label class="block text-[10px] font-bold text-rose-600 uppercase mb-1"><i class="fa-solid fa-filter"></i> Cabang Aktif: Filter Tingkatan (${globalTAAktif})</label>
            <select id="filter-cabang-tingkatan" onchange="renderAngkatanMonitoring()" class="form-input font-bold text-slate-700">
                <option value="ALL">Semua Tingkatan</option>
                ${uniqueTingkatan.map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
        `;
    } else {
        wrapper.innerHTML = `<div class="text-[11px] text-slate-400 italic pt-4"><i class="fa-solid fa-circle-info"></i> Filter tingkatan disembunyikan (hanya tersedia untuk TA Berjalan: ${globalTAAktif}).</div>`;
    }
    renderAngkatanMonitoring();
}

function renderAngkatanMonitoring() {
    let selectedAngkatan = 'ALL';
    let selectedTA = globalTAAktif;
    let selectedTingkatan = 'ALL';

    if (activeMonitoringMode === 'angkatan') {
        const elAngkatan = document.getElementById('filter-utama-angkatan');
        const elTA = document.getElementById('filter-cabang-ta');
        if (elAngkatan) selectedAngkatan = elAngkatan.value;
        if (selectedAngkatan !== 'ALL' && elTA) selectedTA = elTA.value;
    } else {
        const elTA = document.getElementById('filter-utama-ta');
        const elTingkatan = document.getElementById('filter-cabang-tingkatan');
        if (elTA) selectedTA = elTA.value;
        if (elTingkatan) selectedTingkatan = elTingkatan.value;
    }

    const isModeTAActive = (activeMonitoringMode !== 'angkatan');
    const showTingkatan = isModeTAActive && (selectedTA === globalTAAktif);

    let cohortStudents = mahasiswaMaster;
    
    if (selectedAngkatan !== 'ALL') {
        cohortStudents = cohortStudents.filter(m => String(m.angkatan) === selectedAngkatan);
    }
    
    if (selectedTingkatan && selectedTingkatan !== 'ALL') {
        cohortStudents = cohortStudents.filter(m => m.tingkatan === selectedTingkatan);
    }

    const mappedStudents = cohortStudents.map(mhs => {
        return { ...mhs, summary: getStudentPaymentSummary(mhs.nim, selectedTA) };
    }).filter(mhs => {
        // Ambil tahun awal dari TA yang SEDANG DIPANTAU (bukan TA aktif global)
        const tahunMulaiTA = parseInt(selectedTA.split('/')[0]);
        const tahunMasuk = parseInt(mhs.angkatan) || tahunMulaiTA;
        
        const statusMhs = String(mhs.status || '').toLowerCase();
        const taCuti = String(mhs.taCuti || '').trim();
        const sedangCuti = (taCuti === selectedTA);

        let sudahTidakAktif = false;

        // Logika Statis: Tidak lagi bergantung pada globalTAAktif
        if (mhs.tahunKeluar && parseInt(mhs.tahunKeluar) <= tahunMulaiTA) {
            sudahTidakAktif = true;
        } else if (['lulus', 'keluar', 'do', 'pindah', 'non-aktif'].includes(statusMhs)) {
            // Jika tahunKeluar kosong, gunakan batas absolut masa studi 4 tahun
            if (tahunMulaiTA >= tahunMasuk + 4) sudahTidakAktif = true;
        }

        const wajibBayar = (tahunMulaiTA >= tahunMasuk) && !sedangCuti && !sudahTidakAktif;
        return wajibBayar || mhs.summary.totalDibayar > 0;
    });

    const totalMhs = mappedStudents.length;
    const paidMhs = mappedStudents.filter(m => m.summary.statusOverall === 'LUNAS').length;
    const partialMhs = mappedStudents.filter(m => m.summary.statusOverall === 'DICICIL').length;
    const unpaidMhs = mappedStudents.filter(m => m.summary.statusOverall === 'BELUM_BAYAR').length;

    const totalTerbayarCohort = mappedStudents.reduce((acc, curr) => acc + curr.summary.totalDibayar, 0);
    const totalTunggakanCohort = mappedStudents.reduce((acc, curr) => acc + curr.summary.sisaTagihan, 0);
    const totalTargetCohort = totalMhs * BIAYA_RUSUM_STANDAR;
    const overallPercentage = totalTargetCohort > 0 ? Math.round((totalTerbayarCohort / totalTargetCohort) * 100) : 0;

    document.getElementById('cohort-stat-total').innerText = `${totalMhs} Mhs`;
    document.getElementById('cohort-stat-paid').innerText = `${paidMhs} Lunas, ${partialMhs} Dicicil`;
    document.getElementById('cohort-stat-paid-nominal').innerText = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(totalTerbayarCohort);
    document.getElementById('cohort-stat-unpaid').innerText = `Belum Penuh: ${unpaidMhs + partialMhs} Mhs`;
    document.getElementById('cohort-stat-unpaid-nominal').innerText = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(totalTunggakanCohort);
    
    document.getElementById('cohort-progress-text').innerText = `${overallPercentage}%`;
    document.getElementById('cohort-progress-bar').style.width = `${overallPercentage}%`;
    document.getElementById('cohort-progress-sub').innerText = `${paidMhs} dari ${totalMhs} Lunas`;

    let displayStudents = mappedStudents;
    if (activeAngkatanStatusFilter === 'PAID') displayStudents = mappedStudents.filter(m => m.summary.statusOverall === 'LUNAS');
    else if (activeAngkatanStatusFilter === 'PARTIAL') displayStudents = mappedStudents.filter(m => m.summary.statusOverall === 'DICICIL');
    else if (activeAngkatanStatusFilter === 'UNPAID') displayStudents = mappedStudents.filter(m => m.summary.statusOverall === 'BELUM_BAYAR');
    
    const searchInputEl = document.getElementById('cohort-search-input');
    if (searchInputEl) {
        const query = searchInputEl.value.toLowerCase().trim();
        if (query) {
            displayStudents = displayStudents.filter(m => 
                (m.nama && m.nama.toLowerCase().includes(query)) ||
                (m.nim && String(m.nim).toLowerCase().includes(query))
            );
        }
    }
    document.getElementById('cohort-table-count').innerText = `${displayStudents.length} Data`;

    const tbody = document.getElementById('cohort-table-body');
    if (displayStudents.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">Tidak ada data.</td></tr>`;
        return;
    }

    tbody.innerHTML = displayStudents.map(mhs => {
        const formattedTotal = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(mhs.summary.totalDibayar);
        const formattedSisa = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(mhs.summary.sisaTagihan);

        let statusBadge = mhs.summary.statusOverall === 'LUNAS' ? `<span class="bg-emerald-100 text-emerald-800 px-2 py-1 rounded text-[10px] font-bold">LUNAS</span>` 
            : (mhs.summary.statusOverall === 'DICICIL' ? `<span class="bg-amber-100 text-amber-800 px-2 py-1 rounded text-[10px] font-bold">DICICIL</span>` : `<span class="bg-rose-100 text-rose-800 px-2 py-1 rounded text-[10px] font-bold">BELUM BAYAR</span>`);
        
        return `
            <tr class="hover:bg-slate-50 border-b">
                <td class="p-3 font-medium">
                    <div class="font-bold">${mhs.nama}</div><div class="text-[11px] text-slate-500">${mhs.nim}</div>
                </td>
                <td class="p-3 text-[11px]">
                    ${mhs.prodi}<br>
                    Angkatan ${mhs.angkatan}${showTingkatan ? ` &bull; ${mhs.tingkatan}` : ''}
                </td>
                <td class="p-3 font-bold">${formattedTotal}</td>
                <td class="p-3 font-bold text-rose-700">${formattedSisa}</td>
                <td class="p-3 text-center">${statusBadge}</td>
            </tr>
        `;
    }).join('');
}

function filterAngkatanStatus(status) {
    activeAngkatanStatusFilter = status;
    
    const btnAll = document.getElementById('angkatan-filter-all');
    const btnUnpaid = document.getElementById('angkatan-filter-unpaid');
    const btnPartial = document.getElementById('angkatan-filter-partial');
    const btnPaid = document.getElementById('angkatan-filter-paid');
    
    [btnAll, btnUnpaid, btnPartial, btnPaid].forEach(btn => {
        btn.className = "px-3 py-1.5 rounded-lg text-slate-600";
    });

    if (status === 'ALL') btnAll.className = "px-3 py-1.5 rounded-lg bg-white shadow font-bold text-slate-800";
    else if (status === 'UNPAID') btnUnpaid.className = "px-3 py-1.5 rounded-lg bg-white shadow font-bold text-slate-800";
    else if (status === 'PARTIAL') btnPartial.className = "px-3 py-1.5 rounded-lg bg-white shadow font-bold text-slate-800";
    else if (status === 'PAID') btnPaid.className = "px-3 py-1.5 rounded-lg bg-white shadow font-bold text-slate-800";
    
    renderAngkatanMonitoring();
}

// ==========================================
// MODAL REVIEW & UPDATE KE GOOGLE SHEETS
// ==========================================
function openAdminDetailModal(id) {
    const item = transaksiData.find(d => d.id === id);
    if (!item) return;

    activeReviewItem = item;

    document.getElementById('modal-mhs-nama').innerText = item.nama;
    document.getElementById('modal-mhs-nim').innerText = `NIM: ${item.nim}`;
    document.getElementById('modal-mhs-email').innerText = item.email;
    document.getElementById('modal-mhs-prodi').innerText = item.prodi;
    document.getElementById('modal-mhs-tingkatan').innerText = item.tingkatan;
    
    document.getElementById('modal-mhs-nominal').innerText = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(item.nominal);
    
    document.getElementById('modal-mhs-bank-name').innerText = item.bank || '-';
    document.getElementById('modal-mhs-date-text').innerText = formatTanggalWaktu(item.tanggal);

    const tgl = new Date(item.tanggal);
    if (!isNaN(tgl.getTime())) {
        const yyyy = tgl.getFullYear();
        const mm = String(tgl.getMonth() + 1).padStart(2, '0');
        const dd = String(tgl.getDate()).padStart(2, '0');
        document.getElementById('modal-edit-tanggal').value = `${yyyy}-${mm}-${dd}`;
    }

    document.getElementById('modal-mhs-date-text').classList.remove('hidden');
    document.getElementById('modal-edit-tanggal').classList.add('hidden');

    const summary = getStudentPaymentSummary(item.nim, item.tahunAkademik);
    document.getElementById('modal-mhs-kalkulasi').innerText = `Telah Bayar (TA ${item.tahunAkademik}): ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(summary.totalDibayar)}`;

    let realLink = item.resiUrl || '#';
    let displayUrl = realLink;
    
    const imgEl = document.getElementById('modal-resi-img');
    const pdfViewer = document.getElementById('modal-resi-pdf-viewer');
    const zoomHint = document.getElementById('resi-zoom-hint');
    const zoomContainer = document.getElementById('resi-zoom-container');
    
    // Reset status elemen
    imgEl.classList.add('hidden');
    pdfViewer.classList.add('hidden');
    pdfViewer.removeAttribute('data');
    
    // Deteksi apakah file berekstensi .pdf atau datanya berupa PDF
    const filename = (item.resiFilename || '').toLowerCase();
    const isPdf = filename.endsWith('.pdf') || (displayUrl && displayUrl.toLowerCase().includes('pdf'));
    
    if (isPdf) {
        // TAMPILAN PDF LANGSUNG DI KOTAK
        pdfViewer.classList.remove('hidden');
        pdfViewer.setAttribute('data', realLink); // Berkas PDF langsung dimuat ke dalam kotak
        
        zoomHint.classList.add('hidden');
        zoomContainer.classList.remove('cursor-zoom-in');
    } else {
        const matchDrive = displayUrl.match(/[-\w]{25,}/); // Ekstrak ID File
        if (displayUrl.includes('drive.google.com') && matchDrive) {
            displayUrl = `https://drive.google.com/uc?export=view&id=${matchDrive[0]}`;
        }
        
        imgEl.src = displayUrl;
        imgEl.classList.remove('hidden');
        
        zoomHint.classList.remove('hidden');
        zoomContainer.classList.add('cursor-zoom-in');
    }
    
    selectModalStatus(item.status || 'Pending');
    document.getElementById('modal-review').classList.remove('hidden');
}

function selectModalStatus(status) {
    selectedModalStatus = status;
    const configs = {
        'Pending': { id: 'btn-status-pending', activeClass: 'border-2 border-amber-600 bg-amber-500 text-white' },
        'Disetujui': { id: 'btn-status-disetujui', activeClass: 'border-2 border-emerald-700 bg-emerald-600 text-white' },
        'Ditolak': { id: 'btn-status-ditolak', activeClass: 'border-2 border-rose-700 bg-rose-600 text-white' }
    };
    const defaultClass = "py-2.5 border rounded-xl text-xs font-bold bg-slate-50 text-slate-600";

    ['Pending', 'Disetujui', 'Ditolak'].forEach(key => {
        const btn = document.getElementById(configs[key].id);
        if (btn) btn.className = (key === status) ? `py-2.5 rounded-xl text-xs font-bold ${configs[key].activeClass}` : defaultClass;
    });
    document.getElementById('modal-admin-note').value = defaultStatusNotes[status] || '';
}

function closeModalReview() {
    document.getElementById('modal-review').classList.add('hidden');
    activeReviewItem = null;
}

function toggleEditTanggal() {
    const textEl = document.getElementById('modal-mhs-date-text');
    const inputEl = document.getElementById('modal-edit-tanggal');
    
    if (inputEl.classList.contains('hidden')) {
        textEl.classList.add('hidden');
        inputEl.classList.remove('hidden');
        inputEl.focus();
        try { inputEl.showPicker(); } catch(e) {} 
    } else {
        textEl.classList.remove('hidden');
        inputEl.classList.add('hidden');
    }
}

function applyEditTanggal() {
    const inputEl = document.getElementById('modal-edit-tanggal');
    const textEl = document.getElementById('modal-mhs-date-text');
    
    if (inputEl.value) {
        textEl.innerText = formatTanggalWaktu(inputEl.value);
    }
    toggleEditTanggal();
}

async function prosesVerifikasi(kirimEmail) {
    if (!activeReviewItem) return;

    const item = activeReviewItem;
    const newStatus = selectedModalStatus;
    const newNote = document.getElementById('modal-admin-note').value.trim();
    const newTanggal = document.getElementById('modal-edit-tanggal').value;

    if (kirimEmail) {
        showToast("Memproses", "Menyimpan data dan mengirim email ke mahasiswa...");
    } else {
        showToast("Memproses", "Menyimpan status data lama (Tanpa Email)...");
    }

    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'updateStatusAndEmail', 
                id: item.id,
                status: newStatus,
                adminNote: newNote,
                tanggalBaru: newTanggal, 
                sendEmail: kirimEmail 
            })
        });

        const result = await response.json();

        if (result.success) {
            item.status = newStatus;
            item.adminNote = newNote;
            
            if (newTanggal) {
                item.tanggal = newTanggal;
            }

            updateAdminStats();
            filterAdminTable();

            if (kirimEmail) showToast("Berhasil Selesai!", `Status ${newStatus} disimpan & email telah dikirim.`);
            else showToast("Berhasil Disimpan!", `Status ${newStatus} berhasil disimpan tanpa email.`);
            
            closeModalReview();
        } else {
            showToast("Gagal Menyimpan", result.message || "Data tidak ditemukan di server.");
        }
    } catch (error) {
        showToast("Error Koneksi", "Gagal menghubungi database server.");
    }
}

// ==========================================
// MODAL KWITANSI & PDF
// ==========================================
function openKwitansiPreview(id) {
    const item = transaksiData.find(d => d.id === id);
    if (!item) return;

    activeKwitansiItem = item;
    
    const summary = getStudentPaymentSummary(item.nim, item.tahunAkademik);

    document.getElementById('kwitansi-no').innerText = `KW-STAIIS-${item.id}`;
    document.getElementById('kwitansi-tgl').innerText = `Tanggal Cetak: ${new Date().toLocaleDateString('id-ID')}`;
    document.getElementById('kwitansi-nama').innerText = item.nama;
    document.getElementById('kwitansi-nim').innerText = item.nim;
    document.getElementById('kwitansi-tingkatan').innerText = item.tingkatan;
    document.getElementById('kwitansi-prodi').innerText = item.prodi;

    const formattedNominal = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(item.nominal);
    const formattedTotalDibayar = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(summary.totalDibayar);
    const formattedSisa = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(summary.sisaTagihan);

    document.getElementById('kwitansi-nominal').innerText = formattedNominal + ` (Tagihan TA ${item.tahunAkademik})`;
    document.getElementById('kwitansi-terbilang').innerText = terbilang(item.nominal) + " Rupiah";
    document.getElementById('kwitansi-total-terbayar').innerText = formattedTotalDibayar;
    document.getElementById('kwitansi-sisa').innerText = formattedSisa;

    document.getElementById('modal-kwitansi').classList.remove('hidden');
}

function previewKwitansiFromAdminModal() {
    if (activeReviewItem) openKwitansiPreview(activeReviewItem.id);
}

function closeKwitansiModal() {
    document.getElementById('modal-kwitansi').classList.add('hidden');
    activeKwitansiItem = null;
}

function downloadKwitansiFromModal() {
    if (!activeKwitansiItem) return;
    const element = document.getElementById('kwitansi-print-area');
    html2pdf().set({
        margin: 0.5,
        filename: `Kwitansi_${activeKwitansiItem.nim}_TA${activeKwitansiItem.tahunAkademik.replace('/','-')}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
    }).from(element).save();
    showToast("Mengunduh", "File kwitansi PDF sedang diproses.");
}

// ==========================================
// UTILITIES
// ==========================================
function showToast(title, message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = "bg-slate-900 text-white text-xs p-4 rounded-xl shadow-xl flex items-center space-x-3 pointer-events-auto transition duration-300 transform translate-y-2 opacity-0";
    toast.innerHTML = `
        <div class="w-8 h-8 bg-emerald-800 rounded-lg flex justify-center items-center"><i class="fa-solid fa-bell"></i></div>
        <div><h5 class="font-bold">${title}</h5><p class="text-[11px] text-slate-300">${message}</p></div>
    `;
    container.appendChild(toast);
    setTimeout(() => toast.classList.remove('translate-y-2', 'opacity-0'), 10);
    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function toProperCase(str) {
    return str.toLowerCase().replace(/(?:^|\s)\w/g, function(match) {
        return match.toUpperCase();
    });
}

function formatInputRupiah(input) {
    let value = input.value.replace(/[^0-9]/g, '');
    if (value) {
        input.value = new Intl.NumberFormat('id-ID').format(value);
    } else {
        input.value = '';
    }
}

function terbilang(angka) {
    let nilai = Math.floor(Math.abs(angka));
    if (nilai === 0) return "Nol";

    const proses = (n) => {
        const bil = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan", "Sepuluh", "Sebelas"];
        if (n < 12) return bil[n];
        if (n < 20) return proses(n - 10) + " Belas";
        if (n < 100) return proses(Math.floor(n / 10)) + " Puluh " + proses(n % 10);
        if (n < 200) return "Seratus " + proses(n - 100);
        if (n < 1000) return proses(Math.floor(n / 100)) + " Ratus " + proses(n % 100);
        if (n < 2000) return "Seribu " + proses(n - 1000);
        if (n < 1000000) return proses(Math.floor(n / 1000)) + " Ribu " + proses(n % 1000);
        if (n < 1000000000) return proses(Math.floor(n / 1000000)) + " Juta " + proses(n % 1000000);
        if (n < 1000000000000) return proses(Math.floor(n / 1000000000)) + " Miliar " + proses(n % 1000000000);
        return n.toString();
    };

    return proses(nilai).replace(/\s+/g, ' ').trim();
}

function formatTanggalWaktu(dateString) {
    if (!dateString || dateString === '-') return '-';
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString; 

    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}

// ==========================================
// INIT APLIKASI
// ==========================================
window.onload = function() {
    selectTab('form');
    fetchSpreadsheetData();
    initResiZoomPan();
    
    const inputTA = document.getElementById('input-ta');
    if (inputTA) {
        inputTA.addEventListener('change', checkPreviousInstallments);
    }
};

// ==========================================
// FITUR ZOOM & DRAG-TO-PAN (DESKTOP & MOBILE)
// ==========================================
let isImageZoomed = false;
let isDraggingResi = false;
let startPanX, startPanY, startScrollLeft, startScrollTop;
let hasDraggedResi = false;

function initResiZoomPan() {
    const container = document.getElementById('resi-zoom-container');
    if (!container) return;

    container.addEventListener('click', (e) => {
        if (hasDraggedResi) {
            hasDraggedResi = false; 
            return; 
        }
        
        const img = document.getElementById('modal-resi-img');
        isImageZoomed = !isImageZoomed;
        
        if (isImageZoomed) {
            img.style.transform = 'scale(2.5)';
            container.style.cursor = 'grab'; 
            container.style.overflow = 'auto';
            container.classList.remove('justify-center', 'items-center');
            container.classList.add('no-scrollbar'); 
        } else {
            img.style.transform = 'scale(1)';
            container.style.cursor = 'zoom-in';
            container.style.overflow = 'hidden';
            container.classList.add('justify-center', 'items-center');
            container.classList.remove('no-scrollbar');
            container.scrollTop = 0;
            container.scrollLeft = 0;
        }
    });

    container.addEventListener('mousedown', (e) => {
        if (!isImageZoomed) return; 
        isDraggingResi = true;
        hasDraggedResi = false;
        container.style.cursor = 'grabbing'; 
        
        startPanX = e.pageX - container.offsetLeft;
        startPanY = e.pageY - container.offsetTop;
        startScrollLeft = container.scrollLeft;
        startScrollTop = container.scrollTop;
    });

    container.addEventListener('mousemove', (e) => {
        if (!isDraggingResi || !isImageZoomed) return;
        e.preventDefault(); 

        const x = e.pageX - container.offsetLeft;
        const y = e.pageY - container.offsetTop;
        
        const walkX = (x - startPanX) * 1.5; 
        const walkY = (y - startPanY) * 1.5;

        if (Math.abs(walkX) > 5 || Math.abs(walkY) > 5) {
            hasDraggedResi = true;
        }

        container.scrollLeft = startScrollLeft - walkX;
        container.scrollTop = startScrollTop - walkY;
    });

    const stopPan = () => {
        if (isDraggingResi) {
            isDraggingResi = false;
            if (isImageZoomed) container.style.cursor = 'grab';
        }
    };
    container.addEventListener('mouseup', stopPan);
    container.addEventListener('mouseleave', stopPan);
}
