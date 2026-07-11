import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { Camera, XCircle, Check, QrCode, LockSimple, LockSimpleOpen } from "@phosphor-icons/react";
import { Html5Qrcode } from "html5-qrcode";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const PLANT_CONFIG = {
  A: ["A1", "A2", "A3", "A4"],
  G: ["G1", "G2", "G3A", "G3B"],
  K: ["K1", "K2", "K3", "K4"],
  E: ["E1", "E2", "E3"]
};

// How long a QR scan stays valid before the engineer must re-scan.
// Mirrors the existing photo staleness pattern (10 min) so a scan
// can't be done in the office and used hours later in the field.
const QR_STALENESS_MINUTES = 15;

const QR_SCANNER_ELEMENT_ID = "machine-qr-reader";

const BulkEntry = () => {
  const [selectedPlant, setSelectedPlant] = useState("A");
  const [selectedMachine, setSelectedMachine] = useState("");
  const [machineConfig, setMachineConfig] = useState(null);
  const [readings, setReadings] = useState({});
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoBase64, setPhotoBase64] = useState(null);
  const [technician, setTechnician] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // --- QR verification state ---
  const [qrVerified, setQrVerified] = useState(false);
  const [qrScanTimestamp, setQrScanTimestamp] = useState(null);
  const [scannerActive, setScannerActive] = useState(false);
  const [scanError, setScanError] = useState("");
  const [manualOverride, setManualOverride] = useState(false);
  const [manualReason, setManualReason] = useState("");
  const html5QrRef = useRef(null);

  const startScanner = async () => {
    setScanError("");
    setScannerActive(true);
    // Give the DOM a tick to render the scanner container before attaching
    setTimeout(async () => {
      try {
        const qr = new Html5Qrcode(QR_SCANNER_ELEMENT_ID);
        html5QrRef.current = qr;
        await qr.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText) => handleScanSuccess(decodedText),
          () => { /* per-frame scan miss, ignore */ }
        );
      } catch (err) {
        console.error("Scanner start error:", err);
        setScanError("Could not access camera. Check camera permission, or use Manual Entry below.");
        setScannerActive(false);
      }
    }, 150);
  };

  const stopScanner = async () => {
    if (html5QrRef.current) {
      try {
        await html5QrRef.current.stop();
        html5QrRef.current.clear();
      } catch (err) {
        // scanner may already be stopped
      }
      html5QrRef.current = null;
    }
    setScannerActive(false);
  };

  const handleScanSuccess = async (decodedText) => {
    try {
      const data = JSON.parse(decodedText);
      if (!data.plant || !data.machine || !PLANT_CONFIG[data.plant]?.includes(data.machine)) {
        setScanError("QR code not recognized as a valid machine panel.");
        return;
      }
      await stopScanner();
      setSelectedPlant(data.plant);
      setSelectedMachine(data.machine);
      setQrVerified(true);
      setQrScanTimestamp(new Date().toISOString());
      setManualOverride(false);
      setManualReason("");
      setScanError("");
    } catch (e) {
      setScanError("Unrecognized QR code. Make sure you're scanning the machine panel label.");
    }
  };

  const resetVerification = async () => {
    await stopScanner();
    setQrVerified(false);
    setQrScanTimestamp(null);
    setSelectedMachine("");
    setMachineConfig(null);
    setManualOverride(false);
    setManualReason("");
  };

  useEffect(() => {
    return () => { if (html5QrRef.current) { html5QrRef.current.stop().catch(() => {}); } };
  }, []);

  useEffect(() => {
    if (selectedPlant && selectedMachine) {
      fetchMachineConfig();
    }
  }, [selectedPlant, selectedMachine]);

  const fetchMachineConfig = async () => {
    try {
      const response = await axios.get(`${API}/machine-config/${selectedPlant}/${selectedMachine}`);
      setMachineConfig(response.data);

      // Per-motor limits from machine_config.json motor_limits section.
      // Falls back to global defaults if a motor has no entry.
      const motorLimits = response.data.motor_limits || {};

      const initialReadings = {};
      response.data.motors.forEach(motor => {
        const limits = motorLimits[motor] || {};
        initialReadings[motor] = {
          current:             "",
          temperature:         "",
          i2t:                 "",
          normal_current:      String(limits.normal_current      ?? 3.0),
          warning_current:     String(limits.warning_current     ?? 4.0),
          normal_temperature:  String(limits.normal_temperature  ?? 60),
          warning_temperature: String(limits.warning_temperature ?? 80),
          normal_i2t:          String(limits.normal_i2t          ?? 1000),
          warning_i2t:         String(limits.warning_i2t         ?? 1500),
        };
      });
      setReadings(initialReadings);
    } catch (e) {
      console.error("Error fetching config:", e);
    }
  };

  const handlePhotoCapture = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Resize so the longest side is at most 1200px, then compress to JPEG.
        // This cuts a typical 4000x3000 phone photo (5-8MB) down to ~150-300KB
        // before it ever reaches the server, preventing memory spikes on Render.
        const MAX_DIM = 1200;
        let { width, height } = img;
        if (width > height && width > MAX_DIM) {
          height = Math.round((height * MAX_DIM) / width);
          width = MAX_DIM;
        } else if (height > MAX_DIM) {
          width = Math.round((width * MAX_DIM) / height);
          height = MAX_DIM;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', 0.7);
        setPhotoBase64(compressed);
        setPhotoPreview(compressed);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleValueChange = (motor, field, value) => {
    setReadings(prev => ({
      ...prev,
      [motor]: {
        ...prev[motor],
        [field]: value
      }
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Require either a fresh QR scan or an explicit manual override reason.
    // A scan older than QR_STALENESS_MINUTES can't be reused for a new visit.
    const scanAgeMinutes = qrScanTimestamp
      ? (Date.now() - new Date(qrScanTimestamp).getTime()) / 60000
      : Infinity;
    const scanStillFresh = qrVerified && scanAgeMinutes <= QR_STALENESS_MINUTES;

    if (!scanStillFresh && !manualOverride) {
      alert("⚠️ Please scan the machine panel's QR code, or use Manual Entry and give a reason.");
      return;
    }
    if (!scanStillFresh && manualOverride && !manualReason.trim()) {
      alert("⚠️ Please give a reason for skipping the QR scan (e.g. label damaged/missing).");
      return;
    }

    setSubmitting(true);

    try {
      const bulkData = {
        plant: selectedPlant,
        machine: selectedMachine,
        readings: Object.entries(readings).map(([motor, values]) => ({
          motor,
          ...values
        })),
        technician,
        photo_base64: photoBase64,
        entry_source: "Field",
        qr_verified: scanStillFresh,
        qr_scan_timestamp: scanStillFresh ? qrScanTimestamp : "",
        manual_override_reason: scanStillFresh ? "" : manualReason.trim()
      };

      await axios.post(`${API}/condition-monitoring/bulk`, bulkData);

      alert("✅ All readings submitted successfully!");

      setSelectedMachine("");
      setMachineConfig(null);
      setReadings({});
      setPhotoPreview(null);
      setPhotoBase64(null);
      setTechnician("");
      setQrVerified(false);
      setQrScanTimestamp(null);
      setManualOverride(false);
      setManualReason("");

    } catch (error) {
      console.error("Bulk submit error:", error);
      alert("❌ Failed to submit readings: " + (error.response?.data?.detail || error.message));
    } finally {
      setSubmitting(false);
    }
  };

  const hasParameters = (param) => {
    return machineConfig?.parameters?.includes(param);
  };

  return (
    <div className="w-full max-w-[1920px] mx-auto p-4 md:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-4xl font-light tracking-tight text-zinc-950">Bulk Reading Entry</h1>
        <p className="text-sm text-zinc-700 mt-2">Enter all motor readings for a machine at once</p>
      </div>

      <div className="border border-zinc-200 bg-white p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium tracking-tight text-zinc-900">Step 1 — Verify You're at the Machine</h3>
          {qrVerified && (
            <span className="flex items-center gap-1 text-xs font-medium text-[#16A34A]">
              <LockSimple size={14} weight="bold" /> Verified: {selectedPlant} - {selectedMachine}
            </span>
          )}
        </div>

        {!qrVerified && !manualOverride && (
          <>
            <p className="text-sm text-zinc-600 mb-4">
              Scan the QR code on the machine panel to unlock entry for that machine.
            </p>
            {!scannerActive ? (
              <button type="button" onClick={startScanner} className="flex items-center gap-2 bg-[#002FA7] text-white px-6 py-3 text-sm font-medium hover:bg-[#002FA7]/90 rounded-none">
                <QrCode size={18} weight="bold" /> Scan Machine QR Code
              </button>
            ) : (
              <div>
                <div id={QR_SCANNER_ELEMENT_ID} className="w-full max-w-sm border-2 border-[#002FA7]" />
                <button type="button" onClick={stopScanner} className="mt-3 text-sm text-zinc-600 underline">
                  Cancel scan
                </button>
              </div>
            )}
            {scanError && <p className="text-sm text-[#E11D48] mt-3">{scanError}</p>}
            <button
              type="button"
              onClick={() => { setManualOverride(true); setScanError(""); }}
              className="block mt-4 text-xs text-zinc-500 underline"
            >
              QR label missing or damaged? Manual entry (flagged for review)
            </button>
          </>
        )}

        {!qrVerified && manualOverride && (
          <div>
            <div className="flex items-center gap-2 mb-3 text-xs text-[#E11D48] font-medium">
              <LockSimpleOpen size={14} weight="bold" /> Manual entry — this submission will be flagged for supervisor review
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">Plant *</label>
                <select
                  value={selectedPlant}
                  onChange={(e) => { setSelectedPlant(e.target.value); setSelectedMachine(""); setMachineConfig(null); }}
                  className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
                >
                  {Object.keys(PLANT_CONFIG).map(p => <option key={p} value={p}>Plant {p}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">Machine *</label>
                <select
                  value={selectedMachine}
                  onChange={(e) => setSelectedMachine(e.target.value)}
                  className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
                >
                  <option value="">Select Machine</option>
                  {PLANT_CONFIG[selectedPlant]?.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">Reason for skipping QR scan *</label>
            <input
              type="text"
              value={manualReason}
              onChange={(e) => setManualReason(e.target.value)}
              placeholder="e.g. QR label damaged, needs replacement"
              className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
            />
            <button type="button" onClick={() => { setManualOverride(false); setManualReason(""); }} className="block mt-3 text-xs text-zinc-500 underline">
              Cancel — try scanning instead
            </button>
          </div>
        )}

        {qrVerified && (
          <button type="button" onClick={resetVerification} className="mt-2 text-xs text-zinc-500 underline">
            Wrong machine? Re-scan
          </button>
        )}
      </div>

      {machineConfig && (
        <form onSubmit={handleSubmit}>
          <div className="border border-zinc-200 bg-white p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-medium tracking-tight text-zinc-900">
                  {selectedPlant} - {selectedMachine} Readings ({machineConfig.motors.length} motors)
                </h3>
                <p className="text-sm text-zinc-600 mt-1">
                  Parameters: {machineConfig.parameters.map(p => p.toUpperCase()).join(", ")}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-zinc-50">
                  <tr className="border-b-2 border-zinc-200">
                    <th className="text-left px-4 py-3 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 sticky left-0 bg-zinc-50">
                      Motor
                    </th>
                    {hasParameters("current") && (
                      <>
                        <th className="text-center px-4 py-3 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Current (A) *</th>
                        <th className="text-center px-4 py-3 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-400">Normal</th>
                        <th className="text-center px-4 py-3 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-400">Warning</th>
                      </>
                    )}
                    {hasParameters("temperature") && (
                      <>
                        <th className="text-center px-4 py-3 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Temp (°C) *</th>
                        <th className="text-center px-4 py-3 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-400">Normal</th>
                        <th className="text-center px-4 py-3 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-400">Warning</th>
                      </>
                    )}
                    {hasParameters("i2t") && (
                      <>
                        <th className="text-center px-4 py-3 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">I²t (A²s) *</th>
                        <th className="text-center px-4 py-3 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-400">Normal</th>
                        <th className="text-center px-4 py-3 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-400">Warning</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {machineConfig.motors.map((motor, idx) => (
                    <tr key={motor} className={`border-b border-zinc-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-zinc-50/50'}`}>
                      <td className="px-4 py-2 text-sm font-medium text-zinc-950 sticky left-0 bg-inherit">{motor}</td>
                      {hasParameters("current") && (
                        <>
                          <td className="px-4 py-2">
                            <input type="number" step="0.01" value={readings[motor]?.current || ""} onChange={(e) => handleValueChange(motor, "current", e.target.value)} className="w-24 border border-zinc-200 px-2 py-1 text-sm font-mono text-center rounded-none focus:ring-1 focus:ring-[#002FA7]" placeholder="0.00" required />
                          </td>
                          <td className="px-4 py-2">
                            <input type="number" step="0.1" value={readings[motor]?.normal_current || ""} onChange={(e) => handleValueChange(motor, "normal_current", e.target.value)} className="w-20 border border-zinc-200 px-2 py-1 text-xs font-mono text-center rounded-none bg-zinc-50" />
                          </td>
                          <td className="px-4 py-2">
                            <input type="number" step="0.1" value={readings[motor]?.warning_current || ""} onChange={(e) => handleValueChange(motor, "warning_current", e.target.value)} className="w-20 border border-zinc-200 px-2 py-1 text-xs font-mono text-center rounded-none bg-zinc-50" />
                          </td>
                        </>
                      )}
                      {hasParameters("temperature") && (
                        <>
                          <td className="px-4 py-2">
                            <input type="number" step="0.1" value={readings[motor]?.temperature || ""} onChange={(e) => handleValueChange(motor, "temperature", e.target.value)} className="w-24 border border-zinc-200 px-2 py-1 text-sm font-mono text-center rounded-none focus:ring-1 focus:ring-[#002FA7]" placeholder="0.0" required />
                          </td>
                          <td className="px-4 py-2">
                            <input type="number" step="1" value={readings[motor]?.normal_temperature || ""} onChange={(e) => handleValueChange(motor, "normal_temperature", e.target.value)} className="w-20 border border-zinc-200 px-2 py-1 text-xs font-mono text-center rounded-none bg-zinc-50" />
                          </td>
                          <td className="px-4 py-2">
                            <input type="number" step="1" value={readings[motor]?.warning_temperature || ""} onChange={(e) => handleValueChange(motor, "warning_temperature", e.target.value)} className="w-20 border border-zinc-200 px-2 py-1 text-xs font-mono text-center rounded-none bg-zinc-50" />
                          </td>
                        </>
                      )}
                      {hasParameters("i2t") && (
                        <>
                          <td className="px-4 py-2">
                            <input type="number" step="1" value={readings[motor]?.i2t || ""} onChange={(e) => handleValueChange(motor, "i2t", e.target.value)} className="w-24 border border-zinc-200 px-2 py-1 text-sm font-mono text-center rounded-none focus:ring-1 focus:ring-[#002FA7]" placeholder="0" required />
                          </td>
                          <td className="px-4 py-2">
                            <input type="number" step="1" value={readings[motor]?.normal_i2t || ""} onChange={(e) => handleValueChange(motor, "normal_i2t", e.target.value)} className="w-20 border border-zinc-200 px-2 py-1 text-xs font-mono text-center rounded-none bg-zinc-50" />
                          </td>
                          <td className="px-4 py-2">
                            <input type="number" step="1" value={readings[motor]?.warning_i2t || ""} onChange={(e) => handleValueChange(motor, "warning_i2t", e.target.value)} className="w-20 border border-zinc-200 px-2 py-1 text-xs font-mono text-center rounded-none bg-zinc-50" />
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border border-zinc-200 bg-white p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-3 block">
                  📸 Verification Photo (If any alarm/warning)
                </label>
                {!photoPreview ? (
                  <label className="flex items-center space-x-2 px-4 py-3 border-2 border-dashed border-zinc-300 hover:border-[#002FA7] bg-white cursor-pointer transition-all duration-150 rounded-none">
                    <Camera size={20} weight="bold" className="text-[#002FA7]" />
                    <span className="text-sm text-zinc-700">Capture / Upload Photo</span>
                    <input type="file" accept="image/*" capture="environment" onChange={handlePhotoCapture} className="hidden" />
                  </label>
                ) : (
                  <div className="relative inline-block">
                    <img src={photoPreview} alt="Preview" className="w-48 h-36 object-cover border-2 border-[#002FA7]" />
                    <button type="button" onClick={() => { setPhotoPreview(null); setPhotoBase64(null); }} className="absolute top-2 right-2 bg-[#E11D48] text-white p-1 hover:bg-[#E11D48]/90">
                      <XCircle size={16} weight="fill" />
                    </button>
                  </div>
                )}
              </div>
              <div>
                <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-3 block">
                  Engineer's Name *
                </label>
                <input type="text" value={technician} onChange={(e) => setTechnician(e.target.value)} placeholder="Enter your name" className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none" required />
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-3">
            <button type="button" onClick={() => { setSelectedMachine(""); setMachineConfig(null); }} className="border border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 px-6 py-3 text-sm font-medium tracking-tight transition-all duration-150 ease-out rounded-none">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="bg-[#16A34A] text-white hover:bg-[#16A34A]/90 px-8 py-3 text-sm font-medium tracking-tight transition-all duration-150 ease-out rounded-none disabled:opacity-50 flex items-center space-x-2">
              {submitting ? <span>Submitting...</span> : <><Check size={18} weight="bold" /><span>Submit All Readings ({machineConfig.motors.length} motors)</span></>}
            </button>
          </div>
        </form>
      )}

      {!machineConfig && selectedMachine && (
        <div className="border border-zinc-200 bg-white p-12 text-center">
          <p className="text-zinc-500">Loading machine configuration...</p>
        </div>
      )}

      {!selectedMachine && (
        <div className="border border-zinc-200 bg-white p-12 text-center">
          <p className="text-zinc-500">Select a machine to start bulk entry</p>
        </div>
      )}
    </div>
  );
};

export default BulkEntry;
