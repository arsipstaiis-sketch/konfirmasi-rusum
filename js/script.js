// Konfigurasi & Global Variabel
let BIAYA_RUSUM_STANDAR = 6000000;
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzyoXy7Ewl8VK3ApGnDpiinwsWiuesh0wbC6gOWEzDCQGxio7_0JCcfybd4JDjAAVeo/exec'; // URL Google Apps Script Anda

let transaksiData = []; 
let mahasiswaMaster = []; 

let activeTab = 'form';
let activeAdminSubtab = 'verifikasi';
let activeAngkatanStatusFilter = 'ALL';
let activeReviewItem = null;
let activeKwitansiItem = null;
let isAdminLoggedIn = false;
let selectedModalStatus = 'Pending';

const defaultStatusNotes = {
    'Pending': 'Pembayaran sedang dalam proses verifikasi data dan mutasi rekening.',
    'Disetujui': 'Pembayaran setoran angsuran telah diverifikasi sah.',
    'Ditolak': 'Bukti transfer tidak valid atau nominal tidak sesuai ketentuan. Silakan perbaiki dan unggah ulang.'
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
        
        transaksiData = data.transaksi.map(tx => ({
            ...tx,
            nim: String(tx.nim), 
            nominal: Number(tx.nominal)
        })).reverse(); 
        
        mahasiswaMaster = data.mahasiswa.map(m => ({
            ...m,
            nim: String(m.nim)
        }));
        
        showToast("Berhasil", "Data berhasil dimuat dari database Google Sheets.");
        
        if (isAdminLoggedIn) {
            renderAdminDashboard();
        }
    } catch (error) {
        showToast("Error", "Gagal memuat data. Periksa koneksi internet.");
        console.error("Error fetching data:", error);
    }
}

// ==========================================
// LOGIKA KALKULASI & CEK MAHASISWA
// ==========================================
function getStudentPaymentSummary(nim, targetTA = null) {
    let approvedTx = transaksiData.filter(d => d.nim === nim && d.status === 'Disetujui');
    
    // Filter berdasarkan Tahun Akademik Tagihan (Jika ada parameter TA)
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

function checkPreviousInstallments() {
    const nim = document.getElementById('input-nim').value.trim();
    const inputTA = document.getElementById('input-ta');
    const ta = inputTA ? inputTA.value : null; 
    const infoDiv = document.getElementById('nim-installment-info');

    if (!nim) {
        infoDiv.classList.add('hidden');
        return;
    }

    const mhs = mahasiswaMaster.find(m => m.nim === nim);

    if (mhs) {
        // Hanya isi otomatis jika nilainya benar-benar ada di master data 
        // dan hindari mereset pilihan yang sudah dipilih user jika tidak diperlukan
        document.getElementById('input-nama').value = mhs.nama || '';
        
        if (mhs.prodi) {
            document.getElementById('input-prodi').value = mhs.prodi;
        }
        if (mhs.tingkatan) {
            document.getElementById('input-tingkatan').value = mhs.tingkatan;
        }
    }

    if (!ta) return; // Hanya jalankan kalkulasi jika mahasiswa sudah memilih opsi Tagihan TA

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
    if (dropZone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });
        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.add('border-emerald-500', 'bg-emerald-50'), false);
        });
        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('border-emerald-500', 'bg-emerald-50'), false);
        });

        dropZone.addEventListener('drop', handleDrop, false);
        function handleDrop(e) {
            const dt = e.dataTransfer;
            handleFiles(dt.files);
        }
    }
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
        document.getElementById(`tab-content-${t}`).classList.add('hidden');
        document.getElementById(`tab-btn-${t}`).className = "px-4 py-2.5 rounded-xl text-xs font-semibold transition flex items-center space-x-2 text-emerald-100 hover:bg-emerald-800/60";
        document.getElementById(`m-tab-${t}`).className = "flex-1 py-3 text-center text-xs font-semibold text-emerald-200 flex flex-col items-center space-y-1 hover:bg-emerald-900";
    });

    document.getElementById(`tab-content-${tab}`).classList.remove('hidden');
    document.getElementById(`tab-btn-${tab}`).className = "px-4 py-2.5 rounded-xl text-xs font-semibold transition flex items-center space-x-2 bg-emerald-800 text-white shadow-inner";
    document.getElementById(`m-tab-${tab}`).className = "flex-1 py-3 text-center text-xs font-semibold text-emerald-200 flex flex-col items-center space-y-1 bg-emerald-800 text-white";

    if (tab === 'admin' && isAdminLoggedIn) {
        renderAdminDashboard();
    }
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
        showToast("NIM Tidak Valid", "NIM harus 8 digit angka (contoh: 24110412) atau format titik (contoh: 21.1.1.0412).");
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
        document.getElementById('search-status-input').value = '';
        executeStatusSearch(); 
    } catch (error) {
        showToast("Gagal Menyimpan", "Terjadi kesalahan koneksi server.");
    } finally {
        btnSubmit.innerHTML = `<i class="fa-solid fa-paper-plane"></i><span>KIRIM KONFIRMASI PEMBAYARAN</span>`;
        btnSubmit.disabled = false;
    }
}

// ==========================================
// PENCARIAN STATUS
// ==========================================
function executeStatusSearch() {
    const query = document.getElementById('search-status-input').value.trim().toLowerCase();
    const resultsContainer = document.getElementById('search-status-results');

    if (!query) {
        resultsContainer.innerHTML = `<div class="text-center py-12 border-2 border-dashed border-slate-200 rounded-2xl"><h4 class="text-xs font-bold text-slate-700">Ketik NIM Untuk Mencari</h4></div>`;
        return;
    }

    const filtered = transaksiData.filter(d => 
        (d.nim && d.nim.toLowerCase().includes(query)) || 
        (d.nama && d.nama.toLowerCase().includes(query))
    );

    if (filtered.length === 0) {
        resultsContainer.innerHTML = `<div class="text-center py-12 border border-slate-200 bg-slate-50 rounded-2xl"><p class="text-xs font-bold text-slate-700">Data Tidak Ditemukan</p></div>`;
        return;
    }

    const targetNim = filtered[0].nim;
    
    // Cari transaksi terakhir yang disetujui untuk mengetahui TA tagihan yang aktif
    const lastApproved = filtered.find(d => d.status === 'Disetujui');
    const targetTA = lastApproved ? lastApproved.tahunAkademik : filtered[0].tahunAkademik;
    
    const summary = getStudentPaymentSummary(targetNim, targetTA);

    const formattedTotalDibayar = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(summary.totalDibayar);
    const formattedSisa = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(summary.sisaTagihan);

    let html = `
        <div class="bg-emerald-900 text-white rounded-2xl p-6 shadow-md space-y-4">
            <div class="flex justify-between border-b border-emerald-800 pb-4">
                <div>
                    <h3 class="text-lg font-extrabold">${filtered[0].nama} (${filtered[0].nim})</h3>
                    <p class="text-xs text-emerald-200">${filtered[0].prodi} - ${filtered[0].tingkatan}</p>
                </div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div class="bg-white/10 p-3.5 rounded-xl border border-white/10">
                    <span class="text-emerald-200 text-[10px] font-bold uppercase block">Total Disetujui (TA ${targetTA})</span>
                    <span class="text-lg font-black">${formattedTotalDibayar}</span>
                </div>
                <div class="bg-rose-950 p-3.5 rounded-xl border-2 border-rose-500 shadow-inner">
                    <span class="text-rose-300 text-[10px] font-extrabold uppercase block tracking-wider"><i class="fa-solid fa-triangle-exclamation"></i> Sisa Tagihan TA ${targetTA}</span>
                    <span class="text-xl font-black text-white">${formattedSisa}</span>
                </div>
            </div>
        </div>
        <h4 class="text-xs font-bold text-slate-700 uppercase pt-2">Riwayat Transaksi</h4>
    `;

    html += filtered.map((item, index) => {
        const formattedNominal = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(item.nominal || 0);
        let badge = item.status === 'Disetujui' ? 'bg-emerald-100 text-emerald-800' : (item.status === 'Ditolak' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800');
        let cleanDate = item.tanggal ? item.tanggal.split('T')[0] : '-';
        let btn = item.status === 'Disetujui' ? `<button onclick="openKwitansiPreview('${item.id}')" class="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-900 text-white rounded-xl text-xs font-bold shadow-sm flex items-center space-x-1.5"><i class="fa-solid fa-receipt"></i><span>Cetak Kwitansi</span></button>` : '';

        return `
            <div class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3 text-xs">
                <div class="flex justify-between items-center border-b border-slate-100 pb-2.5">
                    <div class="flex items-center space-x-2">
                        <span class="font-mono text-[11px] font-bold text-slate-400">#${filtered.length - index}</span>
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

    resultsContainer.innerHTML = html;
}

// ==========================================
// ADMIN DASHBOARD
// ==========================================
function loginAdmin() {
    const pin = document.getElementById('admin-pin-input').value.trim();
    if (pin === '1234') {
        isAdminLoggedIn = true;
        renderAdminDashboard();
        showToast("Login Berhasil", "Selamat datang di Panel Admin Keuangan.");
    } else {
        showToast("PIN Salah", "Gunakan PIN 1234 untuk login demo admin.");
    }
}

function loginAdminDemo() {
    document.getElementById('admin-pin-input').value = '1234';
    loginAdmin();
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
    const total = transaksiData.length;
    const pending = transaksiData.filter(d => d.status === 'Pending').length;
    const disetujui = transaksiData.filter(d => d.status === 'Disetujui').length;
    const ditolak = transaksiData.filter(d => d.status === 'Ditolak').length;

    const totalPenerimaan = transaksiData
        .filter(d => d.status === 'Disetujui')
        .reduce((acc, curr) => acc + (Number(curr.nominal) || 0), 0);

    document.getElementById('admin-stat-total').innerText = total;
    document.getElementById('admin-stat-pending').innerText = pending;
    document.getElementById('admin-stat-disetujui').innerText = disetujui;
    document.getElementById('admin-stat-ditolak').innerText = ditolak;

    const formattedPenerimaan = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(totalPenerimaan);
    document.getElementById('admin-stat-penerimaan').innerText = formattedPenerimaan;
}

function filterAdminTable() {
    const search = document.getElementById('admin-filter-search').value.toLowerCase();
    const statusFilter = document.getElementById('admin-filter-status').value;

    const filtered = transaksiData.filter(d => {
        const matchSearch = (d.nama && d.nama.toLowerCase().includes(search)) || (d.nim && d.nim.toLowerCase().includes(search));
        const matchStatus = statusFilter === 'ALL' || d.status === statusFilter;
        return matchSearch && matchStatus;
    });

    const tbody = document.getElementById('admin-table-body');
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400">Tidak ada data yang sesuai.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(item => {
        let badge = item.status === 'Disetujui' ? 'bg-emerald-100 text-emerald-800' : (item.status === 'Ditolak' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800');
        const formattedNominal = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(item.nominal || 0);

        return `
            <tr class="hover:bg-slate-50 transition border-b">
                <td class="p-3.5 font-medium">
                    <div class="font-bold text-slate-800">${item.nama}</div>
                    <div class="text-[11px] text-slate-500 font-mono">${item.nim}</div>
                </td>
                <td class="p-3.5">${item.prodi}<br><span class="text-[10px] text-emerald-700 font-bold">${item.tingkatan}</span></td>
                <td class="p-3.5 font-bold text-emerald-800">${formattedNominal}<br><span class="text-[10px] text-slate-500 font-normal">TA ${item.tahunAkademik}</span></td>
                <td class="p-3.5">${item.bank}<br><span class="text-[10px] text-slate-400">${item.tanggal}</span></td>
                <td class="p-3.5 text-center"><span class="px-2 py-0.5 rounded font-bold text-[10px] ${badge}">${item.status}</span></td>
                <td class="p-3.5 text-center">
                    <button onclick="openAdminDetailModal('${item.id}')" class="px-3 py-1.5 bg-emerald-800 text-white rounded-lg text-xs font-semibold">Tinjau</button>
                </td>
            </tr>
        `;
    }).join('');
}

// ==========================================
// PEMANTAUAN ANGKATAN (3 FILTER PINTAR)
// ==========================================
function renderAngkatanMonitoring() {
    const selectedAngkatan = document.getElementById('angkatan-select').value;
    const selectedTingkatan = document.getElementById('tingkatan-select').value;
    const selectedTA = document.getElementById('ta-select').value;

    let cohortStudents = mahasiswaMaster;
    
    // 1. Filter Angkatan (Tahun Masuk)
    if (selectedAngkatan !== 'ALL') {
        cohortStudents = cohortStudents.filter(m => String(m.angkatan) === selectedAngkatan);
    }
    
    // 2. Filter Tingkatan (Ula, Tsaniyah, dll)
    if (selectedTingkatan !== 'ALL') {
        cohortStudents = cohortStudents.filter(m => m.tingkatan === selectedTingkatan);
    }

    // 3. Kalkulasi berdasarkan TA Tagihan
    const mappedStudents = cohortStudents.map(mhs => {
        return { ...mhs, summary: getStudentPaymentSummary(mhs.nim, selectedTA) };
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
                <td class="p-3 text-[11px]">${mhs.prodi}<br>Angkatan ${mhs.angkatan} &bull; ${mhs.tingkatan}</td>
                <td class="p-3 font-bold">${formattedTotal}</td>
                <td class="p-3 font-bold text-rose-700">${formattedSisa}</td>
                <td class="p-3 text-center">${statusBadge}</td>
            </tr>
        `;
    }).join('');
}

function filterAngkatanStatus(status) {
    activeAngkatanStatusFilter = status;
    
    // Perbarui visual tombol status
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
    document.getElementById('modal-mhs-bank').innerText = `${item.bank} (${item.tanggal})`;

    // Kalkulasi Khusus sesuai TA pada form
    const summary = getStudentPaymentSummary(item.nim, item.tahunAkademik);
    document.getElementById('modal-mhs-kalkulasi').innerText = `Telah Bayar (TA ${item.tahunAkademik}): ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(summary.totalDibayar)}`;

    let displayUrl = item.resiUrl || '';
    let realLink = item.resiUrl || '#';
    
    // Jika linknya dari Google Drive, kita ekstrak ID-nya agar bisa ditampilkan sebagai gambar
    if (displayUrl.includes('drive.google.com/file/d/')) {
        const match = displayUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (match) {
            displayUrl = `https://drive.google.com/uc?export=view&id=${match[1]}`;
        }
    }

    // Menampilkan gambar dan memastikan link saat diklik terbuka dengan benar
    document.getElementById('modal-resi-img').src = displayUrl;
    document.getElementById('modal-resi-link').href = realLink;

    selectModalStatus(item.status || 'Pending');
    document.getElementById('modal-review').classList.remove('hidden');
}

function selectModalStatus(status) {
    selectedModalStatus = status;
    const btnPending = document.getElementById('btn-status-pending');
    const btnDisetujui = document.getElementById('btn-status-disetujui');
    const btnDitolak = document.getElementById('btn-status-ditolak');

    btnPending.className = "py-2.5 border rounded-xl text-xs font-bold bg-slate-50 text-slate-600";
    btnDisetujui.className = "py-2.5 border rounded-xl text-xs font-bold bg-slate-50 text-slate-600";
    btnDitolak.className = "py-2.5 border rounded-xl text-xs font-bold bg-slate-50 text-slate-600";

    if (status === 'Pending') btnPending.className = "py-2.5 border-2 border-amber-600 rounded-xl text-xs font-bold bg-amber-500 text-white";
    else if (status === 'Disetujui') btnDisetujui.className = "py-2.5 border-2 border-emerald-700 rounded-xl text-xs font-bold bg-emerald-600 text-white";
    else if (status === 'Ditolak') btnDitolak.className = "py-2.5 border-2 border-rose-700 rounded-xl text-xs font-bold bg-rose-600 text-white";

    document.getElementById('modal-admin-note').value = defaultStatusNotes[status] || '';
}

function closeModalReview() {
    document.getElementById('modal-review').classList.add('hidden');
    activeReviewItem = null;
}

// UPDATE STATUS KE GOOGLE SHEETS & EMAIL
async function sendEmailNotificationFromModal() {
    if (!activeReviewItem) return;

    const item = activeReviewItem;
    const newStatus = selectedModalStatus;
    const newNote = document.getElementById('modal-admin-note').value.trim();

    showToast("Menyimpan", "Menyinkronkan data verifikasi ke database server...");

    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'updateStatus',
                id: item.id,
                status: newStatus,
                adminNote: newNote
            })
        });

        // Update Lokal UI
        item.status = newStatus;
        item.adminNote = newNote;

        updateAdminStats();
        filterAdminTable();

        showToast("Berhasil", `Status diperbarui ke ${newStatus}.`);
        closeModalReview();

        // LOGIKA PENGIRIMAN EMAIL YANG LEBIH AMAN (Mencegah Tab Kosong/Undefined)
        const targetEmail = item.email;
        
        if (targetEmail && targetEmail !== 'undefined' && targetEmail.trim() !== '') {
            let subject = `[STAIIS] Verifikasi Setoran Rusum - ${item.nim}`;
            let bodyText = `Status pembayaran anda (Untuk Tagihan TA ${item.tahunAkademik}) saat ini adalah: ${newStatus}.\n\nCatatan Admin: ${newNote}`;
            
            // Membuat elemen link tak terlihat untuk memicu aplikasi email bawaan
            const mailtoLink = `mailto:${targetEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
            const linkElement = document.createElement('a');
            linkElement.href = mailtoLink;
            document.body.appendChild(linkElement); // Tempelkan ke HTML
            linkElement.click(); // Klik otomatis
            document.body.removeChild(linkElement); // Bersihkan kembali
        } else {
            showToast("Info", "Tersimpan, namun alamat email mahasiswa tidak ditemukan.");
        }
        
    } catch (error) {
        showToast("Gagal Menyimpan", "Gagal menghubungi database server.");
    }
}

// ==========================================
// MODAL KWITANSI & PDF
// ==========================================
function openKwitansiPreview(id) {
    const item = transaksiData.find(d => d.id === id);
    if (!item) return;

    activeKwitansiItem = item;
    
    // Kalkulasi Spesifik untuk TA dari Transaksi Tersebut
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
    const bil = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan", "Sepuluh", "Sebelas"];
    let n = Math.floor(angka);
    if (n < 12) return bil[n];
    if (n < 20) return terbilang(n - 10) + " Belas";
    if (n < 100) return terbilang(Math.floor(n / 10)) + " Puluh " + terbilang(n % 10);
    if (n < 1000) return "Seratus " + terbilang(n - 100);
    if (n < 2000) return "Seribu " + terbilang(n - 1000);
    if (n < 1000000) return terbilang(Math.floor(n / 1000)) + " Ribu " + terbilang(n % 1000);
    if (n < 1000000000) return terbilang(Math.floor(n / 1000000)) + " Juta " + terbilang(n % 1000000);
    return n.toString();
}

// ==========================================
// INIT APLIKASI
// ==========================================
window.onload = function() {
    selectTab('form');
    fetchSpreadsheetData(); 
    
    // Memicu pengecekan ulang histori saat mahasiswa memilih opsi Tagihan TA
    const inputTA = document.getElementById('input-ta');
    if (inputTA) {
        inputTA.addEventListener('change', checkPreviousInstallments);
    }
};
// Tambahkan fungsi ini di script.js
async function sendKwitansiToEmail() {
    if (!activeKwitansiItem) {
        showToast("Error", "Pilih data kwitansi terlebih dahulu.");
        return;
    }

    const item = activeKwitansiItem;
    
    // Ganti teks tombol atau tampilkan loading jika perlu
    showToast("Memproses", "Sedang mengirim rincian kwitansi ke email...");

    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'sendKwitansiEmail',
                id: item.id
            })
        });

        const result = await response.json();
        
        if (result.success) {
            showToast("Berhasil", "Email kwitansi telah terkirim ke mahasiswa!");
        } else {
            showToast("Gagal", result.message);
        }
    } catch (error) {
        showToast("Error Koneksi", "Gagal terhubung ke server untuk mengirim email.");
    }
}
