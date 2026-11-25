import { useEffect, useRef, useState } from "react";
import {
  collection,
  addDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { db, uidReady } from "./firebase.js";
import { probeNano, summarizeAndQuiz } from "./lib/tutor.js";

const SAMPLE_SHORT = `Fotosintesis adalah proses tumbuhan hijau membuat makanan sendiri dengan bantuan cahaya matahari. Bahan yang dibutuhkan adalah air, karbon dioksida, dan cahaya matahari, sedangkan tempat berlangsungnya adalah kloroplas yang mengandung klorofil. Hasil fotosintesis adalah glukosa (gula) dan oksigen. Glukosa dipakai tumbuhan untuk tumbuh, dan oksigen dilepas ke udara sehingga makhluk hidup lain bisa bernapas. Faktor yang memengaruhi fotosintesis antara lain intensitas cahaya, konsentrasi karbon dioksida, dan ketersediaan air. Jika salah satu faktor kurang, laju fotosintesis menurun.`;

const SAMPLE_LONG = `Perlawanan rakyat Indonesia terhadap penjajahan Belanda terjadi di berbagai daerah. Di Aceh, perang berlangsung puluhan tahun dan dipimpin antara lain oleh Teuku Umar dan Cut Nyak Dien. Belanda kesulitan menaklukkan Aceh karena rakyatnya berjuang dengan semangat agama dan dipimpin ulama. Di Jawa, Pangeran Diponegoro memimpin Perang Jawa (1825–1830) yang menguras kas Belanda. Perlawanan Diponegoro dipicu oleh pemasangan patok jalan yang melewati tanah leluhurnya dan pajak yang memberatkan rakyat. Di Sumatera Barat, Perang Padri (1821–1837) dipimpin Tuanku Imam Bonjol. Mula-mula perang ini adalah pertentangan antara kaum Padri dan kaum Adat, tetapi ketika Belanda ikut campur, keduanya bersatu melawan Belanda. Di Kalimantan, Pangeran Antasari memimpin Perang Banjar melawan Belanda yang ingin menguasai tambang batu bara. Semua perlawanan ini akhirnya dapat dipadamkan Belanda karena sifatnya masih kedaerahan: setiap daerah berjuang sendiri-sendiri tanpa persatuan nasional, persenjataan tidak seimbang, dan Belanda memakai politik devide et impera (pecah belah). Pengalaman inilah yang kelak melahirkan kesadaran bahwa perjuangan harus bersifat nasional, yang kemudian diwujudkan melalui organisasi pergerakan nasional pada awal abad ke-20.`;

function ModeBadge({ mode, large = false }) {
  if (mode === "on_device") {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full bg-accent font-semibold text-white ${large ? "px-3.5 py-1.5 text-sm" : "px-2.5 py-0.5 text-xs"}`}>
        <span aria-hidden="true">📱</span> Mode: On-Device (Offline)
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-accent bg-white font-semibold text-accent-dark ${large ? "px-3.5 py-1.5 text-sm" : "px-2.5 py-0.5 text-xs"}`}>
      <span aria-hidden="true">☁️</span> Mode: Cloud (Online)
    </span>
  );
}

export default function App() {
  const [material, setMaterial] = useState("");
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [nano, setNano] = useState("checking");
  const [online, setOnline] = useState(navigator.onLine);
  const [uid, setUid] = useState(null);
  const [history, setHistory] = useState([]);
  const [openAnswers, setOpenAnswers] = useState({});
  const resultRef = useRef(null);

  useEffect(() => {
    probeNano().then(setNano);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    let unsub = () => {};
    uidReady
      .then((id) => {
        setUid(id);
        const q = query(collection(db, "studyHistory"), where("uid", "==", id));
        unsub = onSnapshot(q, (snap) => {
          const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          items.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
          setHistory(items.slice(0, 10));
        });
      })
      .catch(() => {});
    return () => unsub();
  }, []);

  const nanoLabel = {
    available: "Gemini Nano: siap di perangkat",
    downloadable: "Gemini Nano: bisa diunduh",
    downloading: "Gemini Nano: sedang diunduh",
    unavailable: "Gemini Nano: tidak tersedia di perangkat ini",
    unsupported: "Gemini Nano: tidak didukung browser ini",
    checking: "Gemini Nano: memeriksa…",
  }[nano];

  async function handleGenerate() {
    const text = material.trim();
    setError("");
    setResult(null);
    setOpenAnswers({});
    if (!text) {
      setError("Tempel dulu materi pelajaranmu pada kolom di atas.");
      return;
    }
    setBusy(true);
    try {
      const out = await summarizeAndQuiz(text, { deep, onProgress: setProgress });
      setResult(out);
      probeNano().then(setNano);
      // Save to study history (queued by Firestore's offline cache if offline).
      if (uid) {
        addDoc(collection(db, "studyHistory"), {
          uid,
          createdAt: serverTimestamp(),
          title: text.split("\n")[0].slice(0, 80),
          sourceChars: text.length,
          mode: out.modeServed,
          responseMs: out.responseMs,
          summary: out.summary,
          quiz: out.quiz,
        }).catch(() => {});
      }
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (err) {
      console.error(err);
      setError(
        !navigator.onLine && nano !== "available"
          ? "Kamu sedang offline dan Gemini Nano belum tersedia di perangkat ini, jadi belum ada jalur untuk memproses. Sambungkan internet, atau gunakan Chrome desktop agar Gemini Nano bisa dipakai offline."
          : `Belum berhasil: ${err.message || "terjadi kesalahan"}. Silakan coba lagi.`
      );
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  function loadHistory(item) {
    setResult({ summary: item.summary, quiz: item.quiz, modeServed: item.mode, responseMs: item.responseMs });
    setOpenAnswers({});
    setError("");
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 pb-10">
      <header className="pt-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-accent text-2xl" aria-hidden="true">🎓</div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">KelasOffline</h1>
            <p className="text-sm text-slate-500">AI Tutor Tanpa Kuota — belajar jalan terus, sinyal boleh putus.</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className={`rounded-full px-2.5 py-1 font-medium ${nano === "available" ? "bg-accent-soft text-accent-dark" : "bg-slate-100 text-slate-500"}`}>{nanoLabel}</span>
          <span className={`rounded-full px-2.5 py-1 font-medium ${online ? "bg-slate-100 text-slate-500" : "bg-accent-soft text-accent-dark"}`}>
            Jaringan: {online ? "online" : "offline"}
          </span>
        </div>
      </header>

      <main className="flex flex-col gap-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <label htmlFor="material" className="font-semibold text-slate-900">Tempel materi pelajaranmu</label>
          <textarea
            id="material"
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
            rows={9}
            placeholder="Contoh: tempel bab buku, catatan guru, atau teks soal di sini…"
            className="mt-2 w-full resize-y rounded-xl border border-slate-300 p-3 text-[15px] leading-relaxed outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{material.length.toLocaleString("id-ID")} karakter</span>
            <span className="ml-auto flex gap-2">
              <button type="button" onClick={() => setMaterial(SAMPLE_SHORT)} className="rounded-full border border-slate-300 px-2.5 py-1 font-medium text-slate-600 hover:border-accent hover:text-accent-dark">Contoh: IPA Fotosintesis</button>
              <button type="button" onClick={() => setMaterial(SAMPLE_LONG)} className="rounded-full border border-slate-300 px-2.5 py-1 font-medium text-slate-600 hover:border-accent hover:text-accent-dark">Contoh: Sejarah Perlawanan</button>
            </span>
          </div>

          <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
            <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} className="h-4 w-4 accent-[#039be5]" />
            Jawaban mendalam dari cloud (Gemini 2.5 Flash) — butuh internet, hasil lebih kaya
          </label>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={busy}
            className="mt-4 w-full rounded-xl bg-accent px-5 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-accent-dark disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? "Sedang memproses…" : "Buat Rangkuman + Soal Latihan"}
          </button>
          {busy && progress && <p className="mt-2 text-center text-sm text-slate-500" role="status">{progress}</p>}
          {error && <p className="mt-3 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700" role="alert">{error}</p>}
          <p className="mt-3 text-xs leading-relaxed text-slate-400">
            Cara kerja: materi diproses oleh Gemini Nano langsung di perangkatmu bila tersedia (bisa offline, tanpa kuota).
            Bila tidak tersedia, Firebase AI Logic otomatis memakai Gemini 2.5 Flash di cloud.
          </p>
        </section>

        {result && (
          <section ref={resultRef} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-live="polite">
            <div className="flex flex-wrap items-center gap-2.5">
              <ModeBadge mode={result.modeServed} large />
              <span className="text-sm text-slate-500">Waktu respons: {(result.responseMs / 1000).toFixed(1)} detik</span>
            </div>

            <h2 className="mt-5 text-base font-semibold text-slate-900">Rangkuman — 3 poin penting</h2>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[15px] leading-relaxed">
              {result.summary.map((point, i) => <li key={i}>{point}</li>)}
            </ol>

            <h2 className="mt-6 text-base font-semibold text-slate-900">Latihan — 3 soal untukmu</h2>
            <div className="mt-2 space-y-3">
              {result.quiz.map((item, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-3.5">
                  <p className="text-[15px] font-medium text-slate-800">{i + 1}. {item.question}</p>
                  {openAnswers[i] ? (
                    <p className="mt-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-slate-700"><span className="font-semibold">Kunci jawaban:</span> {item.answer}</p>
                  ) : (
                    <button type="button" onClick={() => setOpenAnswers((s) => ({ ...s, [i]: true }))} className="mt-2 text-sm font-semibold text-accent-dark hover:underline">
                      Lihat kunci jawaban
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {history.length > 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-base font-semibold text-slate-900">Riwayat belajarmu</h2>
            <ul className="mt-2 divide-y divide-slate-100">
              {history.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => loadHistory(item)} className="flex w-full flex-wrap items-center gap-2 py-2.5 text-left">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{item.title || "Materi"}</span>
                    <ModeBadge mode={item.mode} />
                    <span className="text-xs text-slate-400">
                      {item.createdAt?.toDate ? item.createdAt.toDate().toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <footer className="mt-8 text-center text-xs leading-relaxed text-slate-400">
        KelasOffline · Dibangun dengan Firebase AI Logic Hybrid Inference — Gemini Nano di perangkat + Gemini 2.5 Flash di cloud ·
        #BuildHybridAI 2026
      </footer>
    </div>
  );
}
