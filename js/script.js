// ==========================================
// KONFIGURASI & GLOBAL VARIABEL
// ==========================================
let BIAYA_RUSUM_STANDAR = 6000000;
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby2qMXWIgDxBFqZ_oaBpKrnXXphnDATfP0V-qfApPHeV7HTTcgQfb3IPq5YutXEm5Ug/exec'; // URL Google Apps Script Anda

let transaksiData = []; 
let mahasiswaMaster = []; 
let currentFilteredCohort = [];
let activeTab = 'form';
let activeAdminSubtab = 'verifikasi';
let activeAngkatanStatusFilter = 'ALL';
let activeReviewItem = null;
let activeKwitansiItem = null;
let isAdminLoggedIn = false;
let selectedModalStatus = 'Pending';
let activeMonitoringMode = 'angkatan'; // 'angkatan' atau 'ta'
let globalTAAktif = '2025/2026'; // Default, nanti ditimpa dari Spreadsheet
let activeVerifikasiStatusFilter = 'Pending';
let pengajuanData = [];
let payloadSuratTertunda = null;
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
// FUNGSI FETCH GOOGLE SHEETS (ULTRA SAFE)
// ==========================================
async function fetchSpreadsheetData() {
    try {
        showToast("Memuat Data", "Sedang menghubungkan ke database server...");
        const response = await fetch(SCRIPT_URL + "?action=getData");
        const data = await response.json();
        
        // Cek dan set Biaya Rusum
        if (data.biayaRusum) {
            BIAYA_RUSUM_STANDAR = Number(data.biayaRusum);
        }
        
        // Cek dan set TA Aktif
        if (data.taAktif) {
            globalTAAktif = String(data.taAktif).trim();
            const badgeTA = document.getElementById('display-ta-aktif');
            if (badgeTA) badgeTA.innerText = globalTAAktif;
        }
        
        // PEMBERSIHAN DATA TRANSAKSI DENGAN AMAN
        const rawTransaksi = data.transaksi || [];
        transaksiData = rawTransaksi.map(tx => {
            let obj = { ...tx }; 
            
            // Bersihkan spasi berlebih
            Object.keys(obj).forEach(key => {
                if (typeof obj[key] === 'string') {
                    obj[key] = obj[key].trim();
                }
            });
            
            obj.nim = String(obj.nim || '').replace(/\s+/g, ''); 
            obj.nominal = Number(obj.nominal || 0);
            return obj;
        }).filter(tx => tx.nim !== '').reverse(); 
        
        // PEMBERSIHAN DATA MAHASISWA MASTER DENGAN AMAN
        const rawMahasiswa = data.mahasiswa || [];
        mahasiswaMaster = rawMahasiswa.map(m => {
            let obj = { ...m };
            
            Object.keys(obj).forEach(key => {
                if (typeof obj[key] === 'string') {
                    obj[key] = obj[key].trim();
                }
            });
            
            obj.nim = String(obj.nim || '').replace(/\s+/g, '');
            // Amankan nama dari tanda kutip tunggal agar HTML tidak rusak
            obj.nama = String(obj.nama || '').replace(/'/g, '’'); 
            
            return obj;
        }).filter(m => m.nim !== ''); 
        
        showToast("Berhasil", "Data berhasil dimuat secara penuh.");
        populateAdminTAFilter();
        if (isAdminLoggedIn) {
            renderAdminDashboard();
        }
        // Di dalam fetchSpreadsheetData() setelah data mahasiswaMaster:
        if (data.pengajuan) {
            pengajuanData = data.pengajuan.map(p => ({
                ...p,
                nim: String(p.nim)
            })).reverse(); // Balik agar yang terbaru di atas
        }
    } catch (error) {
        console.error("DETAIL ERROR FETCH:", error); 
        showToast("Error", "Gagal memuat data. Periksa konsol (F12).");
    }
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
    const mhs = mahasiswaMaster.find(m => m.nim === nim);
    
    // Ambil array tagihanWajib dari backend
    const tagihan = mhs ? (mhs.tagihanWajib || []) : [];
    const taCutiStr = mhs ? String(mhs.taCuti || '').trim() : '';

    // Jika filter spesifik TA, tapi TA tersebut TIDAK ADA di array tagihan wajib
    if (targetTA !== 'ALL' && !tagihan.includes(targetTA)) {
        if (taCutiStr.includes(targetTA)) {
            return { totalDibayar, sisaTagihan: 0, percentPaid: 100, statusOverall: 'CUTI', approvedCount: approvedTx.length, ta: targetTA };
        }
    }

    // PENYESUAIAN MULTIPLIER UNTUK 'SEMUA TA'
    let targetNominal = BIAYA_RUSUM_STANDAR;
    
    if (targetTA === 'ALL' && mhs) {
        // Kalikan standar rusum dengan JUMLAH elemen di array tagihan wajib (Tahun Kewajiban Murni)
        const totalTAs = Math.max(1, tagihan.length);
        targetNominal = BIAYA_RUSUM_STANDAR * totalTAs;
    }

    // Kalkulasi Normal untuk Mahasiswa Aktif / Tinggal Kelas / Semua TA
    const sisaTagihan = Math.max(0, targetNominal - totalDibayar);
    const percentPaid = Math.min(100, Math.round((totalDibayar / targetNominal) * 100));

    let statusOverall = 'BELUM_BAYAR';
    if (totalDibayar >= targetNominal) {
        statusOverall = 'LUNAS';
    } else if (totalDibayar > 0) {
        statusOverall = 'DICICIL';
    }

    return { totalDibayar, sisaTagihan, percentPaid, statusOverall, approvedCount: approvedTx.length, ta: targetTA };
}

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

    if (!nim || !ta) {
        infoDiv.classList.add('hidden');
        return;
    }

    const summary = getStudentPaymentSummary(nim, ta);

    if (summary.totalDibayar > 0 || summary.statusOverall === 'CUTI') {
        infoDiv.classList.remove('hidden');
        const formattedDibayar = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(summary.totalDibayar);
        const formattedSisa = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(summary.sisaTagihan);

        if (summary.statusOverall === 'CUTI') {
            infoDiv.innerHTML = `<p class="font-bold text-slate-600"><i class="fa-solid fa-bed"></i> Status Mahasiswa: CUTI (Bebas Tagihan TA ${ta})</p>`;
        } else if (summary.statusOverall === 'LUNAS') {
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
// DRAG & DROP FILE HANDLER
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
// FORM SUBMIT
// ==========================================
async function handleFormSubmit(e) {
    e.preventDefault();
    const btnSubmit = document.getElementById('btn-submit-form');
    btnSubmit.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>MENGIRIM KE SERVER...</span>`;
    btnSubmit.disabled = true;

    const nim = document.getElementById('input-nim').value.trim();
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
        document.getElementById('search-status-input').value = nim; 
        executeStatusSearch(); 
    } catch (error) {
        showToast("Gagal Menyimpan", "Terjadi kesalahan koneksi server.");
    } finally {
        btnSubmit.innerHTML = `<i class="fa-solid fa-paper-plane"></i><span>KIRIM KONFIRMASI PEMBAYARAN</span>`;
        btnSubmit.disabled = false;
    }
}

// ==========================================
// PENCARIAN STATUS & DROPDOWN TA
// ==========================================
function updateStatusTADisplay(ta, nim, totalTAs = 1) {
    const studentTx = transaksiData.filter(d => d.nim === nim);
    let filteredTx = studentTx;
    
    let totalDibayar = 0;
    let sisaTagihan = 0;
    
    let labelDisetujui = 'Total Disetujui';
    let labelSisa = 'Sisa Tagihan';

    // Ambil data mahasiswa untuk cek kewajiban bayar
    const student = mahasiswaMaster.find(m => m.nim === nim);
    let isWajibBayar = true;
    
    if (student && student.tagihanWajib && ta !== 'ALL') {
        isWajibBayar = student.tagihanWajib.includes(ta);
    }

    if (ta === 'ALL') {
        const approvedTx = studentTx.filter(d => d.status === 'Disetujui');
        totalDibayar = approvedTx.reduce((acc, curr) => acc + (Number(curr.nominal) || 0), 0);
        
        // LOGIKA BARU: Hitung total tagihan keseluruhan berdasarkan array tagihanWajib dari backend
        let totalKewajibanKeseluruhan = totalTAs * BIAYA_RUSUM_STANDAR;
        if (student && student.tagihanWajib) {
            totalKewajibanKeseluruhan = student.tagihanWajib.length * BIAYA_RUSUM_STANDAR;
        }
        
        sisaTagihan = Math.max(0, totalKewajibanKeseluruhan - totalDibayar);
        labelDisetujui = 'Total Disetujui (Semua TA)';
        labelSisa = 'Total Sisa (Keseluruhan)';
    } else {
        filteredTx = studentTx.filter(d => d.tahunAkademik === ta);
        const summary = getStudentPaymentSummary(nim, ta);
        totalDibayar = summary.totalDibayar;
        
        // LOGIKA BARU: Jika tidak wajib bayar di TA spesifik ini, hilangkan sisa tagihannya
        if (!isWajibBayar) {
            sisaTagihan = 0;
        } else {
            sisaTagihan = summary.sisaTagihan;
        }
    }

    const formattedTotal = formatRp(totalDibayar);
    const formattedSisa = formatRp(sisaTagihan);
    
    const isLunas = sisaTagihan <= 0;
    const boxColor = isLunas ? 'bg-emerald-800/80 border-emerald-500' : 'bg-rose-950 border-rose-500';
    const textColor = isLunas ? 'text-emerald-300' : 'text-rose-300';
    const iconSign = isLunas ? '<i class="fa-solid fa-check-circle"></i>' : '<i class="fa-solid fa-triangle-exclamation"></i>';

    // CETAK KOTAK KALKULASI
    const calcContainer = document.getElementById('status-calculation-box');
    if (calcContainer) {
        // Jika tidak wajib bayar DAN belum ada pembayaran sama sekali di TA tersebut (TA Spesifik)
        if (!isWajibBayar && totalDibayar === 0 && ta !== 'ALL') {
            calcContainer.innerHTML = `
                <div class="col-span-1 sm:col-span-2 bg-emerald-950/40 p-4 rounded-xl border border-emerald-800/60 text-center flex flex-col items-center justify-center">
                    <span class="text-emerald-300 text-sm font-bold block mb-1"><i class="fa-solid fa-circle-check"></i> Bebas Tagihan</span>
                    <span class="text-emerald-100/70 text-xs block">Mahasiswa ini tidak memiliki kewajiban pembayaran Rusum pada TA ${ta} (Status Keluar/Cuti).</span>
                </div>
            `;
        } else {
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
    }

    // CETAK DAFTAR RIWAYAT TRANSAKSI
    const historyContainer = document.getElementById('status-history-list');
    if (historyContainer) {
        if (filteredTx.length === 0) {
            historyContainer.innerHTML = `<div class="text-center py-6 text-slate-400 text-xs italic">Belum ada riwayat transaksi ${ta !== 'ALL' ? 'di TA ini' : ''}.</div>`;
        } else {
            historyContainer.innerHTML = filteredTx.map((item, index) => {
                let btn = item.status === 'Disetujui' ? `<button onclick="openKwitansiPreview('${item.id}')" class="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-900 text-white rounded-xl text-xs font-bold shadow-sm flex items-center space-x-1.5"><i class="fa-solid fa-receipt"></i><span>Cetak Kwitansi</span></button>` : '';
                return `
                    <div class="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3 text-xs mt-3">
                        <div class="flex justify-between items-center border-b border-slate-100 pb-2.5">
                            <div class="flex items-center space-x-2">
                                <span class="font-mono text-[11px] font-bold text-slate-400">#${filteredTx.length - index}</span>
                                <span class="font-extrabold text-slate-800">${item.id}</span>
                                <span class="text-slate-300">|</span>
                                <span class="text-slate-600 font-medium">${formatRp(item.nominal)} <span class="text-[10px] text-slate-400 font-normal">(TA ${item.tahunAkademik})</span></span>
                            </div>
                            <span class="px-2.5 py-0.5 rounded-lg text-[11px] font-bold ${getBadge(item.status)}">${item.status}</span>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-600 text-[11px]">
                            <div><b class="text-slate-400">Bank & Tgl:</b> ${item.bank || '-'} (${formatTanggalWaktu(item.tanggal)})</div>
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
// ==========================================
// FITUR DOWNLOAD REKAPITULASI (PRINT BROWSER)
// ==========================================
function downloadRekapPDF(nim) {
    showToast("Memproses Dokumen", "Menyiapkan data rekapitulasi untuk dicetak...");
    const student = mahasiswaMaster.find(m => m.nim === nim);
    if (!student) return;

    // Tentukan Tahun Awal TA Aktif saat ini
    const tahunAktifStart = parseInt(globalTAAktif.split('/')[0]);
    let taWajibList = [];

    // Filter hanya TA wajib yang tahun awalnya <= tahun aktif berjalan
    if (student.tagihanWajib) {
        taWajibList = student.tagihanWajib.filter(ta => parseInt(ta.split('/')[0]) <= tahunAktifStart);
    } else {
        // Fallback jika tidak ada properti tagihanWajib
        const angkatan = parseInt(student.angkatan) || tahunAktifStart;
        let maxTahun = tahunAktifStart;
        const statusMhs = String(student.status || '').toUpperCase();
        if (['LULUS', 'KELUAR', 'DO', 'PINDAH'].includes(statusMhs) && student.tahunKeluar) {
            maxTahun = Math.min(tahunAktifStart, parseInt(student.tahunKeluar));
        }
        for (let y = angkatan; y <= maxTahun; y++) {
            taWajibList.push(`${y}/${y+1}`);
        }
    }

    // Ambil transaksi yang disetujui, dan HANYA yang ada dalam daftar TA Wajib
    const txSetuju = transaksiData.filter(d => d.nim === nim && d.status === 'Disetujui' && taWajibList.includes(d.tahunAkademik));

    // Kalkulasi Total
    const totalWajib = taWajibList.length * BIAYA_RUSUM_STANDAR;
    const totalBayar = txSetuju.reduce((acc, curr) => acc + (Number(curr.nominal) || 0), 0);
    const sisa = Math.max(0, totalWajib - totalBayar);

    // Isi Data ke HTML Tersembunyi
    document.getElementById('rekap-tgl-cetak').innerText = `Dicetak: ${formatTanggalWaktu(new Date().toISOString())}`;
    document.getElementById('rekap-nama').innerText = student.nama;
    document.getElementById('rekap-nim').innerText = student.nim;
    document.getElementById('rekap-prodi').innerText = student.prodi;
    
    let statusText = String(student.status || 'Aktif').toUpperCase();
    if (['LULUS', 'KELUAR', 'DO'].includes(statusText) && student.tahunKeluar) statusText += ` (${student.tahunKeluar})`;
    document.getElementById('rekap-status').innerText = statusText;

    document.getElementById('rekap-total-wajib').innerText = formatRp(totalWajib);
    document.getElementById('rekap-total-bayar').innerText = formatRp(totalBayar);
    document.getElementById('rekap-sisa').innerText = formatRp(sisa);

    const tbody = document.getElementById('rekap-table-body');
    if (txSetuju.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center p-4 italic text-slate-500 border border-slate-300">Belum ada data pembayaran yang disetujui.</td></tr>`;
    } else {
        tbody.innerHTML = txSetuju.map(tx => `
            <tr>
                <td class="border border-slate-300 p-2 font-mono text-[10px]">${tx.id}</td>
                <td class="border border-slate-300 p-2">${formatTanggalWaktu(tx.tanggal)}</td>
                <td class="border border-slate-300 p-2 text-center">${tx.tahunAkademik}</td>
                <td class="border border-slate-300 p-2 text-right font-medium">${formatRp(tx.nominal)}</td>
            </tr>
        `).join('');
    }

    // ==========================================
    // LOGIKA CETAK BAWAAN BROWSER (LEBIH RINGKAS)
    // ==========================================
    const rekapContainer = document.getElementById('rekap-pdf-container');
    const suratContainer = document.getElementById('surat-bebas-container');

    // Pastikan surat disembunyikan, rekap ditampilkan
    if(suratContainer) suratContainer.classList.add('hidden');
    rekapContainer.classList.remove('hidden');

    setTimeout(() => {
        window.print();
        rekapContainer.classList.add('hidden'); // Sembunyikan kembali
    }, 300);
} // Penutup fungsi downloadRekapPDF
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
    const studentEmail = (student && student.email) ? student.email : (studentTx.length > 0 ? studentTx[0].email : '');
    
    // --- LOGIKA: TAMPILKAN STATUS KELUAR & TAHUN ---
    let studentTingkatan = student ? student.tingkatan : (studentTx[0].tingkatan || '-');
    if (student) {
        const statusMhs = String(student.status || '').toUpperCase();
        if (['LULUS', 'KELUAR', 'DO', 'PINDAH'].includes(statusMhs)) {
            const tahunKeluar = student.tahunKeluar ? ` ${student.tahunKeluar}` : '';
            studentTingkatan += ` <span class="text-rose-300 font-bold italic text-[10px] ml-1">(${statusMhs}${tahunKeluar})</span>`;
        }
    }

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

    // --- LOGIKA PENGAJUAN SURAT (Dihitung di awal sebelum render HTML) ---
    const dataPengajuanMhs = typeof pengajuanData !== 'undefined' ? pengajuanData.find(p => String(p.nim || p.NIM) === targetNim) : null;
    let areaPengajuan = '';

    if (dataPengajuanMhs) {
        let statusWarna = dataPengajuanMhs.Status === 'Diterbitkan' ? 'text-emerald-700 bg-emerald-100 border-emerald-200' : 'text-amber-700 bg-amber-100 border-amber-200';
        let iconStatus = dataPengajuanMhs.Status === 'Diterbitkan' ? '<i class="fa-solid fa-check-circle"></i>' : '<i class="fa-solid fa-clock"></i>';
        
        areaPengajuan = `
            <div class="mt-4 mb-2 p-4 bg-white border border-slate-200 rounded-xl text-xs space-y-3 shadow-sm">
                <h4 class="font-bold text-slate-700 uppercase border-b border-slate-100 pb-2"><i class="fa-solid fa-file-contract mr-1 text-emerald-600"></i> Status Surat Bebas Tanggungan</h4>
                
                <div class="flex justify-between items-center">
                    <span class="text-slate-500 font-medium">Tanggal Pengajuan:</span>
                    <span class="font-bold text-slate-800">${dataPengajuanMhs.Tanggal}</span>
                </div>
                
                <div class="flex justify-between items-center">
                    <span class="text-slate-500 font-medium">Status Saat Ini:</span>
                    <span class="px-2 py-1 rounded-md font-extrabold text-[10px] uppercase border ${statusWarna}">${iconStatus} ${dataPengajuanMhs.Status}</span>
                </div>
                
                <div class="pt-2 border-t border-slate-100 mt-2">
                    ${dataPengajuanMhs.Status === 'Diterbitkan' 
                        ? `<p class="text-[11px] text-emerald-700"><i class="fa-solid fa-envelope-circle-check mr-1"></i> Surat telah diterbitkan dan dikirim ke email: <b>${dataPengajuanMhs.Email}</b></p>` 
                        : `<p class="text-[11px] text-amber-700 italic"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Admin sedang meninjau pengajuan Anda. Surat akan dikirim ke <b>${dataPengajuanMhs.Email}</b> jika disetujui.</p>`}
                </div>
            </div>
        `;
    } else {
        areaPengajuan = `
            <div class="mt-4 mb-2 p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-3 shadow-sm">
                <div>
                    <h4 class="text-xs font-extrabold text-emerald-900 uppercase mb-1"><i class="fa-solid fa-envelope-open-text mr-1"></i> Ajukan Surat Bebas Tanggungan</h4>
                    <p class="text-[10px] text-emerald-700 font-medium">Ketik email aktif Anda di bawah ini untuk menerima file PDF surat jika disetujui admin.</p>
                </div>
                <div>
                    <input type="email" id="input-email-pengajuan" value="${studentEmail}" placeholder="Contoh: nama@gmail.com" class="w-full px-3 py-2 border border-emerald-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none shadow-inner bg-white text-emerald-900 font-medium">
                </div>
                <button onclick="ajukanSuratBebas('${targetNim}', '${studentName}')" class="w-full py-2 bg-emerald-800 hover:bg-emerald-900 text-white rounded-lg text-xs font-bold transition shadow-sm flex items-center justify-center space-x-2">
                    <i class="fa-solid fa-paper-plane"></i> <span>Kirim Pengajuan</span>
                </button>
            </div>
        `;
    }

    // BENTUK KERANGKA HTML
    let html = `
        <div class="bg-emerald-900 text-white rounded-2xl p-6 shadow-md space-y-4">
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-emerald-800 pb-4 gap-4 sm:gap-0">
                <div>
                    <h3 class="text-lg font-extrabold">${studentName} (${targetNim})</h3>
                    <p class="text-xs text-emerald-200 flex items-center">${studentProdi} - ${studentTingkatan}</p>
                </div>

                <!-- TOMBOL REKAP & DROPDOWN TA -->
                <div class="flex items-center space-x-2 shrink-0 mt-4 sm:mt-0">
                    <button onclick="downloadRekapPDF('${targetNim}')" class="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-700 border border-emerald-600 text-white text-[11px] font-bold rounded-xl transition shadow-sm flex items-center space-x-1.5">
                        <i class="fa-solid fa-file-pdf"></i><span class="hidden sm:inline">Unduh Rekap</span>
                    </button>
                    <div class="relative flex items-center group">
                        <div class="absolute left-3 pointer-events-none transition group-hover:text-emerald-300 text-emerald-500"><i class="fa-regular fa-calendar-days text-[11px]"></i></div>
                        <select onchange="updateStatusTADisplay(this.value, '${targetNim}',${listTA.length})" class="appearance-none bg-emerald-950/50 border border-emerald-700/60 text-emerald-100 text-[11px] font-bold rounded-xl pl-8 pr-8 py-1.5 focus:outline-none focus:border-emerald-400 hover:border-emerald-500 cursor-pointer shadow-sm transition w-full">
                            <option value="ALL" class="bg-emerald-900">Semua TA</option>
                            ${listTA.map(ta => `<option value="${ta}" ${ta === initialTA ? 'selected' : ''} class="bg-emerald-900">${ta}</option>`).join('')}
                        </select>
                        <div class="absolute right-3 pointer-events-none transition group-hover:text-emerald-300 text-emerald-500"><i class="fa-solid fa-chevron-down text-[9px]"></i></div>
                    </div>
                </div>
            </div>
            
            <!-- KOTAK KALKULASI -->
            <div id="status-calculation-box" class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs"></div>
        </div>
        
        <!-- AREA PENGAJUAN (DISUNTIKKAN SEBELUM RIWAYAT TRANSAKSI) -->
        ${areaPengajuan}
        
        <h4 class="text-xs font-bold text-slate-700 uppercase pt-4 pb-1 border-b border-slate-200">Riwayat Transaksi</h4>
        
        <!-- DAFTAR RIWAYAT TRANSAKSI -->
        <div id="status-history-list"></div>
    `;

    resultsContainer.innerHTML = html;
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
    
    // Daftar semua tab yang ada
    const tabs = ['verifikasi', 'angkatan', 'pengajuan'];
    
    tabs.forEach(t => {
        const btn = document.getElementById(`admin-subtab-${t}`);
        const view = document.getElementById(`admin-view-${t}`);
        
        // Cek jika ID elemennya ada untuk mencegah error
        if (btn && view) {
            if (t === subtab) {
                // Style untuk tab yang sedang aktif
                btn.className = "flex-1 py-2.5 px-4 rounded-xl text-xs font-bold bg-white text-emerald-900 shadow-sm flex items-center justify-center space-x-2 min-w-max";
                view.classList.remove('hidden');
            } else {
                // Style untuk tab yang tidak aktif
                btn.className = "flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-slate-600 flex items-center justify-center space-x-2 min-w-max hover:bg-white/50";
                view.classList.add('hidden');
            }
        }
    });

    // Jalankan fungsi render sesuai tab yang dibuka
    if (subtab === 'verifikasi') filterAdminTable();
    else if (subtab === 'angkatan') renderAngkatanMonitoring();
    else if (subtab === 'pengajuan') renderTablePengajuan();
}
function renderAdminDashboard() {
    document.getElementById('admin-login-card').classList.add('hidden');
    document.getElementById('admin-dashboard').classList.remove('hidden');
    if (activeAdminSubtab === 'verifikasi') {
        updateAdminStats();
        // Pastikan tombol tab dan tabel langsung memfilter data Pending saat login
        filterVerifikasiStatus(activeVerifikasiStatusFilter); 
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
            <option value="ALL">Semua TA (Akumulasi)</option>
            ${taRelevan.map(ta => `<option value="${ta}" ${ta === globalTAAktif ? 'selected' : ''}>TA ${ta}</option>`).join('')}
        </select>
    `;
}

function onMainTAChanged() {
    const selectedTA = document.getElementById('filter-utama-ta').value;
    const wrapper = document.getElementById('branch-tingkatan-wrapper');
    if (!wrapper) return;

    if (selectedTA === globalTAAktif) {
        const mhsWajibBayar = mahasiswaMaster.filter(mhs => {
            const tagihan = mhs.tagihanWajib || [];
            return tagihan.includes(globalTAAktif);
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
    const activeTAForLogic = selectedTA === 'ALL' ? globalTAAktif : selectedTA;

    let cohortStudents = mahasiswaMaster;
    
    if (selectedAngkatan !== 'ALL') {
        cohortStudents = cohortStudents.filter(m => String(m.angkatan) === selectedAngkatan);
    }
    
    if (selectedTingkatan && selectedTingkatan !== 'ALL') {
        cohortStudents = cohortStudents.filter(m => m.tingkatan === selectedTingkatan);
    }

    const mappedStudents = cohortStudents.map(mhs => {
        return { 
            ...mhs, 
            summary: getStudentPaymentSummary(mhs.nim, selectedTA) 
        };
    }).filter(mhs => {
        const tagihan = mhs.tagihanWajib || []; 
        const taCutiStr = String(mhs.taCuti || '').trim();

        // Jika filter Semua TA, tampilkan asal mahasiswa pernah ditagih atau cuti
        if (selectedTA === 'ALL') return tagihan.length > 0 || taCutiStr !== '';

        // Tampilkan mahasiswa di layar JIKA TA yang dipilih ada di array tagihan wajib ATAU array cuti
        const wajibDiTAIni = tagihan.includes(activeTAForLogic);
        const cutiDiTAIni = taCutiStr.includes(activeTAForLogic);

        return wajibDiTAIni || cutiDiTAIni;
    });

    const totalMhs = mappedStudents.length;
    
    // Wajib bayar MURNI (Hanya yang TA-nya terdaftar di array tagihanWajib dari backend)
    const wajibBayarMhs = mappedStudents.filter(m => (m.tagihanWajib || []).includes(activeTAForLogic)).length;

    const paidMhs = mappedStudents.filter(m => m.summary.statusOverall === 'LUNAS').length;
    const partialMhs = mappedStudents.filter(m => m.summary.statusOverall === 'DICICIL').length;
    const unpaidMhs = mappedStudents.filter(m => m.summary.statusOverall === 'BELUM_BAYAR').length;

    const totalTerbayarCohort = mappedStudents.reduce((acc, curr) => acc + curr.summary.totalDibayar, 0);
    const totalTunggakanCohort = mappedStudents.reduce((acc, curr) => acc + curr.summary.sisaTagihan, 0);
    
    // PENYESUAIAN TARGET UNTUK 'SEMUA TA'
    const totalTargetCohort = selectedTA === 'ALL' 
        ? (totalTerbayarCohort + totalTunggakanCohort) 
        : (wajibBayarMhs * BIAYA_RUSUM_STANDAR);
    
    const overallPercentage = totalTargetCohort > 0 ? Math.round((totalTerbayarCohort / totalTargetCohort) * 100) : 0;

    document.getElementById('cohort-stat-total').innerText = `${totalMhs} Mhs`;
    document.getElementById('cohort-stat-paid').innerText = `${paidMhs} Lunas, ${partialMhs} Dicicil`;
    document.getElementById('cohort-stat-paid-nominal').innerText = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(totalTerbayarCohort);
    document.getElementById('cohort-stat-unpaid').innerText = `Belum Penuh: ${unpaidMhs + partialMhs} Mhs`;
    document.getElementById('cohort-stat-unpaid-nominal').innerText = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(totalTunggakanCohort);
    
    document.getElementById('cohort-progress-text').innerText = `${overallPercentage}%`;
    document.getElementById('cohort-progress-bar').style.width = `${overallPercentage}%`;
    document.getElementById('cohort-progress-sub').innerText = `${paidMhs} dari ${selectedTA === 'ALL' ? totalMhs : wajibBayarMhs} Wajib Bayar`;

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
    
    currentFilteredCohort = displayStudents;
    document.getElementById('cohort-table-count').innerText = `${displayStudents.length} Data`;

    const tbody = document.getElementById('cohort-table-body');
    if (displayStudents.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">Tidak ada data.</td></tr>`;
        return;
    }

    tbody.innerHTML = displayStudents.map(mhs => {
            const formattedTotal = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(mhs.summary.totalDibayar);
            const formattedSisa = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(mhs.summary.sisaTagihan);

            let statusBadge = '';
            let btnSuratBebas = ''; // Variabel untuk menyimpan tombol Surat Bebas

            if (mhs.summary.statusOverall === 'LUNAS') {
                statusBadge = `<span class="bg-emerald-100 text-emerald-800 px-2 py-1 rounded text-[10px] font-bold">LUNAS</span>`;
                // Tombol hanya di-render jika statusnya LUNAS
                btnSuratBebas = `
                    <button onclick="cetakSuratBebas('${mhs.nim}')" title="Cetak Surat Bebas Tanggungan" class="w-8 h-8 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-800 transition shadow-sm inline-flex items-center justify-center">
                        <i class="fa-solid fa-file-contract"></i>
                    </button>
                `;
            }
            else if (mhs.summary.statusOverall === 'DICICIL') statusBadge = `<span class="bg-amber-100 text-amber-800 px-2 py-1 rounded text-[10px] font-bold">DICICIL</span>`;
            else if (mhs.summary.statusOverall === 'CUTI') statusBadge = `<span class="bg-slate-200 text-slate-600 px-2 py-1 rounded text-[10px] font-bold">CUTI (BEBAS TAGIHAN)</span>`;
            else statusBadge = `<span class="bg-rose-100 text-rose-800 px-2 py-1 rounded text-[10px] font-bold">BELUM BAYAR</span>`;
            
            return `
                <tr class="hover:bg-slate-50 border-b">
                    <td class="p-3 font-medium">
                        <div class="font-bold">${mhs.nama}</div><div class="text-[11px] text-slate-500">${mhs.nim}</div>
                    </td>
                    <td class="p-3 text-[11px]">
                        ${mhs.prodi}<br>Angkatan ${mhs.angkatan}${showTingkatan ? ` &bull; ${mhs.tingkatan}` : ''}
                    </td>
                    <td class="p-3 font-bold">${formattedTotal}</td>
                    <td class="p-3 font-bold text-rose-700">${formattedSisa}</td>
                    <td class="p-3 text-center">${statusBadge}</td>
                    <td class="p-3 text-center">
                        <!-- Gunakan flexbox agar tombol Rekap & Surat Bebas sejajar -->
                        <div class="flex items-center justify-center space-x-1.5">
                            <button onclick="downloadRekapPDF('${mhs.nim}')" title="Unduh Rekap PDF" class="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-emerald-800 transition shadow-sm inline-flex items-center justify-center">
                                <i class="fa-solid fa-file-pdf"></i>
                            </button>
                            ${btnSuratBebas}
                        </div>
                    </td>
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

    let displayUrl = item.resiUrl || '#';
    const iframeEl = document.getElementById('modal-resi-iframe');
    const loadingEl = document.getElementById('resi-loading');
    
    iframeEl.classList.add('hidden');
    loadingEl.classList.remove('hidden');

    const matchDrive = displayUrl.match(/[-\w]{25,}/);
    if (displayUrl.includes('drive.google.com') && matchDrive) {
        displayUrl = `https://drive.google.com/file/d/${matchDrive[0]}/preview`;
    }

    iframeEl.src = displayUrl;
    iframeEl.onload = () => {
        loadingEl.classList.add('hidden');
        iframeEl.classList.remove('hidden');
    };
    
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
// FUNGSI LAYAR PENUH (FULLSCREEN RESI)
// ==========================================
function openFullScreenResi() {
    const currentIframe = document.getElementById('modal-resi-iframe');
    const fsIframe = document.getElementById('fullscreen-resi-iframe');
    
    if (currentIframe && currentIframe.src) {
        fsIframe.src = currentIframe.src;
        const modalFs = document.getElementById('modal-fullscreen-resi');
        modalFs.classList.remove('hidden');
        modalFs.classList.add('flex');
    }
}

function closeFullScreenResi() {
    const modalFs = document.getElementById('modal-fullscreen-resi');
    modalFs.classList.add('hidden');
    modalFs.classList.remove('flex');
    document.getElementById('fullscreen-resi-iframe').src = ''; 
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

// ==========================================
// EKSPOR LAPORAN PDF (PEMANTAUAN ANGKATAN)
// ==========================================
function exportPemantauanPDF() {
    if (currentFilteredCohort.length === 0) {
        showToast("Kosong", "Tidak ada data untuk diekspor.");
        return;
    }

    if (typeof window.jspdf === 'undefined') {
        showToast("Error", "Library pembuat PDF belum termuat.");
        return;
    }

    showToast("Memproses", "Sedang membuat dokumen PDF...");

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4'); // Landscape

    let filterTA = activeMonitoringMode === 'ta' 
        ? document.getElementById('filter-utama-ta').value 
        : (document.getElementById('filter-cabang-ta') ? document.getElementById('filter-cabang-ta').value : 'Semua TA');
        
    let filterKategori = activeMonitoringMode === 'angkatan'
        ? "Angkatan " + document.getElementById('filter-utama-angkatan').value
        : "Tingkat " + (document.getElementById('filter-cabang-tingkatan') ? document.getElementById('filter-cabang-tingkatan').value : 'Semua');
        
    let statusText = activeAngkatanStatusFilter === 'ALL' ? 'Semua Status' : activeAngkatanStatusFilter;

    const totalDibayarAll = currentFilteredCohort.reduce((sum, mhs) => sum + mhs.summary.totalDibayar, 0);
    const totalSisaAll = currentFilteredCohort.reduce((sum, mhs) => sum + mhs.summary.sisaTagihan, 0);
    const formatRp = (num) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(num);

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text("LAPORAN PEMANTAUAN KEUANGAN RUSUM - STAIIS", 14, 16);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text("Waktu Cetak", 14, 24);    doc.text(`: ${new Date().toLocaleString('id-ID')}`, 42, 24);
    doc.text("Tahun Akademik", 14, 29); doc.text(`: ${filterTA}`, 42, 29);
    doc.text("Kategori Filter", 14, 34);doc.text(`: ${filterKategori}`, 42, 34);
    doc.text("Status Bayar", 14, 39);   doc.text(`: ${statusText}`, 42, 39);

    doc.autoTable({
        startY: 44,
        body: [
            ['Total Akumulasi Terbayar', ':', formatRp(totalDibayarAll), 'Total Sisa Tagihan', ':', formatRp(totalSisaAll)]
        ],
        theme: 'plain',
        styles: { fontSize: 9, fontStyle: 'bold', cellPadding: 1 },
        columnStyles: {
            0: { cellWidth: 40 },
            1: { cellWidth: 5, halign: 'center' },
            2: { cellWidth: 40, textColor: [6, 95, 70] },
            3: { cellWidth: 35 },
            4: { cellWidth: 5, halign: 'center' },
            5: { textColor: [159, 18, 57] }
        }
    });

    let startYMainTable = doc.lastAutoTable.finalY + 4; 

    const tableColumns = [['No', 'NIM', 'Nama Mahasiswa', 'Prodi', 'Angkatan - Tingkat', 'Total Terbayar', 'Sisa Tagihan', 'Status']];
    const tableRows = currentFilteredCohort.map((mhs, index) => {
        let teksStatus = mhs.summary.statusOverall;
        if (teksStatus === 'BELUM_BAYAR') teksStatus = 'Belum Bayar';
        if (teksStatus === 'CUTI') teksStatus = 'Cuti (Bebas Tagihan)';
        return [
            index + 1, mhs.nim, mhs.nama, mhs.prodi, `${mhs.angkatan} - ${mhs.tingkatan}`,
            formatRp(mhs.summary.totalDibayar), formatRp(mhs.summary.sisaTagihan), teksStatus
        ];
    });

    const totalPagesExp = '{total_pages_count_string}';

    doc.autoTable({
        startY: startYMainTable, 
        head: tableColumns,
        body: tableRows,
        theme: 'grid',
        headStyles: { fillColor: [6, 95, 70], textColor: 255, halign: 'center' },
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: {
            0: { halign: 'center', cellWidth: 10 },
            1: { halign: 'center', cellWidth: 25 },
            4: { halign: 'center' },
            5: { halign: 'right' },
            6: { halign: 'right', textColor: [159, 18, 57] },
            7: { halign: 'center', fontStyle: 'bold' }
        },
        didDrawPage: function (data) {
            let pageString = 'Halaman ' + doc.internal.getNumberOfPages() + ' dari ' + totalPagesExp;
            doc.setFontSize(8);
            doc.setFont('helvetica', 'italic');
            doc.text(pageString, data.settings.margin.left, doc.internal.pageSize.height - 10);
        }
    });

    if (typeof doc.putTotalPages === 'function') {
        doc.putTotalPages(totalPagesExp);
    }

    const safeDate = new Date().toISOString().slice(0,10);
    doc.save(`Rekap_Keuangan_STAIIS_${safeDate}.pdf`);
    
    setTimeout(() => { showToast("Selesai", "File laporan PDF berhasil diunduh."); }, 1000);
}

// ==========================================
// POPULATE DROPDOWN TA ADMIN VERIFIKASI
// ==========================================
function populateAdminTAFilter() {
    const selectEl = document.getElementById('filter-ta-admin');
    if (!selectEl) return;
    
    const currentValue = selectEl.value;
    const uniqueTA = [...new Set(transaksiData.map(item => item.tahunAkademik))].filter(Boolean).sort().reverse();
    
    selectEl.innerHTML = `
        <option value="Semua">Semua TA</option>
        ${uniqueTA.map(ta => `<option value="${ta}">${ta}</option>`).join('')}
    `;
    
    if (uniqueTA.includes(currentValue) || currentValue === 'Semua') {
        selectEl.value = currentValue;
    }
}
// ==========================================
// FITUR CETAK SURAT BEBAS TANGGUNGAN
// ==========================================
function cetakSuratBebas(nim) {
    const student = mahasiswaMaster.find(m => m.nim === nim);
    if (!student) return;

    // 1. Validasi Kelayakan (Wajib Lunas Secara Keseluruhan)
    const summary = getStudentPaymentSummary(nim, 'ALL');
    if (summary.statusOverall !== 'LUNAS') {
        showToast("Akses Ditolak", "Mahasiswa belum melunasi seluruh tanggungan keuangan.");
        return;
    }

    showToast("Menyiapkan Surat", "Menyusun Surat Keterangan Bebas Tanggungan...");

    // 2. Logic Penomoran Otomatis (Berdasarkan urutan mahasiswa Lunas di database)
    const lunasStudents = mahasiswaMaster
        .filter(m => getStudentPaymentSummary(m.nim, 'ALL').statusOverall === 'LUNAS')
        .sort((a, b) => a.nim.localeCompare(b.nim)); // Urutkan berdasarkan NIM
    
    // Cari urutan mahasiswa ini di daftar lunas, lalu pad dengan angka 0 di depan
    const urutan = lunasStudents.findIndex(m => m.nim === nim) + 1;
    const noUrut = String(urutan).padStart(3, '0');

    // 3. Waktu & Tanggal Dinamis
    const now = new Date();
    const romawiBulan = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"][now.getMonth()];
    const tahun2Digit = String(now.getFullYear()).slice(-2);
    const namaBulan = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    const tanggalSurat = `${now.getDate()} ${namaBulan[now.getMonth()]} ${now.getFullYear()}`;

    // 4. Injeksi Data ke HTML
    document.getElementById('surat-no').innerText = `No. ${noUrut}/Ket-SKet/STAIIS/${romawiBulan}/${tahun2Digit}`;
    document.getElementById('surat-nama').innerText = student.nama;
    document.getElementById('surat-nim').innerText = student.nim;
    document.getElementById('surat-prodi').innerText = student.prodi;
    document.getElementById('surat-tgl').innerText = `Cianjur, ${tanggalSurat}`;

    // 5. Eksekusi Print Bawaan Browser
    const headerEl = document.querySelector('header');
    const mainEl = document.querySelector('main');
    const toastEl = document.getElementById('toast-container');
    const suratContainer = document.getElementById('surat-bebas-container');
    const rekapContainer = document.getElementById('rekap-pdf-container'); // TAMBAHAN INI

    // Sembunyikan UI & Rekapitulasi secara tegas
    if (headerEl) headerEl.classList.add('hidden');
    if (mainEl) mainEl.classList.add('hidden');
    if (toastEl) toastEl.classList.add('hidden');
    if (rekapContainer) rekapContainer.classList.add('hidden'); // TAMBAHAN INI
    
    // Tampilkan hanya Surat Keterangan
    suratContainer.classList.remove('hidden');

    setTimeout(() => {
        window.print();

        // Kembalikan UI setelah selesai
        if (headerEl) headerEl.classList.remove('hidden');
        if (mainEl) mainEl.classList.remove('hidden');
        if (toastEl) toastEl.classList.remove('hidden');
        suratContainer.classList.add('hidden');
        
        showToast("Selesai", "Proses cetak dokumen telah ditutup.");
    }, 400);
}
// ==========================================
// FITUR PENGAJUAN SURAT BEBAS (MAHASISWA & ADMIN)
// ==========================================

async function ajukanSuratBebas(nim, nama) {
    const inputEmail = document.getElementById('input-email-pengajuan');
    if (!inputEmail) return;

    const emailValid = inputEmail.value.trim();
    
    // Validasi kosong
    if (!emailValid) {
        showToast("Email Kosong", "Silakan ketikkan email Anda terlebih dahulu.");
        inputEmail.focus();
        return;
    }

    // Validasi format email sederhana
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValid)) {
        showToast("Format Salah", "Masukkan format email yang benar (contoh: nama@gmail.com).");
        inputEmail.focus();
        return;
    }
    
    showToast("Mengirim...", "Sedang memproses pengajuan surat Anda ke server.");
    
    const now = new Date();
    const newId = `SBT-${Math.floor(1000 + Math.random() * 9000)}`;
    const newTanggal = `${now.getDate()}-${now.getMonth()+1}-${now.getFullYear()}`;
    
    const payload = {
        action: 'ajukanSurat',
        id: newId,
        nim: nim,
        nama: nama,
        email: emailValid,
        tanggal: newTanggal
    };

    try {
        await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
        
        // Simpan data secara lokal agar UI langsung berubah tanpa perlu refresh halaman
        if (typeof pengajuanData !== 'undefined') {
            pengajuanData.unshift({
                ID: newId,
                NIM: nim,
                nim: nim, 
                Nama: nama,
                Email: emailValid,
                Tanggal: newTanggal,
                Status: 'Menunggu'
            });
        }
        
        showToast("Berhasil", "Pengajuan berhasil dikirim. Silakan pantau status Anda.");
        executeStatusSearch(); // Refresh tampilan panel pencarian
    } catch (e) {
        showToast("Error", "Gagal menghubungi server untuk mengirim pengajuan.");
    }
}
// ==========================================
// FUNGSI ADMIN PENGAJUAN (SUDAH DIPERBARUI DENGAN FITUR TOLAK & CATATAN)
// ==========================================

function renderTablePengajuan() {
    const tbody = document.getElementById('pengajuan-table-body');
    if (!tbody) return;

    if (!pengajuanData || pengajuanData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-400 text-xs">Belum ada data pengajuan surat.</td></tr>`;
        return;
    }

    tbody.innerHTML = pengajuanData.map(item => {
        let badge = item.Status === 'Diterbitkan' ? 'bg-emerald-100 text-emerald-800' : (item.Status === 'Ditolak' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800');
        
        let btnAksi = (item.Status === 'Diterbitkan' || item.Status === 'Ditolak') 
            ? `<span class="text-[10px] text-slate-400 italic">Selesai</span>`
            : `
              <div class="flex justify-center items-center space-x-1.5">
                  <button onclick="bukaModalRekapPengajuan('${item.NIM}')" class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-bold transition shadow-sm" title="Cek Rekap Tunggakan"><i class="fa-solid fa-file-invoice-dollar"></i></button>
                  <button onclick="bukaModalTerbitSurat('${item.ID}', '${item.NIM}', '${item.Email}')" class="px-2.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-[10px] font-bold transition shadow-sm"><i class="fa-solid fa-pen-to-square"></i> Proses</button>
              </div>
              `;

        return `
            <tr class="hover:bg-slate-50 border-b">
                <td class="p-3">
                    <div class="font-bold text-slate-800">${item.Nama}</div>
                    <div class="text-[11px] text-slate-500 font-mono mt-0.5">${item.NIM}</div>
                </td>
                <td class="p-3 text-xs text-slate-600">${item.Tanggal}</td>
                <td class="p-3 text-center"><span class="px-2.5 py-1 rounded-lg text-[10px] font-bold ${badge}">${item.Status}</span></td>
                <td class="p-3 text-[10px] text-slate-500 italic max-w-xs break-words">${item.Catatan || '-'}</td>
                <td class="p-3 text-center">${btnAksi}</td>
            </tr>
        `;
    }).join('');
}

function bukaModalTerbitSurat(id, nim, email) {
    document.getElementById('terbit-id-pengajuan').value = id;
    document.getElementById('terbit-nim-mhs').value = nim;
    document.getElementById('terbit-email-mhs').innerText = email;
    
    // Reset Modal Default ke opsi Terbitkan
    document.getElementById('terbit-keputusan').value = 'Diterbitkan';
    toggleCatatanPengajuan('Diterbitkan');
    
    document.getElementById('modal-terbit-surat').classList.remove('hidden');
}

function toggleCatatanPengajuan(keputusan) {
    const wadahCatatan = document.getElementById('wadah-catatan-terbit');
    const infoTerbit = document.getElementById('info-terbit-surat');
    const txtCatatan = document.getElementById('terbit-catatan');
    
    if (keputusan === 'Ditolak') {
        wadahCatatan.classList.remove('hidden');
        infoTerbit.classList.add('hidden');
        txtCatatan.value = ''; // Wajib diisi admin saat menolak
    } else {
        wadahCatatan.classList.add('hidden');
        infoTerbit.classList.remove('hidden');
        txtCatatan.value = ''; // Dikosongkan karena disetujui
    }
}

// Helper: Menyusun HTML Rekap Jika Ditolak
function generateHTMLRekapTunggakan(nim) {
    const student = mahasiswaMaster.find(m => m.nim === nim);
    const tahunMulaiTA = parseInt(globalTAAktif.split('/')[0]);
    
    // LOGIKA TAGIHAN WAJIB
    let taWajibList = [];
    if (student.tagihanWajib) {
        taWajibList = student.tagihanWajib.filter(ta => parseInt(ta.split('/')[0]) <= tahunMulaiTA);
    } else {
        // Fallback jika array tagihanWajib tidak tersedia
        const startYear = parseInt(student.angkatan) || tahunMulaiTA;
        let batasAtas = tahunMulaiTA;
        if (student.tahunKeluar && parseInt(student.tahunKeluar) <= tahunMulaiTA) batasAtas = parseInt(student.tahunKeluar);
        for (let y = startYear; y <= batasAtas; y++) {
            taWajibList.push(`${y}/${y+1}`);
        }
    }

    let html = `
        <table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-family: Arial, sans-serif; font-size: 12px;">
            <tr style="background-color: #f1f5f9;">
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Tahun Akademik</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Dibayar</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: right; color: #be123c;">Sisa Tunggakan</th>
            </tr>
    `;

    let totalTunggakan = 0;
    
    // Looping hanya pada TA yang wajib saja
    taWajibList.forEach(ta => {
        let sum = getStudentPaymentSummary(nim, ta);
        
        // Abaikan jika sedang cuti dan belum ada pembayaran di TA tersebut
        if (String(student.taCuti || '').trim() === ta && sum.totalDibayar === 0) return;

        totalTunggakan += sum.sisaTagihan;
        html += `
            <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">${ta}</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">${formatRp(sum.totalDibayar)}</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: right; color: ${sum.sisaTagihan > 0 ? '#be123c' : '#15803d'}; font-weight: bold;">${formatRp(sum.sisaTagihan)}</td>
            </tr>
        `;
    });
    
    html += `
            <tr>
                <td colspan="2" style="padding: 8px; border: 1px solid #ddd; text-align: right; font-weight: bold;">TOTAL KESELURUHAN TUNGGAKAN</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: right; font-weight: bold; font-size: 14px; color: #be123c;">${formatRp(totalTunggakan)}</td>
            </tr>
        </table>
    `;
    return html;
}

function bukaModalRekapPengajuan(nim) {
    const student = mahasiswaMaster.find(m => m.nim === nim);
    if(!student) return showToast("Error", "Data mahasiswa tidak ditemukan.");

    const tahunMulaiTA = parseInt(globalTAAktif.split('/')[0]);
    
    // LOGIKA TAGIHAN WAJIB
    let taWajibList = [];
    if (student.tagihanWajib) {
        taWajibList = student.tagihanWajib.filter(ta => parseInt(ta.split('/')[0]) <= tahunMulaiTA);
    } else {
        // Fallback jika array tagihanWajib tidak tersedia
        const startYear = parseInt(student.angkatan) || tahunMulaiTA;
        let batasAtas = tahunMulaiTA;

        if (student.tahunKeluar && parseInt(student.tahunKeluar) <= tahunMulaiTA) {
            batasAtas = parseInt(student.tahunKeluar);
        } else if (['lulus', 'keluar', 'do', 'pindah', 'non-aktif'].includes(String(student.status).toLowerCase())) {
            batasAtas = startYear + 3; 
            if (batasAtas > tahunMulaiTA) batasAtas = tahunMulaiTA;
        }
        for (let y = startYear; y <= batasAtas; y++) {
            taWajibList.push(`${y}/${y+1}`);
        }
    }

    let rekapHtml = '';
    let totalSeluruhTunggakan = 0;

    // Looping hanya pada TA yang wajib saja
    taWajibList.forEach(ta => {
        let sum = getStudentPaymentSummary(nim, ta);
        
        // Lewati jika sedang cuti dan belum bayar sepeser pun
        if (String(student.taCuti || '').trim() === ta && sum.totalDibayar === 0) return;

        totalSeluruhTunggakan += sum.sisaTagihan;
        let statusColor = sum.sisaTagihan <= 0 ? 'text-emerald-600' : 'text-rose-600';
        let icon = sum.sisaTagihan <= 0 ? '<i class="fa-solid fa-check-circle"></i> Lunas' : '<i class="fa-solid fa-triangle-exclamation"></i> Sisa';

        rekapHtml += `
            <div class="flex justify-between items-center py-2.5 border-b border-slate-100 last:border-0">
                <span class="text-xs font-bold text-slate-700">TA ${ta}</span>
                <div class="text-right">
                    <div class="text-xs font-bold text-slate-800">${formatRp(sum.totalDibayar)}</div>
                    <div class="text-[10px] ${statusColor}">${icon} ${formatRp(sum.sisaTagihan)}</div>
                </div>
            </div>
        `;
    });

    document.getElementById('rekap-mhs-nama').innerText = student.nama;
    document.getElementById('rekap-mhs-nim').innerText = student.nim;
    document.getElementById('rekap-total-tunggakan').innerText = formatRp(totalSeluruhTunggakan);
    document.getElementById('rekap-list-ta').innerHTML = rekapHtml || '<p class="text-xs text-slate-400 italic py-2">Tidak ada data tagihan wajib untuk ditampilkan.</p>';
    document.getElementById('modal-rekap-pengajuan').classList.remove('hidden');
}
function tutupModalRekapPengajuan() {
    document.getElementById('modal-rekap-pengajuan').classList.add('hidden');
}
// ==============================================================================
// 1. FUNGSI RENDER (HANYA MEMBUAT PDF & MENAMPILKAN PREVIEW, TANPA MENGIRIM)
// ==============================================================================
async function prosesPengajuanSuratAdmin() {
    const id = document.getElementById('terbit-id-pengajuan').value;
    const nim = document.getElementById('terbit-nim-mhs').value;
    const keputusan = document.getElementById('terbit-keputusan').value;
    const catatan = document.getElementById('terbit-catatan').value.trim();
    const btnProses = document.getElementById('btn-proses-terbit');
    
    if (keputusan === 'Ditolak' && catatan === '') {
        showToast("Catatan Wajib", "Harap isi alasan penolakan!");
        return;
    }

    const student = mahasiswaMaster.find(m => m.nim === nim);
    const itemPengajuan = pengajuanData.find(p => p.ID === id);
    if (!student || !itemPengajuan) return;

    btnProses.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Memproses Data...</span>`;
    btnProses.disabled = true;

    let payload = {
        action: 'prosesPengajuanSurat',
        id: id,
        nim: nim,
        nama: student.nama,
        email: itemPengajuan.Email,
        status: keputusan,
        catatanAdmin: catatan
    };

    try {
        if (keputusan === 'Diterbitkan') {
            
            // 1. SIAPKAN DATA FORMAT NOMOR & TANGGAL
            const now = new Date();
            const romawiBulan = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"][now.getMonth()];
            const indexData = pengajuanData.findIndex(p => p.ID === id);
            const nomorUrutAsli = pengajuanData.length - indexData; 
            const nomorFormat = String(nomorUrutAsli).padStart(3, '0');
            
            const nomorSuratStr = `No. ${nomorFormat}/Ket-SKet/STAIIS/${romawiBulan}/${String(now.getFullYear()).slice(-2)}`;
            const tanggalStr = `Cianjur, ${now.getDate()} ${["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"][now.getMonth()]} ${now.getFullYear()}`;

            // 2. UPDATE ELEMEN HTML (Agar pratinjau di layar admin terlihat terisi)
            document.getElementById('surat-no').innerText = nomorSuratStr;
            document.getElementById('surat-nama').innerText = student.nama;
            document.getElementById('surat-nim').innerText = student.nim;
            document.getElementById('surat-prodi').innerText = student.prodi;
            document.getElementById('surat-tgl').innerText = tanggalStr;

            // 3. BUAT PREVIEW VISUAL CEPAT DENGAN HTML
            const suratContainer = document.getElementById('surat-bebas-container');
            const suratClone = suratContainer.cloneNode(true);
            
            // Amankan gambar agar absolut (opsional, khusus untuk preview browser)
            const images = suratClone.getElementsByTagName('img');
            for (let i = 0; i < images.length; i++) {
                images[i].setAttribute('src', images[i].src); 
            }
            
            const isiSuratHTML = `
                <!DOCTYPE html>
                <html>
                <head>
                    <script src="https://cdn.tailwindcss.com"></script>
                </head>
                <body class="bg-slate-300 flex justify-center p-4 m-0 min-h-screen">
                    <div style="width: 210mm; min-height: 297mm; position: relative; background: white; font-family: 'Cambria', Georgia, serif; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);">
                        ${suratClone.innerHTML}
                    </div>
                </body>
                </html>
            `;
            
            // Masukkan HTML ke Iframe pratinjau
            document.getElementById('iframe-preview-surat').srcdoc = isiSuratHTML;

            // 4. SIAPKAN PAYLOAD SANGAT RINGAN UNTUK SERVER
            // Kita HANYA mengirimkan data teksnya saja, tidak ada lagi file Base64 raksasa
            payload.dataSurat = {
                nama: student.nama,
                nim: student.nim,
                prodi: student.prodi,
                nomorSurat: nomorSuratStr,
                tanggal: tanggalStr
            };
            
            // Pastikan tidak ada data pdfBase64 yang ikut terbawa (jika sebelumnya ada)
            delete payload.pdfBase64; 
            
            payloadSuratTertunda = payload; 
            
            // 5. TAMPILKAN MODAL
            document.getElementById('modal-preview-surat').classList.remove('hidden');
            
            // Pastikan tombol dalam keadaan siap
            btnProses.innerHTML = `<i class="fa-solid fa-paper-plane"></i><span>Proses & Kirim Email</span>`;
            btnProses.disabled = false;
            
            return; 
        }
    } catch (error) {
        // Pengaman: Hapus layar loading jika sistem gagal
        const loading = document.querySelector('div[style*="z-index: 9999999"]');
        if (loading) document.body.removeChild(loading);
        const clone = document.querySelector('div[style*="z-index: 9999998"]');
        if (clone) document.body.removeChild(clone);

        showToast("Error", "Gagal memproses pembuatan PDF.");
        btnProses.innerHTML = `<i class="fa-solid fa-paper-plane"></i><span>Proses & Kirim Email</span>`;
        btnProses.disabled = false;
    } 
}

// ==============================================================================
// 2. FUNGSI PEMBATALAN (MERESET DATA SEMENTARA)
// ==============================================================================
function tutupPreviewSurat() {
    document.getElementById('modal-preview-surat').classList.add('hidden');
    const iframe = document.getElementById('iframe-preview-surat');
    iframe.src = "";
    iframe.removeAttribute('srcdoc'); // Bersihkan sisa html
    payloadSuratTertunda = null;
}

// ==============================================================================
// 3. FUNGSI EKSEKUSI PENGIRIMAN FINAL KE GOOGLE SHEETS
// ==============================================================================
async function konfirmasiKirimSurat() {
    if (!payloadSuratTertunda) return;

    // Sistem akan mencoba mencari tombol berdasarkan ID yang paling umum digunakan
    const btnKirim = document.getElementById('btn-final-kirim-surat') || 
                     document.getElementById('btn-konfirmasi-modal');
                     
    let teksAsli = '<i class="fa-solid fa-paper-plane"></i><span>Kirim ke Mahasiswa</span>';

    // Jika tombol ditemukan, ubah tampilannya menjadi loading
    if (btnKirim) {
        teksAsli = btnKirim.innerHTML; // Simpan tampilan asli tombol
        btnKirim.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Mengirim...</span>`;
        btnKirim.disabled = true;
    }

    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(payloadSuratTertunda)
        });
        const result = await response.json();

        if (result.success) {
            // Ubah data lokal dan tabel JIKA pengiriman sukses
            if (typeof pengajuanData !== 'undefined') {
                const itemPengajuan = pengajuanData.find(p => p.ID === payloadSuratTertunda.id);
                if (itemPengajuan) {
                    itemPengajuan.Status = payloadSuratTertunda.status; 
                    itemPengajuan.Catatan = payloadSuratTertunda.catatanAdmin;
                }
                renderTablePengajuan(); 
            }
            
            // Tutup kedua lapis modal
            tutupPreviewSurat();
            const modalTerbit = document.getElementById('modal-terbit-surat');
            if (modalTerbit) modalTerbit.classList.add('hidden');
            
            showToast("Sukses", `Pengajuan berhasil ${payloadSuratTertunda.status === 'Diterbitkan' ? 'diterbitkan' : 'ditolak'} dan email telah dikirim.`);
        } else {
            showToast("Gagal", "Sistem gagal mengirim data ke server.");
        }
    } catch (error) {
        showToast("Error Koneksi", "Terputus dari server atau gagal mengirim email.");
    } finally {
        // Kembalikan tampilan tombol ke semula jika tombol ditemukan
        if (btnKirim) {
            btnKirim.innerHTML = teksAsli;
            btnKirim.disabled = false;
        }
    }
}
