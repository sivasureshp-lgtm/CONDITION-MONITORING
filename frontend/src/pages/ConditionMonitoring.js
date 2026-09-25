import { useState, useEffect, useMemo, useRef } from "react";
import axios from "axios";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { Download, Plus, Warning as WarningIcon, XCircle, Camera, Image as ImageIcon } from "@phosphor-icons/react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const PLANT_CONFIG = {
  A: ["A1", "A2", "A3", "A4"],
  G: ["G1", "G2", "G3A", "G3B"],
  K: ["K1", "K2", "K3", "K4"],
  E: ["E1", "E2", "E3"]
};

const MOTOR_COMPONENTS = [
  "TubeRotation",
  "TubeHeight",
  "Feeder",
  "Shear1",
  "Shear2",
  "Gob Distributor",
  "Main Conveyor",
  "Ware Transfer",
  "Cross Conveyor",
  "Sec1 Invert",
  "Sec1 Takeout",
  "Sec1 Pusher Arm",
  "Sec1 Pusher Finger",
  "Sec2 Invert",
  "Sec2 Takeout",
  "Sec2 Pusher Arm",
  "Sec2 Pusher Finger"
];

// ============================================================
// View settings — change these numbers to suit the plant
// ============================================================
const STALE_DAYS = 7;          // motor not read for more than this -> shown red as "overdue"
const AVG_DAYS = 30;           // window for the running average
const CHANGE_FLAG_PCT = 15;    // change vs previous reading / vs average above this -> highlighted
const ROUND_WINDOW_HOURS = 2;  // readings within this time of the newest reading = "latest round"

const PARAMS = {
  current:     { label: "Current",     unit: "A"   },
  temperature: { label: "Temperature", unit: "°C"  },
  i2t:         { label: "I²t",         unit: "A²s" },
};
const PARAM_ORDER = ["current", "temperature", "i2t"];

// Sheet timestamps are IST text like "2026-09-24 10:19:05" or "2026-06-16 9:10:52".
// new Date("2026-09-24 10:19:05") fails on iPhone/Safari, so parse it by hand.
const parseTs = (raw) => {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const [, y, mo, d, h, mi, se] = m;
    // IST = UTC + 5:30
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(se || 0)) - 330 * 60000);
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/); // dd/mm/yyyy hh:mm
  if (m) {
    const [, d, mo, y, h, mi, se] = m;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(se || 0)) - 330 * 60000);
  }
  const fallback = new Date(s);
  return isNaN(fallback) ? null : fallback;
};

const fmtTime = (d) =>
  d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" }) +
  " " +
  d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

const istDayKey = (d) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD

// "" / null / "abc" -> null ; "0" -> 0 (a stopped motor is a real reading)
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// "Tube Rotation" and "TubeRotation" are the same motor
const motorKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const ageText = (days) => {
  if (days === null || days === undefined) return "never";
  const hours = days * 24;
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.floor(hours)} h ago`;
  return `${Math.floor(days)} d ago`;
};

const fmtNum = (v, dp = 2) =>
  v === null || v === undefined ? "-" : Number.isInteger(v) ? String(v) : v.toFixed(dp);

const fmtPct = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(0)}%`);

const statusBadgeClass = (status) =>
  status === "OK"
    ? "bg-green-50 text-green-700"
    : status === "Warning"
    ? "bg-yellow-50 text-yellow-800"
    : status === "Alarm"
    ? "bg-red-50 text-red-700"
    : "bg-zinc-100 text-zinc-600";

const ConditionMonitoring = () => {
  const [selectedPlant, setSelectedPlant] = useState("A");
  const [selectedMachine, setSelectedMachine] = useState("");
  const [chartData, setChartData] = useState([]);
  const [machineHealth, setMachineHealth] = useState([]);
  const [activeAlarms, setActiveAlarms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  
  const [formData, setFormData] = useState({
    plant: "A",
    machine: "",
    motor: "",
    current: "",
    normal_current: "",
    warning_current: "",
    entry_source: "Field",
    verified_by: "",
    notes: "",
    photo_base64: null
  });
  const [photoPreview, setPhotoPreview] = useState(null);

  // ---- View Data state ----
  const [motorFilter, setMotorFilter] = useState("ALL"); // motor name, or "ALL"
  const [rowLimit, setRowLimit] = useState(100);         // 0 = show all
  const [param, setParam] = useState("current");         // parameter shown in chart + tables
  const [machineCfg, setMachineCfg] = useState(null);    // { motors:[], parameters:[] } from machine_config.json
  const [showAllStatus, setShowAllStatus] = useState(false);
  const chartRef = useRef(null);

  // Reset filters whenever a different machine is opened
  useEffect(() => {
    setMotorFilter("ALL");
    setShowAllStatus(false);
  }, [selectedPlant, selectedMachine]);

  // Parameters this machine really has: configured ones first, then any found in the data
  const availableParams = useMemo(() => {
    const cfg = (machineCfg?.parameters || []).filter((p) => PARAMS[p]);
    const inData = PARAM_ORDER.filter((p) => chartData.some((r) => r[p] !== null));
    const list = [...cfg];
    inData.forEach((p) => {
      if (!list.includes(p)) list.push(p);
    });
    return list.length ? list : ["current"];
  }, [machineCfg, chartData]);

  // K1/K4 have no current -> open on I²t/temperature automatically
  useEffect(() => {
    if (!availableParams.includes(param)) setParam(availableParams[0]);
  }, [availableParams, param]);

  const unit = PARAMS[param]?.unit || "";
  const pLabel = PARAMS[param]?.label || param;

  // Unique motor list for the dropdown
  const motorOptions = useMemo(() => {
    const seen = [];
    chartData.forEach((r) => {
      if (r.motor && !seen.includes(r.motor)) seen.push(r.motor);
    });
    return seen;
  }, [chartData]);

  // Rows after the motor filter (newest first)
  const filteredRows = useMemo(
    () => (motorFilter === "ALL" ? chartData : chartData.filter((r) => r.motor === motorFilter)),
    [chartData, motorFilter]
  );

  // Rows actually drawn in the Recent Readings table
  const tableRows = rowLimit === 0 ? filteredRows : filteredRows.slice(0, rowLimit);

  // Chart: oldest -> newest; 0 = motor stopped, left out so it does not flatten the scale
  const trendData = useMemo(
    () =>
      [...filteredRows].reverse().map((r) => ({
        ...r,
        value: r[param] !== null && r[param] !== 0 ? r[param] : null,
      })),
    [filteredRows, param]
  );
  const trendHasValues = trendData.some((r) => r.value !== null);

  // Show Temperature / I²t columns only when this machine has those values
  const hasCurrent = filteredRows.some((r) => r.current !== null);
  const hasTemp = filteredRows.some((r) => r.temperature !== null);
  const hasI2t = filteredRows.some((r) => r.i2t !== null);

  // ============================================================
  // (1) LATEST STATUS OF EVERY MOTOR
  // ============================================================
  const motorSummary = useMemo(() => {
    const now = Date.now();
    const byKey = new Map();
    // configured motors first, so the order follows machine_config.json
    (machineCfg?.motors || []).forEach((m) => {
      const k = motorKey(m);
      if (k && !byKey.has(k)) byKey.set(k, { name: m, rows: [] });
    });
    chartData.forEach((r) => {
      const k = motorKey(r.motor);
      if (!k) return;
      if (!byKey.has(k)) byKey.set(k, { name: r.motor, rows: [] });
      const entry = byKey.get(k);
      entry.name = entry.rows.length ? entry.name : r.motor; // prefer the name used in the data
      entry.rows.push(r); // chartData is newest-first, so rows stay newest-first
    });

    const cutoff = now - AVG_DAYS * 86400000;
    const list = [...byKey.values()].map(({ name, rows }, idx) => {
      const last = rows[0] || null;
      const withVal = rows.filter((r) => r[param] !== null);
      const lastV = withVal.length ? withVal[0][param] : null;
      const prevV = withVal.length > 1 ? withVal[1][param] : null;
      // no % change when either reading is a stopped motor (0)
      const change = lastV > 0 && prevV > 0 ? ((lastV - prevV) / prevV) * 100 : null;
      const running = withVal.filter((r) => r[param] > 0 && r.ts && r.ts.getTime() >= cutoff);
      const avg = running.length ? running.reduce((s, r) => s + r[param], 0) / running.length : null;
      const vsAvg = lastV > 0 && avg ? ((lastV - avg) / avg) * 100 : null;
      const ageDays = last?.ts ? (now - last.ts.getTime()) / 86400000 : null;
      const stale = ageDays === null || ageDays > STALE_DAYS;
      return {
        name,
        order: idx,
        last,
        lastV,
        prevV,
        change,
        avg,
        avgN: running.length,
        vsAvg,
        ageDays,
        stale,
        stopped: lastV === 0,
        status: last?.status || "No data",
        normalLimit: last ? last[`normal_${param}`] : null,
        warningLimit: last ? last[`warning_${param}`] : null,
      };
    });

    // Alarm -> Warning -> overdue / no data -> OK ; keep config order inside each group
    const rank = (m) => (m.status === "Alarm" ? 0 : m.status === "Warning" ? 1 : m.stale ? 2 : 3);
    list.sort((a, b) => rank(a) - rank(b) || a.order - b.order);
    return list;
  }, [chartData, machineCfg, param]);

  const summaryCounts = useMemo(
    () => ({
      alarm: motorSummary.filter((m) => m.status === "Alarm").length,
      warning: motorSummary.filter((m) => m.status === "Warning").length,
      overdue: motorSummary.filter((m) => m.stale && m.status !== "Alarm" && m.status !== "Warning").length,
      ok: motorSummary.filter((m) => m.status === "OK" && !m.stale).length,
    }),
    [motorSummary]
  );

  // Open one motor's trend from the status table
  const focusMotor = (name) => {
    const match = motorOptions.find((m) => motorKey(m) === motorKey(name));
    if (!match) return;
    setMotorFilter(match);
    setTimeout(() => chartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  // ============================================================
  // (3) ROUND COMPLETENESS
  // ============================================================
  const coverage = useMemo(() => {
    const total = motorSummary.length;
    const todayKey = istDayKey(new Date());
    const readToday = motorSummary.filter((m) => m.last?.ts && istDayKey(m.last.ts) === todayKey);
    const notToday = motorSummary.filter((m) => !(m.last?.ts && istDayKey(m.last.ts) === todayKey));

    const newest = chartData.find((r) => r.ts)?.ts || null;
    let roundMotors = [];
    let roundMissing = [];
    if (newest) {
      const from = newest.getTime() - ROUND_WINDOW_HOURS * 3600000;
      const inRound = new Set(
        chartData.filter((r) => r.ts && r.ts.getTime() >= from).map((r) => motorKey(r.motor))
      );
      roundMotors = motorSummary.filter((m) => inRound.has(motorKey(m.name)));
      roundMissing = motorSummary.filter((m) => !inRound.has(motorKey(m.name)));
    }
    const overdue = motorSummary.filter((m) => m.stale);
    return { total, readToday, notToday, newest, roundMotors, roundMissing, overdue };
  }, [motorSummary, chartData]);

  // Export the filtered rows as CSV (opens in Excel)
  const exportCsv = () => {
    const header = [
      "Time", "Motor", "Current (A)", "Temperature (C)", "I2t (A2s)",
      "Normal Current", "Warning Current", "Normal Temp", "Warning Temp", "Normal I2t", "Warning I2t",
      "Status", "Source", "Photo URL",
    ];
    const esc = (v) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")].concat(
      filteredRows.map((r) =>
        [
          r.time, r.motor, r.current, r.temperature, r.i2t,
          r.normal_current, r.warning_current, r.normal_temperature, r.warning_temperature, r.normal_i2t, r.warning_i2t,
          r.status, r.entry_source, r.photo,
        ]
          .map(esc)
          .join(",")
      )
    );
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const motorPart = motorFilter === "ALL" ? "all-motors" : motorFilter.replace(/\s+/g, "_");
    a.href = url;
    a.download = `${selectedPlant}_${selectedMachine}_${motorPart}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    fetchActiveAlarms();
    if (selectedPlant) {
      fetchMachineHealth(selectedPlant);
    }
  }, [selectedPlant]);

  useEffect(() => {
    if (selectedPlant && selectedMachine) {
      fetchMonitoringData(selectedPlant, selectedMachine);
    }
  }, [selectedPlant, selectedMachine]);

  const fetchActiveAlarms = async () => {
    try {
      const res = await axios.get(`${API}/active-alarms`);
      setActiveAlarms(res.data);
    } catch (e) {
      console.error("Error fetching alarms:", e);
    }
  };

  const fetchMachineHealth = async (plant) => {
    try {
      const res = await axios.get(`${API}/machine-health/${plant}`);
      setMachineHealth(res.data);
    } catch (e) {
      console.error("Error fetching machine health:", e);
      setMachineHealth([]);
    }
  };

  const fetchMonitoringData = async (plant, machine) => {
    setLoading(true);
    setMachineCfg(null);
    // Configured motor list + parameters (used for "missing motors" and the parameter switch).
    // If it fails, the page still works from the readings alone.
    axios
      .get(`${API}/machine-config/${plant}/${machine}`)
      .then((res) => setMachineCfg(res.data || null))
      .catch(() => setMachineCfg(null));
    try {
      const res = await axios.get(`${API}/condition-monitoring/machine/${plant}/${machine}`);
      const transformed = (res.data || []).map((item) => {
        const ts = parseTs(item.timestamp);
        return {
          ts,
          time: ts ? fmtTime(ts) : String(item.timestamp || ""),
          current: num(item.current),
          temperature: num(item.temperature),
          i2t: num(item.i2t),
          normal_current: num(item.normal_current),
          warning_current: num(item.warning_current),
          normal_temperature: num(item.normal_temperature),
          warning_temperature: num(item.warning_temperature),
          normal_i2t: num(item.normal_i2t),
          warning_i2t: num(item.warning_i2t),
          motor: item.motor,
          status: item.status,
          photo: item.photo_url || item.photo || null,
          has_photo: item.has_photo === true || item.has_photo === "Yes" || !!item.photo_url,
          verified: item.verified_by || item.verified,
          entry_source: item.entry_source,
        };
      });
      // newest first, rows without a readable time at the end
      transformed.sort((a, b) => (b.ts ? b.ts.getTime() : 0) - (a.ts ? a.ts.getTime() : 0));
      setChartData(transformed);
    } catch (e) {
      console.error("Error fetching monitoring data:", e);
      setChartData([]);
    } finally {
      setLoading(false);
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
        setFormData({ ...formData, photo_base64: compressed });
        setPhotoPreview(compressed);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const removePhoto = () => {
    setFormData({ ...formData, photo_base64: null });
    setPhotoPreview(null);
  };

  const handleAddData = async (e) => {
    e.preventDefault();
    try {
      const response = await axios.post(`${API}/condition-monitoring`, {
        plant: formData.plant,
        machine: formData.machine,
        motor: formData.motor,
        current: parseFloat(formData.current),
        normal_current: parseFloat(formData.normal_current),
        warning_current: parseFloat(formData.warning_current),
        entry_source: formData.entry_source,
        verified_by: formData.verified_by || null,
        notes: formData.notes || null,
        photo_base64: formData.photo_base64
      });
      
      if (response.data.bulk_entry_flag) {
        alert("⚠️ Warning: Multiple entries detected in short time. Please verify data accuracy.");
      }
      
      setFormData({
        plant: "A",
        machine: "",
        motor: "",
        current: "",
        normal_current: "",
        warning_current: "",
        entry_source: "Field",
        verified_by: "",
        notes: "",
        photo_base64: null
      });
      setPhotoPreview(null);
      setShowAddForm(false);
      
      fetchActiveAlarms();
      if (selectedPlant) {
        fetchMachineHealth(selectedPlant);
      }
      if (selectedPlant === formData.plant && selectedMachine === formData.machine) {
        fetchMonitoringData(selectedPlant, selectedMachine);
      }
    } catch (e) {
      console.error("Error adding data:", e);
      alert(e.response?.data?.detail || "Failed to add monitoring data");
    }
  };

  const getHealthColor = (percent) => {
    if (percent >= 90) return "text-[#16A34A]";
    if (percent >= 70) return "text-yellow-700";
    return "text-[#E11D48]";
  };

  return (
    <div className="w-full max-w-[1920px] mx-auto p-4 md:p-6 lg:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-light tracking-tight text-zinc-950">Condition Monitoring</h1>
          <p className="text-sm text-zinc-700 mt-2">Motor current tracking and health analysis</p>
        </div>
        <button
          data-testid="add-data-btn"
          onClick={() => setShowAddForm(!showAddForm)}
          className="bg-[#002FA7] text-white hover:bg-[#002FA7]/90 px-4 py-2 text-sm font-medium tracking-tight transition-all duration-150 ease-out rounded-none flex items-center space-x-2"
        >
          <Plus size={16} weight="bold" />
          <span>Add Reading</span>
        </button>
      </div>

      {/* Active Alarms */}
      {activeAlarms.length > 0 && (
        <div className="border-2 border-[#E11D48] bg-red-50 p-6 mb-6">
          <div className="flex items-center space-x-3 mb-4">
            <WarningIcon size={24} weight="fill" className="text-[#E11D48]" />
            <h3 className="text-lg font-medium tracking-tight text-[#E11D48]">Active Alarms - Action Required</h3>
          </div>
          <div className="space-y-2">
            {activeAlarms.map((alarm, idx) => (
              <div key={idx} className="flex items-center justify-between bg-white border border-red-200 p-3" data-testid="active-alarm">
                <div className="flex items-center space-x-4">
                  <XCircle size={20} weight="fill" className="text-[#E11D48]" />
                  <div>
                    <span className="text-sm font-medium text-zinc-950">{alarm.plant} - {alarm.machine} - {alarm.motor}</span>
                    <div className="flex items-center space-x-3 mt-1">
                      <span className="text-xs text-zinc-600">Current: <span className="font-mono font-bold text-[#E11D48]">{alarm.current}A</span></span>
                      <span className="text-xs text-zinc-600">Limit: <span className="font-mono">{alarm.warning_current}A</span></span>
                      <span className="text-xs text-zinc-500">{new Date(alarm.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Data Form */}
      {showAddForm && (
        <div className="border border-zinc-200 bg-white p-6 mb-6">
          <h3 className="text-lg font-medium tracking-tight text-zinc-900 mb-4">Add Motor Current Reading</h3>
          <form onSubmit={handleAddData} className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <div>
              <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">Plant *</label>
              <select
                data-testid="form-plant-select"
                value={formData.plant}
                onChange={(e) => setFormData({ ...formData, plant: e.target.value, machine: "" })}
                className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
                required
              >
                {Object.keys(PLANT_CONFIG).map(p => (
                  <option key={p} value={p}>Plant {p}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">Machine *</label>
              <select
                data-testid="form-machine-select"
                value={formData.machine}
                onChange={(e) => setFormData({ ...formData, machine: e.target.value })}
                className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
                required
              >
                <option value="">Select</option>
                {PLANT_CONFIG[formData.plant]?.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">Motor *</label>
              <select
                data-testid="form-motor-select"
                value={formData.motor}
                onChange={(e) => setFormData({ ...formData, motor: e.target.value })}
                className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
                required
              >
                <option value="">Select</option>
                {MOTOR_COMPONENTS.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">Current (A) *</label>
              <input
                data-testid="form-current-input"
                type="number"
                step="0.01"
                value={formData.current}
                onChange={(e) => setFormData({ ...formData, current: e.target.value })}
                placeholder="2.93"
                className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none font-mono"
                required
              />
            </div>

            <div>
              <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">Normal (A) *</label>
              <input
                data-testid="form-normal-input"
                type="number"
                step="0.01"
                value={formData.normal_current}
                onChange={(e) => setFormData({ ...formData, normal_current: e.target.value })}
                placeholder="3.0"
                className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none font-mono"
                required
              />
            </div>

            <div>
              <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">Warning (A) *</label>
              <input
                data-testid="form-warning-input"
                type="number"
                step="0.01"
                value={formData.warning_current}
                onChange={(e) => setFormData({ ...formData, warning_current: e.target.value })}
                placeholder="4.0"
                className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none font-mono"
                required
              />
            </div>

            <div className="md:col-span-6 border-t border-zinc-200 pt-4 mt-2">
              <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-3 block">
                📸 Verification Photo (Recommended)
              </label>
              <p className="text-xs text-zinc-600 mb-3">Add photo proof for field verification. Timestamp will be added automatically.</p>
              
              {!photoPreview ? (
                <div className="flex items-center space-x-3">
                  <label className="flex items-center space-x-2 px-4 py-2 border-2 border-dashed border-zinc-300 hover:border-[#002FA7] bg-white cursor-pointer transition-all duration-150 rounded-none">
                    <Camera size={20} weight="bold" className="text-[#002FA7]" />
                    <span className="text-sm text-zinc-700">Capture / Upload Photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handlePhotoCapture}
                      className="hidden"
                      data-testid="photo-input"
                    />
                  </label>
                  <span className="text-xs text-zinc-500">Camera or Gallery</span>
                </div>
              ) : (
                <div className="relative inline-block">
                  <img 
                    src={photoPreview} 
                    alt="Preview" 
                    className="w-64 h-48 object-cover border-2 border-[#002FA7]"
                  />
                  <button
                    type="button"
                    onClick={removePhoto}
                    className="absolute top-2 right-2 bg-[#E11D48] text-white p-2 hover:bg-[#E11D48]/90 transition-all duration-150"
                  >
                    <XCircle size={20} weight="fill" />
                  </button>
                  <div className="mt-2 flex items-center space-x-2 text-xs">
                    <ImageIcon size={16} weight="fill" className="text-[#16A34A]" />
                    <span className="text-[#16A34A] font-medium">Photo ready - Timestamp will be added on submit</span>
                  </div>
                </div>
              )}
            </div>

            <div className="md:col-span-6 grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-zinc-200 pt-4 mt-2">
              <div>
                <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">Entry Source *</label>
                <select
                  data-testid="form-entry-source-select"
                  value={formData.entry_source}
                  onChange={(e) => setFormData({ ...formData, entry_source: e.target.value })}
                  className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
                  required
                >
                  <option value="Field">Field (On-site)</option>
                  <option value="Office">Office</option>
                </select>
                <p className="text-xs text-zinc-500 mt-1">Field entries are auto-verified</p>
              </div>

              <div>
                <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">Verified By</label>
                <input
                  data-testid="form-verified-by-input"
                  type="text"
                  value={formData.verified_by}
                  onChange={(e) => setFormData({ ...formData, verified_by: e.target.value })}
                  placeholder="Technician name"
                  className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
                />
              </div>

              <div>
                <label className="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500 mb-2 block">Notes</label>
                <input
                  data-testid="form-notes-input"
                  type="text"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Optional notes"
                  className="w-full border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 focus:outline-none focus:ring-2 focus:ring-[#002FA7] focus:ring-offset-2 rounded-none"
                />
              </div>
            </div>

            <div className="md:col-span-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="border border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 px-4 py-2 text-sm font-medium tracking-tight transition-all duration-150 ease-out rounded-none"
              >
                Cancel
              </button>
              <button
                data-testid="submit-data-btn"
                type="submit"
                className="bg-[#16A34A] text-white hover:bg-[#16A34A]/90 px-6 py-2 text-sm font-medium tracking-tight transition-all duration-150 ease-out rounded-none"
              >
                Save Reading
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 lg:gap-6">
        {/* Plant & Machine Selector */}
        <div className="col-span-1 md:col-span-3">
          {/* Plant Selector */}
          <div className="border border-zinc-200 bg-white p-6 mb-4">
            <h3 className="text-lg font-medium tracking-tight text-zinc-900 mb-4">Select Plant</h3>
            <div className="grid grid-cols-2 gap-2">
              {Object.keys(PLANT_CONFIG).map((plant) => (
                <button
                  key={plant}
                  data-testid={`plant-btn-${plant}`}
                  onClick={() => {
                    setSelectedPlant(plant);
                    setSelectedMachine("");
                  }}
                  className={`px-4 py-3 text-sm font-medium tracking-tight transition-all duration-150 ease-out rounded-none border ${
                    selectedPlant === plant
                      ? 'border-[#002FA7] bg-[#002FA7] text-white'
                      : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400'
                  }`}
                >
                  Plant {plant}
                </button>
              ))}
            </div>
          </div>

          {/* Machine Selector */}
          <div className="border border-zinc-200 bg-white p-6">
            <h3 className="text-lg font-medium tracking-tight text-zinc-900 mb-4">Select Machine</h3>
            <div className="space-y-2">
              {PLANT_CONFIG[selectedPlant]?.map((machine) => (
                <button
                  key={machine}
                  data-testid={`machine-btn-${machine}`}
                  onClick={() => setSelectedMachine(machine)}
                  className={`w-full text-left px-4 py-3 text-sm font-medium tracking-tight transition-all duration-150 ease-out rounded-none border ${
                    selectedMachine === machine
                      ? 'border-[#002FA7] bg-[#002FA7] text-white'
                      : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400'
                  }`}
                >
                  {machine}
                </button>
              ))}
            </div>
          </div>

          {/* Machine Health Status */}
          {machineHealth.length > 0 && (
            <div className="border border-zinc-200 bg-white p-6 mt-4">
              <h3 className="text-lg font-medium tracking-tight text-zinc-900 mb-4">Machine Health Status</h3>
              <div className="space-y-3">
                {machineHealth.map((health) => (
                  <div key={health.machine} className="border-l-2 border-[#002FA7] pl-3" data-testid={`health-${health.machine}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-zinc-950">{health.machine}</span>
                      <span className={`text-lg font-mono font-light ${getHealthColor(health.health_percent)}`}>
                        {health.health_percent}%
                      </span>
                    </div>
                    <div className="flex items-center space-x-3 text-xs">
                      <span className="text-[#16A34A]">OK: {health.ok}</span>
                      <span className="text-yellow-700">Warn: {health.warning}</span>
                      <span className="text-[#E11D48]">Alarm: {health.alarm}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Chart & Data Display */}
        <div className="col-span-1 md:col-span-9">
          <div className="border border-zinc-200 bg-white p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-medium tracking-tight text-zinc-900">
                  {selectedMachine ? `${selectedPlant} - ${selectedMachine} Condition Overview` : 'Select a machine to view data'}
                </h3>
                {selectedMachine && (
                  <p className="text-sm text-zinc-600 mt-1">
                    {motorFilter === "ALL"
                      ? `${chartData.length} readings (all motors)`
                      : `${filteredRows.length} readings for ${motorFilter}`}
                  </p>
                )}
              </div>
              {selectedMachine && chartData.length > 0 && (
                <button
                  data-testid="export-btn"
                  onClick={exportCsv}
                  title="Download the readings shown below as a CSV file (opens in Excel)"
                  className="border border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400 px-4 py-2 text-sm font-medium tracking-tight transition-all duration-150 ease-out rounded-none flex items-center space-x-2"
                >
                  <Download size={16} weight="bold" />
                  <span>Export</span>
                </button>
              )}
            </div>

            {!selectedMachine ? (
              <div className="h-96 flex items-center justify-center">
                <p className="text-sm text-zinc-500">Select a plant and machine from the left panel</p>
              </div>
            ) : loading ? (
              <div className="h-96 flex items-center justify-center">
                <p className="text-sm text-zinc-600">Loading data...</p>
              </div>
            ) : chartData.length === 0 ? (
              <div className="h-96 flex items-center justify-center">
                <p className="text-sm text-zinc-500">No monitoring data available for this machine</p>
              </div>
            ) : (
              <div data-testid="chart-container">
                {/* ================= (3) ROUND COMPLETENESS ================= */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6" data-testid="round-coverage">
                  <div className="border border-zinc-200 p-4">
                    <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-500">Read today</p>
                    <p className="text-2xl font-mono mt-1">
                      <span className={coverage.readToday.length === coverage.total ? "text-green-700" : "text-zinc-950"}>
                        {coverage.readToday.length}
                      </span>
                      <span className="text-zinc-400 text-lg"> / {coverage.total}</span>
                    </p>
                    <p className="text-xs text-zinc-500 mt-1">motors with a reading today (IST)</p>
                    {coverage.notToday.length > 0 && coverage.notToday.length < coverage.total && (
                      <details className="mt-2">
                        <summary className="text-xs text-[#002FA7] cursor-pointer">
                          {coverage.notToday.length} not read today
                        </summary>
                        <p className="text-xs text-zinc-700 mt-1 leading-5">
                          {coverage.notToday.map((m) => m.name).join(", ")}
                        </p>
                      </details>
                    )}
                  </div>

                  <div className="border border-zinc-200 p-4">
                    <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-500">Latest round</p>
                    <p className="text-2xl font-mono mt-1">
                      <span className={coverage.roundMissing.length === 0 ? "text-green-700" : "text-yellow-700"}>
                        {coverage.roundMotors.length}
                      </span>
                      <span className="text-zinc-400 text-lg"> / {coverage.total}</span>
                    </p>
                    <p className="text-xs text-zinc-500 mt-1">
                      {coverage.newest ? `round of ${fmtTime(coverage.newest)}` : "no readings yet"}
                    </p>
                    {coverage.roundMissing.length > 0 && (
                      <details className="mt-2">
                        <summary className="text-xs text-[#002FA7] cursor-pointer">
                          {coverage.roundMissing.length} missing in this round
                        </summary>
                        <p className="text-xs text-zinc-700 mt-1 leading-5">
                          {coverage.roundMissing.map((m) => m.name).join(", ")}
                        </p>
                      </details>
                    )}
                  </div>

                  <div className={`border p-4 ${coverage.overdue.length ? "border-red-200 bg-red-50/40" : "border-zinc-200"}`}>
                    <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-zinc-500">
                      Overdue (&gt; {STALE_DAYS} days)
                    </p>
                    <p className={`text-2xl font-mono mt-1 ${coverage.overdue.length ? "text-red-700" : "text-green-700"}`}>
                      {coverage.overdue.length}
                    </p>
                    <p className="text-xs text-zinc-500 mt-1">motors not read for over {STALE_DAYS} days</p>
                    {coverage.overdue.length > 0 && (
                      <p className="text-xs text-red-700 mt-2 leading-5">
                        {coverage.overdue
                          .map((m) => `${m.name} (${m.ageDays === null ? "no reading" : ageText(m.ageDays)})`)
                          .join(", ")}
                      </p>
                    )}
                  </div>
                </div>

                {/* ================= (2) PARAMETER SWITCH ================= */}
                <div className="flex flex-wrap items-center gap-2 mb-4" data-testid="param-switch">
                  <span className="text-xs text-zinc-500 mr-1">Parameter</span>
                  {availableParams.map((p) => (
                    <button
                      key={p}
                      onClick={() => setParam(p)}
                      data-testid={`param-${p}`}
                      className={`px-3 py-1.5 text-sm border rounded-none transition-colors ${
                        param === p
                          ? "bg-[#002FA7] text-white border-[#002FA7]"
                          : "bg-white text-zinc-700 border-zinc-300 hover:border-zinc-500"
                      }`}
                    >
                      {PARAMS[p].label} ({PARAMS[p].unit})
                    </button>
                  ))}
                  <span className="text-xs text-zinc-400 ml-2">applies to the status table and the trend chart</span>
                </div>

                {/* ================= (1) LATEST STATUS OF EVERY MOTOR ================= */}
                <div className="mb-8" data-testid="motor-status">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h4 className="text-sm font-medium text-zinc-900">Latest status — every motor</h4>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="px-2 py-1 bg-red-50 text-red-700 font-bold">{summaryCounts.alarm} Alarm</span>
                      <span className="px-2 py-1 bg-yellow-50 text-yellow-800 font-bold">{summaryCounts.warning} Warning</span>
                      <span className="px-2 py-1 bg-zinc-100 text-zinc-700 font-bold">{summaryCounts.overdue} Overdue / no data</span>
                      <span className="px-2 py-1 bg-green-50 text-green-700 font-bold">{summaryCounts.ok} OK</span>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500 mb-2">
                    Problems first. Change = vs previous reading; vs avg = vs this motor's {AVG_DAYS}-day running average
                    (stopped readings of 0 excluded). Changes above {CHANGE_FLAG_PCT}% are highlighted. Click a motor to open its trend.
                  </p>
                  <div className={`overflow-auto border border-zinc-200 ${showAllStatus ? "" : "max-h-[420px]"}`}>
                    <table className="w-full">
                      <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_#e4e4e7]">
                        <tr>
                          {[
                            ["Motor", "left"],
                            [`Last (${unit})`, "right"],
                            ["Previous", "right"],
                            ["Change", "right"],
                            [`${AVG_DAYS}-day avg`, "right"],
                            ["vs avg", "right"],
                            [`Warning at (${unit})`, "right"],
                            ["Last read", "left"],
                            ["Status", "left"],
                          ].map(([h, align]) => (
                            <th
                              key={h}
                              className={`text-${align} px-3 py-2 text-[10px] sm:text-xs uppercase tracking-wider font-bold text-zinc-500 whitespace-nowrap`}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {motorSummary.map((m) => {
                          const bigChange = m.change !== null && Math.abs(m.change) >= CHANGE_FLAG_PCT;
                          const bigVsAvg = m.vsAvg !== null && Math.abs(m.vsAvg) >= CHANGE_FLAG_PCT;
                          const hasData = !!m.last;
                          return (
                            <tr
                              key={m.name}
                              onClick={() => hasData && focusMotor(m.name)}
                              className={`border-b border-zinc-100 ${hasData ? "cursor-pointer hover:bg-blue-50/60" : ""} ${
                                m.status === "Alarm" ? "bg-red-50/40" : m.status === "Warning" ? "bg-yellow-50/40" : ""
                              }`}
                              title={hasData ? "Click to open this motor's trend" : "No reading in the loaded history"}
                            >
                              <td className="px-3 py-2 text-sm text-zinc-900 whitespace-nowrap">{m.name}</td>
                              <td className="px-3 py-2 text-sm font-mono text-right text-zinc-950">
                                {m.stopped ? <span className="text-zinc-500 whitespace-nowrap">0 (stopped)</span> : fmtNum(m.lastV)}
                              </td>
                              <td className="px-3 py-2 text-sm font-mono text-right text-zinc-600">{fmtNum(m.prevV)}</td>
                              <td className={`px-3 py-2 text-sm font-mono text-right ${bigChange ? (m.change > 0 ? "text-red-700 font-bold" : "text-blue-700 font-bold") : "text-zinc-600"}`}>
                                {fmtPct(m.change)}
                              </td>
                              <td className="px-3 py-2 text-sm font-mono text-right text-zinc-600" title={`${m.avgN} running readings`}>
                                {fmtNum(m.avg)}
                              </td>
                              <td className={`px-3 py-2 text-sm font-mono text-right ${bigVsAvg ? (m.vsAvg > 0 ? "text-red-700 font-bold" : "text-blue-700 font-bold") : "text-zinc-600"}`}>
                                {fmtPct(m.vsAvg)}
                              </td>
                              <td className="px-3 py-2 text-sm font-mono text-right text-zinc-600">{fmtNum(m.warningLimit)}</td>
                              <td className={`px-3 py-2 text-sm whitespace-nowrap ${m.stale ? "text-red-700 font-medium" : "text-zinc-600"}`}>
                                {ageText(m.ageDays)}
                              </td>
                              <td className="px-3 py-2">
                                <span className={`px-2 py-1 text-xs font-bold uppercase tracking-wider whitespace-nowrap ${statusBadgeClass(m.status)}`}>
                                  {m.status}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {motorSummary.length > 10 && (
                    <button
                      onClick={() => setShowAllStatus((v) => !v)}
                      className="mt-2 text-xs text-[#002FA7] hover:underline"
                    >
                      {showAllStatus ? "Collapse table" : `Expand table (${motorSummary.length} motors)`}
                    </button>
                  )}
                </div>

                {/* ================= TREND CHART ================= */}
                <div ref={chartRef} className="border-t border-zinc-200 pt-6">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h4 className="text-sm font-medium text-zinc-900">
                      {pLabel} trend — {motorFilter === "ALL" ? "all motors" : motorFilter}
                    </h4>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-zinc-500">Motor</label>
                      <select
                        value={motorFilter}
                        onChange={(e) => setMotorFilter(e.target.value)}
                        className="border border-zinc-300 bg-white px-2 py-1 text-sm rounded-none"
                        data-testid="chart-motor-filter"
                      >
                        <option value="ALL">All motors</option>
                        {motorOptions.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {motorFilter === "ALL" && (
                    <p className="text-xs text-zinc-500 mb-2">
                      Tip: pick one motor (or click it in the status table) to see its trend line and its own Normal / Warning limits.
                    </p>
                  )}
                  {!trendHasValues ? (
                    <div className="h-64 flex items-center justify-center border border-dashed border-zinc-200">
                      <p className="text-sm text-zinc-500">No {pLabel.toLowerCase()} readings for this selection</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height={400}>
                      <LineChart data={trendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                        <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#71717a' }} stroke="#a1a1aa" minTickGap={24} />
                        <YAxis
                          label={{ value: `${pLabel} (${unit})`, angle: -90, position: 'insideLeft', style: { fontSize: 12, fill: '#71717a' } }}
                          tick={{ fontSize: 12, fill: '#71717a', fontFamily: 'IBM Plex Mono, monospace' }}
                          stroke="#a1a1aa"
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload || !payload.length) return null;
                            const r = payload[0].payload;
                            return (
                              <div className="bg-white border border-zinc-200 px-3 py-2 text-xs shadow-sm">
                                <div className="font-medium text-zinc-900">{r.motor}</div>
                                <div className="text-zinc-500">{r.time}</div>
                                <div className="mt-1 font-mono">
                                  {pLabel}: {fmtNum(r[param])} {unit}
                                </div>
                                <div className="mt-1">
                                  <span className={`px-1.5 py-0.5 font-bold uppercase ${statusBadgeClass(r.status)}`}>{r.status}</span>
                                </div>
                                {r.verified && <div className="text-zinc-500 mt-1">By: {r.verified}</div>}
                              </div>
                            );
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        {/* Limit lines: only meaningful for ONE motor */}
                        {motorFilter !== "ALL" && filteredRows[0]?.[`normal_${param}`] !== null && filteredRows[0]?.[`normal_${param}`] !== undefined && (
                          <ReferenceLine
                            y={filteredRows[0][`normal_${param}`]}
                            stroke="#16A34A"
                            strokeDasharray="5 5"
                            ifOverflow="extendDomain"
                            label={{ value: `Normal ${filteredRows[0][`normal_${param}`]} ${unit}`, position: 'insideTopRight', fontSize: 10 }}
                          />
                        )}
                        {motorFilter !== "ALL" && filteredRows[0]?.[`warning_${param}`] !== null && filteredRows[0]?.[`warning_${param}`] !== undefined && (
                          <ReferenceLine
                            y={filteredRows[0][`warning_${param}`]}
                            stroke="#E11D48"
                            strokeDasharray="5 5"
                            ifOverflow="extendDomain"
                            label={{ value: `Warning ${filteredRows[0][`warning_${param}`]} ${unit}`, position: 'insideTopRight', fontSize: 10 }}
                          />
                        )}
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke={motorFilter === "ALL" ? "none" : "#002FA7"}
                          strokeWidth={motorFilter === "ALL" ? 0 : 2}
                          connectNulls
                          dot={(props) => {
                            const { cx, cy, payload, index } = props;
                            if (cx === undefined || cy === undefined || payload?.value === null) {
                              return <g key={`d-${index}`} />;
                            }
                            const fill =
                              payload.status === "Alarm" ? "#DC2626" : payload.status === "Warning" ? "#CA8A04" : "#002FA7";
                            return (
                              <circle key={`d-${index}`} cx={cx} cy={cy} r={motorFilter === "ALL" ? 3.5 : 3} fill={fill} stroke="none" />
                            );
                          }}
                          activeDot={{ r: 6 }}
                          name={`${pLabel} (${unit}) — dots: blue OK, amber Warning, red Alarm`}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* Data Table */}
                <div className="mt-6 border-t border-zinc-200 pt-6">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <h4 className="text-sm font-medium text-zinc-900">
                      Recent Readings
                      <span className="ml-2 text-xs font-normal text-zinc-500">
                        showing {tableRows.length} of {filteredRows.length}
                      </span>
                    </h4>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-xs text-zinc-500">Motor</label>
                      <select
                        data-testid="motor-filter"
                        value={motorFilter}
                        onChange={(e) => setMotorFilter(e.target.value)}
                        className="border border-zinc-300 bg-white px-2 py-1 text-sm rounded-none"
                      >
                        <option value="ALL">All motors</option>
                        {motorOptions.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      <label className="text-xs text-zinc-500 ml-2">Rows</label>
                      <select
                        data-testid="row-limit"
                        value={rowLimit}
                        onChange={(e) => setRowLimit(Number(e.target.value))}
                        className="border border-zinc-300 bg-white px-2 py-1 text-sm rounded-none"
                      >
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={250}>250</option>
                        <option value={0}>All</option>
                      </select>
                    </div>
                  </div>
                  {/* Fixed-height box: scroll inside it to see every row; header stays visible */}
                  <div className="overflow-auto max-h-[520px] border border-zinc-200" data-testid="readings-scroll">
                    <table className="w-full">
                      <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_#e4e4e7]">
                        <tr className="border-b border-zinc-200">
                          <th className="text-left px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Time</th>
                          <th className="text-left px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Motor</th>
                          {hasCurrent && (
                            <th className="text-right px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Current (A)</th>
                          )}
                          {hasTemp && (
                            <th className="text-right px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Temp (°C)</th>
                          )}
                          {hasI2t && (
                            <th className="text-right px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">I²t</th>
                          )}
                          <th className="text-right px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Normal ({unit})</th>
                          <th className="text-right px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Warning ({unit})</th>
                          <th className="text-left px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Status</th>
                          <th className="text-center px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Photo</th>
                          <th className="text-center px-4 py-2 text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-zinc-500">Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tableRows.map((row, idx) => (
                          <tr key={idx} className="even:bg-zinc-50/50 border-b border-zinc-100">
                            <td className="px-4 py-2 text-sm text-zinc-700 whitespace-nowrap">{row.time}</td>
                            <td className="px-4 py-2 text-sm text-zinc-700 whitespace-nowrap">{row.motor}</td>
                            {hasCurrent && (
                              <td className="px-4 py-2 text-sm font-mono text-zinc-950 text-right" data-numeric="true">{row.current ?? '-'}</td>
                            )}
                            {hasTemp && (
                              <td className="px-4 py-2 text-sm font-mono text-zinc-950 text-right">{row.temperature ?? '-'}</td>
                            )}
                            {hasI2t && (
                              <td className="px-4 py-2 text-sm font-mono text-zinc-950 text-right">{row.i2t ?? '-'}</td>
                            )}
                            <td className="px-4 py-2 text-sm font-mono text-zinc-600 text-right">{fmtNum(row[`normal_${param}`])}</td>
                            <td className="px-4 py-2 text-sm font-mono text-zinc-600 text-right">{fmtNum(row[`warning_${param}`])}</td>
                            <td className="px-4 py-2">
                              <span className={`px-2 py-1 text-xs font-bold uppercase tracking-wider rounded-none ${
                                row.status === 'OK' ? 'bg-green-50 text-green-700' :
                                row.status === 'Warning' ? 'bg-yellow-50 text-yellow-800' :
                                'bg-red-50 text-red-700'
                              }`}>
                                {row.status}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-center">
                              {row.has_photo ? (
                                <button
                                  onClick={() => window.open(row.photo, '_blank')}
                                  className="inline-flex items-center space-x-1 text-[#002FA7] hover:text-[#002FA7]/80 transition-colors"
                                  title="View photo with timestamp"
                                >
                                  <Camera size={18} weight="fill" />
                                  <span className="text-xs">View</span>
                                </button>
                              ) : (
                                <span className="text-xs text-zinc-400">-</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-center">
                              <span className={`px-2 py-1 text-xs font-bold uppercase tracking-wider rounded-none ${
                                row.entry_source === 'Field' ? 'bg-[#002FA7] text-white' :
                                'bg-zinc-200 text-zinc-700'
                              }`}>
                                {row.entry_source || 'N/A'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConditionMonitoring;
