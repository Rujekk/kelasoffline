# KelasOffline — AI Tutor Tanpa Kuota

**PRD v1.0 · 25 November 2026 · Status: MENUNGGU PERSETUJUAN (Langkah 1 dari 5)**
Hackathon: #BuildHybridAI 2026 (Firebase) · Platform: Web (Chrome) · Deadline submit: 30 Nov 2026 14:00 PST (1 Des 06:00 WITA)

---

## 1. Ringkasan Produk

**Masalah.** Pelajar di Indonesia sering kehabisan kuota data atau berada di wilayah sinyal lemah. Pada momen itu juga, semua AI tutor berbasis cloud tidak bisa dipakai — padahal kebutuhan belajar (memahami materi, latihan soal) tidak menunggu sinyal bagus.

**Solusi.** KelasOffline adalah tutor AI berbasis web yang tetap bisa bekerja **tanpa internet**: materi pelajaran diproses oleh **Gemini Nano langsung di perangkat** (Chrome Prompt API) melalui **Firebase AI Logic Hybrid Inference SDK**. Saat koneksi tersedia dan jawaban yang lebih dalam dibutuhkan, aplikasi otomatis memakai **Gemini 2.5 Flash di cloud** lewat SDK yang sama.

**Target pengguna.** Pelajar SMP/SMA dan mahasiswa di Indonesia dengan kuota terbatas / koneksi tidak stabil, yang belajar dari HP atau laptop dengan browser Chrome.

**Satu kalimat jualan (value proposition).** *Belajar tidak boleh berhenti hanya karena kuota habis.*

## 2. Fitur Utama (HANYA 1 — di luar ini = di luar cakupan)

**Tempel materi/soal → dapat ringkasan + latihan soal.**

Input: satu blok teks materi pelajaran (hasil tempel dari buku, foto teks, catatan guru, atau soal).
Output — selalu dua bagian, dari satu kali proses:

1. **Rangkuman 3 poin penting** dari materi.
2. **3 soal latihan + kunci jawaban** yang dibuat dari materi yang sama.

Bahasa antarmuka: Bahasa Indonesia. Bahasa output mengikuti bahasa materi (Indonesia/Inggris).

**Di luar cakupan (eksplisit TIDAK dibuat):** chat multi-giliran, unggah file/gambar, akun berbayar, mode guru/kelas, gamifikasi, aplikasi Android/iOS native, riwayat lintas perangkat.

## 3. Spesifikasi Output (kontrak data)

Output diminta ke model dalam format **JSON terstruktur** (structured output didukung Firebase AI Logic, termasuk untuk inferensi on-device) agar UI tidak perlu menebak-nebak teks bebas:

```json
{
  "summary": ["poin 1", "poin 2", "poin 3"],
  "quiz": [
    { "question": "…", "answer": "…" },
    { "question": "…", "answer": "…" },
    { "question": "…", "answer": "…" }
  ]
}
```

- Tepat 3 poin ringkasan dan tepat 3 soal. Kunci jawaban ditampilkan terlipat (klik untuk membuka) agar pelajar mencoba dulu.
- Bila model mengembalikan JSON tidak valid: tampilkan pesan error yang sopan + tombol coba lagi (tidak ada parsing tebakan).

## 4. Arsitektur

Aplikasi adalah **SPA client-only** (tanpa server sendiri). Semua inferensi dipanggil dari browser melalui Firebase AI Logic; Chrome menyediakan model on-device; Firebase menyediakan jalur cloud, autentikasi anonim, dan penyimpanan riwayat.

```
┌────────────────────────────────────────────────────────────┐
│ Browser Chrome (desktop/Android)                           │
│                                                            │
│  Vite + React + Tailwind (1 halaman)                       │
│        │  Firebase JS SDK v12.5.0+                         │
│        ├──────────────┬──────────────────┬────────────────┤
│        ▼              ▼                  ▼                │
│  Firebase AI     Firebase Auth     Firestore             │
│  Logic (hybrid)  (Anonymous)       (riwayat belajar)     │
│        │                                                 │
│        ├── InferenceMode.PREFER_ON_DEVICE ──► Chrome     │
│        │      Prompt API ──► Gemini Nano (di perangkat)  │
│        └── fallback / ONLY_IN_CLOUD ───────► Gemini 2.5  │
│               Flash (cloud, Gemini Developer API)        │
│  App Check (debug provider untuk demo) melindungi API    │
└────────────────────────────────────────────────────────────┘
```

Komponen Firebase yang dipakai — tidak lebih dari ini:

| Layanan | Fungsi di KelasOffline |
|---|---|
| Firebase AI Logic | Satu-satunya jalur inferensi (hybrid on-device + cloud) |
| Firebase Auth (Anonymous) | Identitas per pengguna tanpa login, untuk memisahkan riwayat |
| Firestore | Menyimpan riwayat belajar per pengguna anonim |
| App Check | Wajib untuk AI Logic; demo memakai debug token yang didaftarkan di console (diizinkan aturan hackathon) |

## 5. Logika Hybrid (inti penilaian juri)

Satu pemanggilan `getGenerativeModel()` membawa `InferenceMode`; SDK yang memutuskan jalur akhir, aplikasi menampilkan hasilnya secara jujur di UI.

| Kondisi | Mode SDK | Jalur | Badge di UI |
|---|---|---|---|
| Nano tersedia (status `available`) | `PREFER_ON_DEVICE` | Gemini Nano di perangkat; bila gagal → SDK fallback ke cloud | **Mode: On-Device (Offline)** |
| Nano tidak ada / belum terunduh, ada internet | `PREFER_ON_DEVICE` | SDK otomatis ke cloud (Gemini 2.5 Flash) | **Mode: Cloud (Online)** |
| Pengguna memilih "Jawaban mendalam (cloud)" | `ONLY_IN_CLOUD` | Gemini 2.5 Flash | **Mode: Cloud (Online)** |
| Offline total & Nano tidak tersedia | — | Tidak ada jalur → pesan error jelas + saran | (error, tanpa badge) |

Aturan implementasi (sesuai dokumentasi resmi Firebase AI Logic — *Build hybrid experiences in Web apps*, SDK v12.5.0+):

- Sebelum prompt pertama, panggil `model.initializeDeviceModel()` **pada interaksi pengguna** (klik tombol) — ini syarat Chrome Prompt API; progres unduhan Nano ditampilkan bila model sedang diunduh.
- Setiap hasil menampilkan: **badge mode** (On-Device/Cloud) + **waktu respons** (ms/detik, diukur di klien) + penanda bahasa tidak diperlukan.
- Status ketersediaan Nano (`LanguageModel.availability()`) ditampilkan sebagai chip kecil di header: *Nano: siap / bisa diunduh / tidak tersedia*.
- Inferensi on-device hanya mendukung **teks satu giliran** (bukan chat) — sesuai desain fitur ini (satu input → satu output terstruktur).

## 6. User Flow

1. Pelajar membuka KelasOffline (halaman tunggal). Aplikasi masuk otomatis sebagai pengguna anonim (Firebase Auth) dan memuat riwayat belajar terakhir dari Firestore.
2. Pelajar menempel materi pelajaran ke textarea. Penghitung karakter tampil; chip status menunjukkan Nano siap/tidak dan status jaringan.
3. Pelajar menekan **“Buat Rangkuman”**.
4. Aplikasi memanggil model hybrid (`PREFER_ON_DEVICE`) setelah `initializeDeviceModel()`. Indikator progres tampil (termasuk progres unduh Nano bila relevan).
5. Hasil tampil: badge mode + waktu respons, lalu **Rangkuman 3 poin**, lalu **3 soal latihan** dengan kunci jawaban terlipat.
6. Hasil tersimpan ke Firestore sebagai riwayat (materi dipotong untuk judul, mode, waktu respons, ringkasan, soal).
7. Skenario offline: pelajar mematikan koneksi (atau memang tidak ada sinyal) → langkah 3–5 tetap berjalan lewat Nano, badge menunjukkan *On-Device (Offline)*. Penyimpanan riwayat menunggu koneksi pulih (Firestore offline persistence) — UI tidak error.

## 7. Model Data (Firestore)

Koleksi: `studyHistory` — satu dokumen per sesi belajar.

| Field | Tipe | Keterangan |
|---|---|---|
| `uid` | string | UID pengguna anonim (pemilik dokumen) |
| `createdAt` | timestamp | Waktu sesi |
| `title` | string | Baris pertama materi, maks. 80 karakter |
| `sourceChars` | number | Panjang materi |
| `mode` | string | `on_device` / `cloud` (jalur yang benar-benar melayani) |
| `responseMs` | number | Waktu respons terukur |
| `summary` | array<string> | 3 poin ringkasan |
| `quiz` | array<{question, answer}> | 3 soal + kunci |

Security rules: pengguna anonim hanya bisa membaca/menulis dokumen dengan `uid == request.auth.uid`. Tidak ada data pribadi yang dikumpulkan.

## 8. Stack (tetap — tidak diganti tanpa izin)

| Lapisan | Pilihan | Alasan |
|---|---|---|
| Frontend | **Vite + React + Tailwind CSS** | Dari dua opsi yang diizinkan (Next.js/Vite), Vite dipilih: aplikasi ini murni client-side SPA satu halaman; Next.js (SSR) tidak memberi nilai tambah dan menambah kompleksitas deploy. |
| SDK | Firebase JS SDK **v12.5.0+** (`firebase/ai`, `firebase/auth`, `firebase/firestore`, `firebase/app-check`) via npm | Syarat minimum dokumentasi resmi untuk hybrid inference di web. |
| On-device | Gemini Nano via Chrome Prompt API (lewat Firebase AI Logic) | Sesuai ketentuan hackathon. |
| Cloud | Gemini 2.5 Flash via Firebase AI Logic (Gemini Developer API backend, free tier) | Gratis dalam batas kuota; tanpa billing. |
| Hosting | GitHub Pages (statis) atau Firebase Hosting — diputuskan di Langkah 2 | Keduanya gratis; konten 100% statis. |

## 9. Batasan & Risiko (jujur, dari dokumentasi resmi)

1. **On-device hanya di Chrome desktop versi 139+.** Di Chrome Android/HP, Prompt API tidak tersedia → aplikasi otomatis berjalan Mode Cloud. UI tetap mobile-friendly, tetapi demo on-device harus direkam di Chrome desktop. Ini batasan platform, bukan bug.
2. **Gemini Nano perlu diunduh sekali** (±1–2 GB, oleh Chrome) sebelum pemakaian pertama; unduhan dipicu dari klik pengguna dan progresnya ditampilkan.
3. **Satu giliran saja.** On-device tidak mendukung chat — fitur memang dirancang satu input → satu output.
4. **Kuota cloud free tier terbatas.** Pemakaian demo aman; kunci API tidak diekspos selain konfigurasi web Firebase standar, dan App Check enforced.
5. **App Check** wajib aktif untuk AI Logic; jalur demo memakai debug token terdaftar (diizinkan eksplisit oleh aturan #BuildHybridAI).

## 10. Kriteria Sukses (pemetaan ke penilaian juri)

| Kriteria juri | Bukti di KelasOffline |
|---|---|
| Hybrid inference benar-benar jalan | Badge mode berubah nyata: rekaman demo menampilkan proses yang sama dua kali — online (Cloud) dan offline (On-Device) — dengan waktu respons tertera |
| Berguna untuk orang nyata | Masalah kuota/sinyal pelajar Indonesia; skenario demo memakai materi pelajaran asli (contoh: teks IPA kelas 9) |
| Demo jalan tanpa error | Satu fitur, satu halaman, jalur error eksplisit (JSON invalid, offline tanpa Nano, kuota) semuanya ditangani dengan pesan, bukan crash |

## 11. Cara Menjalankan & Menguji (ringkas — detail di Langkah 2–3)

- **Run:** `npm install` → isi `.env` dari `.env.example` → `npm run dev` → buka `http://localhost:5173` di Chrome desktop 139+.
- **Test manual wajib sebelum submit:** (a) materi pendek dengan Nano siap → badge On-Device; (b) matikan jaringan di DevTools → proses tetap berhasil offline; (c) mode cloud paksa → badge Cloud; (d) kunci jawaban terlipat/terbuka; (e) riwayat muncul setelah refresh (Firestore).

## 12. Langkah Berikutnya (belum dikerjakan — menunggu persetujuan)

- **Langkah 2:** struktur project Vite + React + Tailwind, setup Firebase AI Logic + Auth Anonymous + Firestore, `.env.example`.
- **Langkah 3:** fitur utama + logika hybrid + badge mode + waktu respons.
- **Langkah 4:** UI final satu halaman (putih + aksen biru Firebase), mobile-friendly.
- **Langkah 5:** naskah video demo 2 menit + teks deskripsi Devpost (Inggris).

*Catatan penamaan: project Firebase yang sedang dibuat bernama kerja “Ringkas Hybrid”; nama tampilannya akan diganti menjadi KelasOffline pada Langkah 2 (nama project tidak memengaruhi kode).*
